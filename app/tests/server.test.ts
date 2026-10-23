import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { databases, closeDatabases } from "../src/server/db";
import { authSessions, challenges, controls, deletionConfirmations, jobs, learningSessions, notes, users } from "../src/server/db/schema";
import { transcripts, transcriptVersions } from "../src/server/db/transcript-schema";
import { consumeLink, deleteAccount, digest, inspectLink, logout, requestLink, withIdentity, type Mail } from "../src/server/auth";
import { endLearning, finishNote, heartbeat, listRecords, saveLearning, startLearning } from "../src/server/learning";
import { invalidateRestoredAuthentication, maintenance } from "../src/server/maintenance";
import { boundRecords } from "../src/learning/buffer";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../src/server/db/schema";

const mail: Mail[] = [];
const capture = async (value: Mail) => { mail.push(value); };
const secret = () => new URL(mail.at(-1)!.url).hash.slice(1);
async function login(email = "learner@example.test") {
  await requestLink(email, "login", undefined, capture);
  const result = await consumeLink(secret());
  assert.equal(result.purpose, "login");
  return result.secret!;
}
const record = (text = "synthetic private transcript marker") => ({ learning: "conversation", corrections: [],
  turns: [{ id: "user-1", requestId: "request-1", role: "user", text }, { id: "assistant-1", requestId: "request-1", role: "assistant", text: "What happened next?" }] });

describe("PostgreSQL authentication and isolated records", { concurrency: false }, () => {
  before(async () => {
    for (const name of ["DATABASE_URL", "TRANSCRIPT_DATABASE_URL"]) {
      assert.match(new URL(process.env[name] ?? "").pathname, /^\/talkie_test_/,
        "Use dedicated talkie_test_* databases; tests refuse ordinary databases.");
    }
    await migrate(databases().records, { migrationsFolder: "drizzle/records" });
    await migrate(databases().temporary, { migrationsFolder: "drizzle/transcripts" });
  });
  beforeEach(async () => {
    mail.length = 0;
    await databases().records.execute(sql`truncate users, auth_request_controls, auth_challenges cascade`);
    await databases().temporary.delete(transcripts);
  });
  after(closeDatabases);

  it("does not create accounts on request/preview, stores hashes, consumes a link exactly once concurrently", async () => {
    await requestLink("learner@example.test", "login", undefined, capture);
    const link = secret();
    assert.equal((await databases().records.select().from(users)).length, 0);
    assert.equal((await inspectLink(link)).email, "learner@example.test");
    await inspectLink(link);
    const rows = await databases().records.select().from(challenges);
    assert.equal(rows[0].tokenHash, digest(link));
    assert.equal(JSON.stringify(rows).includes(link), false);
    const results = await Promise.allSettled([consumeLink(link), consumeLink(link)]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal((await databases().records.select().from(authSessions)).length, 1);
  });
  it("serializes simultaneous issuance and revokes older unused links; no mail retry on failure", async () => {
    const results = await Promise.allSettled([requestLink("a@example.test", "login", undefined, capture), requestLink("a@example.test", "login", undefined, capture)]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    const old = secret();
    await databases().records.update(controls).set({ requestedAt: new Date(Date.now() - 31_000) });
    let attempts = 0;
    await requestLink("a@example.test", "login", undefined, async () => { attempts++; throw new Error("PRIVATE_SMTP_BODY"); });
    assert.equal(attempts, 1);
    await assert.rejects(consumeLink(old), /REPLACED_LINK/);
    const rows = await databases().records.select().from(challenges);
    assert.equal(rows.some(r => r.delivery === "failed_or_unknown"), true);
    assert.equal(JSON.stringify(rows).includes("PRIVATE_SMTP_BODY"), false);
  });
  it("rejects expiration, refreshes only valid sessions and never resurrects logout", async () => {
    const raw = await login();
    await withIdentity(raw, async (_tx, who) => assert.ok(who.expiresAt.getTime() > Date.now() + 29 * 86_400_000));
    await logout(raw);
    await assert.rejects(withIdentity(raw, async () => {}), /LOGIN_REQUIRED/);
    await databases().records.update(challenges).set({ consumedAt: null, expiresAt: new Date(Date.now() - 1) });
    await assert.rejects(consumeLink(secret()), /EXPIRED_LINK/);
  });
  it("does not replace a different logged-in account when confirming a link", async () => {
    const raw = await login("a@example.test");
    await requestLink("b@example.test", "login", undefined, capture);
    await assert.rejects(consumeLink(secret(), raw), /LOGOUT_FIRST/);
    assert.equal((await withIdentity(raw, async (_tx, who) => who.email)), "a@example.test");
  });
  it("enforces one connection, isolated ownership and idempotent/version-conflict saves", async () => {
    const raw = await login(), b = await login("b@example.test");
    const s = await startLearning(raw, "conversation");
    await assert.rejects(startLearning(raw, "conversation"), /ALREADY_CONNECTED/);
    await saveLearning(raw, s.id, s.secret, 1, record());
    await saveLearning(raw, s.id, s.secret, 1, record());
    await assert.rejects(saveLearning(raw, s.id, s.secret, 1, record("changed")), /VERSION_CONFLICT/);
    await assert.rejects(saveLearning(b, s.id, s.secret, 2, record()), /NOT_FOUND/);
    assert.equal((await listRecords(b)).sessions.length, 0);
    await heartbeat(raw, s.id, s.secret, true);
    const restored = await startLearning(raw, "conversation");
    assert.equal(restored.version, 1);
    assert.equal(restored.snapshot.turns[0].text, record().turns[0].text);
    await assert.rejects(saveLearning(raw, s.id, s.secret, 2, record()), /CONNECTION_EXPIRED/);
  });
  it("keeps acknowledged history when the client window loses old turns and ignores unacknowledged versions on resume", async () => {
    const raw = await login(), s = await startLearning(raw, "conversation");
    await saveLearning(raw, s.id, s.secret, 1, record("old confirmed"));
    const recent = { learning: "conversation", gaps: false, corrections: [], turns: [{ id: "user-2", requestId: "request-2", role: "user", text: "recent confirmed" }] };
    await saveLearning(raw, s.id, s.secret, 2, recent);
    await databases().temporary.insert(transcriptVersions).values({ sessionId: s.id, version: 3, digest: "unconfirmed", payload: record("must not restore") });
    await heartbeat(raw, s.id, s.secret, true);
    const restored = await startLearning(raw, "conversation");
    assert.deepEqual(restored.snapshot.turns.filter(t => t.role === "user").map(t => t.text), ["old confirmed", "recent confirmed"]);
  });
  it("preserves first end time, commits a bounded demo note before deleting source, rejects late writes", async () => {
    const raw = await login(), s = await startLearning(raw, "conversation");
    await saveLearning(raw, s.id, s.secret, 1, record("x".repeat(1000)));
    const end = await endLearning(raw, s.id, s.secret);
    assert.equal((await endLearning(raw, s.id, s.secret)).endedAt, end.endedAt);
    await finishNote(raw, s.id);
    assert.equal((await databases().temporary.select().from(transcripts)).length, 0);
    const saved = await databases().records.select().from(notes);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].markdown.includes("x".repeat(161)), false);
    await assert.rejects(saveLearning(raw, s.id, s.secret, 2, record()), /CONNECTION_EXPIRED/);
  });
  it("recovers a temporary-only commit without losing acknowledged state or duplicating the retried version", async () => {
    const raw = await login(), s = await startLearning(raw, "conversation");
    await saveLearning(raw, s.id, s.secret, 1, record());
    const next = { ...record(), turns: [...record().turns, { id: "user-2", requestId: "request-2", role: "user", text: "new synthetic answer" }] };
    await databases().records.execute(sql`create function reject_test_confirmation() returns trigger language plpgsql as $$ begin if NEW.version = 2 then raise exception 'SIMULATED_CONFIRM_FAILURE'; end if; return NEW; end $$`);
    await databases().records.execute(sql`create trigger reject_test_confirmation before update on learning_sessions for each row execute function reject_test_confirmation()`);
    try { await assert.rejects(saveLearning(raw, s.id, s.secret, 2, next)); }
    finally {
      await databases().records.execute(sql`drop trigger reject_test_confirmation on learning_sessions`);
      await databases().records.execute(sql`drop function reject_test_confirmation()`);
    }
    assert.equal((await databases().records.select().from(learningSessions))[0].version, 1);
    assert.equal((await databases().temporary.select().from(transcriptVersions)).some(v => v.version === 2), true);
    await heartbeat(raw, s.id, s.secret, true);
    const resumed = await startLearning(raw, "conversation");
    assert.equal(resumed.snapshot.turns.length, 2);
    await saveLearning(raw, s.id, resumed.secret, 2, next);
    assert.equal((await databases().temporary.select().from(transcriptVersions)).filter(v => v.version === 2).length, 1);
  });
  it("requires deletion recheck in the original session, blocks all sessions immediately and removes source on maintenance", async () => {
    const a = await login(), s = await startLearning(a, "conversation");
    await saveLearning(a, s.id, s.secret, 1, record());
    await databases().records.update(controls).set({ requestedAt: new Date(Date.now() - 31_000) });
    const b = await login();
    await databases().records.update(controls).set({ requestedAt: new Date(Date.now() - 31_000) });
    await requestLink("learner@example.test", "delete", a, capture);
    const link = secret();
    await assert.rejects(consumeLink(link, b), /ORIGINAL_BROWSER_REQUIRED/);
    await consumeLink(link, a);
    await deleteAccount(a);
    await assert.rejects(withIdentity(b, async () => {}), /LOGIN_REQUIRED/);
    await assert.rejects(saveLearning(a, s.id, s.secret, 2, record()), /LOGIN_REQUIRED/);
    await maintenance();
    assert.equal((await databases().records.select().from(users)).length, 0);
    assert.equal((await databases().temporary.select().from(transcripts)).length, 0);
  });
  it("auto-closes after interruption, does not generate empty notes and removes expired source on the original deadline", async () => {
    const raw = await login(), s = await startLearning(raw, "conversation");
    await databases().records.update(learningSessions).set({ status: "interrupted", interruptedAt: new Date(Date.now() - 86_400_001) });
    await maintenance();
    const [closed] = await databases().records.select().from(learningSessions);
    assert.equal(closed.status, "ended"); assert.equal(closed.noteStatus, "empty");
    assert.equal((await databases().records.select().from(notes)).length, 0);
    assert.equal((await databases().temporary.select().from(transcripts)).length, 0);
    assert.ok(closed.eraseAt!.getTime() - closed.endedAt!.getTime() === 86_400_000);
  });
  it("invalidates restored auth while ordinary reconnection keeps it; deletes expired authentication after 24 hours", async () => {
    const raw = await login();
    await closeDatabases();
    await withIdentity(raw, async () => {});
    await databases().records.update(authSessions).set({ revokedAt: new Date(Date.now() - 86_400_001) });
    await maintenance();
    assert.equal((await databases().records.select().from(authSessions)).length, 0);
    await invalidateRestoredAuthentication();
    assert.equal((await databases().records.select().from(challenges)).length, 0);
    await assert.rejects(withIdentity(raw, async () => {}), /LOGIN_REQUIRED/);
  });
  it("keeps final-save retries alive while the browser is connected, then deletes source at the first end deadline", async () => {
    const raw = await login(), s = await startLearning(raw, "conversation");
    await saveLearning(raw, s.id, s.secret, 1, record());
    await endLearning(raw, s.id, s.secret);
    await databases().records.update(jobs).set({ dueAt: new Date(Date.now() - 60_000) });
    await maintenance();
    assert.equal((await databases().records.select().from(learningSessions))[0].noteStatus, "waiting_save");
    assert.equal((await databases().temporary.select().from(transcripts)).length, 1);
    await databases().records.update(learningSessions).set({ leaseUntil: new Date(Date.now() - 60_000) });
    await heartbeat(raw, s.id, s.secret); // Closing retry owner can reconnect until its original erase deadline.
    await databases().records.update(learningSessions).set({ eraseAt: new Date(Date.now() - 1) });
    await assert.rejects(saveLearning(raw, s.id, s.secret, 2, record()), /SESSION_CLOSED/);
    await maintenance();
    assert.equal((await databases().temporary.select().from(transcripts)).length, 0);
    assert.equal((await databases().records.select().from(learningSessions))[0].noteStatus, "expired");
  });
  it("bounds whole request units, keeping recent content without partially retaining correction evidence", () => {
    const turns = Array.from({ length: 8 }, (_, i) => ({ id: `t-${i}`, requestId: `r-${Math.floor(i / 2)}`, role: i % 2 ? "assistant" as const : "user" as const, text: "x".repeat(200) }));
    const bounded = boundRecords(turns, [], 1100);
    assert.ok(bounded.dropped);
    assert.equal(bounded.turns[0].role, "user");
    assert.equal(bounded.turns.at(-1)!.id, "t-7");
    assert.ok(new TextEncoder().encode(JSON.stringify({ turns: bounded.turns, corrections: [] })).length <= 1100);
  });
  it("backs up only durable records and invalidates authentication after a real PostgreSQL restore", { skip: !process.env.PG_BIN_DIR }, async () => {
    const raw = await login(), s = await startLearning(raw, "conversation");
    const marker = `TRANSCRIPT_ONLY_${randomUUID()}`;
    await saveLearning(raw, s.id, s.secret, 1, record(marker));
    const folder = mkdtempSync(join(tmpdir(), "talkie-synthetic-backup-"));
    const source = new URL(process.env.DATABASE_URL!);
    const restoreName = "talkie_test_restore_" + randomUUID().replaceAll("-", "");
    const env = { ...process.env, PGHOST: source.hostname, PGPORT: source.port, PGUSER: source.username,
      PGPASSWORD: decodeURIComponent(source.password), PGDATABASE: source.pathname.slice(1) };
    let pool: Pool | undefined;
    try {
      const dump = join(folder, "records.dump");
      execFileSync(join(process.env.PG_BIN_DIR!, "pg_dump"), ["-Fc", "--no-owner", "--file", dump], { env, stdio: ["ignore", "pipe", "pipe"] });
      const sqlDump = execFileSync(join(process.env.PG_BIN_DIR!, "pg_restore"), ["--file=-", dump], { env, encoding: "utf8" });
      assert.equal(sqlDump.includes(marker), false);
      assert.equal(sqlDump.includes("CREATE TABLE public.transcript_"), false);
      await databases().recordsPool.query(`CREATE DATABASE ${restoreName}`); // Generated identifier contains only [a-z0-9_].
      execFileSync(join(process.env.PG_BIN_DIR!, "pg_restore"), ["--exit-on-error", "--no-owner", "--dbname", restoreName, dump], { env, stdio: ["ignore", "pipe", "pipe"] });
      const target = new URL(source); target.pathname = "/" + restoreName;
      pool = new Pool({ connectionString: target.href });
      const restored = drizzle(pool, { schema });
      assert.equal((await restored.select().from(authSessions)).length, 1);
      assert.equal((await pool.query("select count(*) from information_schema.tables where table_name like 'transcript_%'")).rows[0].count, "0");
      await invalidateRestoredAuthentication(restored);
      assert.equal((await restored.select().from(authSessions)).length, 0);
      assert.equal((await restored.select().from(challenges)).length, 0);
    } finally {
      if (pool) await pool.end();
      await databases().recordsPool.query(`DROP DATABASE IF EXISTS ${restoreName} WITH (FORCE)`);
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
