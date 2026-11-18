/**
 * DEC-044 synthetic-only drill: deletion-state reapplication before restored DB access.
 *
 * Run only through scripts/drill-backup-deletion-reapply.sh. It starts throwaway tmpfs PostgreSQL
 * containers, so no real user database, persistent volume or backup copy is touched or kept.
 *
 * Scenario: a pre-deletion backup is taken; afterwards one account deletes itself and is purged.
 * The "deletion state known after backup" is held only in this drill's memory (a stand-in, not a
 * production ledger: none is approved). The restored DB is gated: auth invalidation and deletion
 * reapplication run before any app call reaches it.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { closeDatabases, databases, type RecordsDatabase } from "../src/server/db";
import * as schema from "../src/server/db/records-schema";
import { emailAuthRateLimits, emailAuthRequests, learningSessionNotes, learningSessions, loginSessions, scheduledJobs, users } from "../src/server/db/records-schema";
import { transcriptSessionStates } from "../src/server/db/transcripts-schema";
import { consumeLink, deleteAccount, requestLink, withIdentity, type Mail } from "../src/server/auth";
import { completeLearningNote, endLearning, listLearningRecords, saveLearning, startLearning } from "../src/server/learning";
import { invalidateRestoredAuthentication, maintenance } from "../src/server/maintenance";

const container = process.env.DRILL_RECORDS_CONTAINER ?? "";
const liveUrl = process.env.DATABASE_URL ?? "";
const mail: Mail[] = [];
const capture = async (value: Mail) => { mail.push(value); };
const lastSecret = () => new URL(mail.at(-1)!.url).hash.slice(1);
const marker = (who: string) => `synthetic drill transcript for ${who}`;

async function login(email: string) {
  await databases().records.delete(emailAuthRateLimits).where(eq(emailAuthRateLimits.emailAddress, email)); // skip the 30 s wait in a synthetic run
  await requestLink(email, "login", undefined, capture);
  const result = await consumeLink(lastSecret());
  return result.loginSessionToken!;
}
async function learnAndNote(raw: string, who: string) {
  const s = await startLearning(raw, "conversation");
  await saveLearning(raw, s.learningSessionId, s.learningConnectionToken, 1, { learningState: "conversation", corrections: [],
    turns: [{ turnId: "user-1", requestId: "request-1", role: "user", text: marker(who) }, { turnId: "assistant-1", requestId: "request-1", role: "assistant", text: "What happened next?" }] });
  await endLearning(raw, s.learningSessionId, s.learningConnectionToken);
  await completeLearningNote(raw, s.learningSessionId);
  const userId = await withIdentity(raw, async (_tx, w) => w.userId);
  const [note] = await databases().records.select().from(learningSessionNotes).where(eq(learningSessionNotes.userId, userId));
  assert.ok(note, `synthetic note for ${who}`);
  return { userId, learningSessionId: s.learningSessionId, noteMarkdown: note.noteMarkdown };
}
async function confirmDeletion(raw: string, email: string) {
  await databases().records.delete(emailAuthRateLimits).where(eq(emailAuthRateLimits.emailAddress, email));
  await requestLink(email, "account_deletion", raw, capture);
  await consumeLink(lastSecret(), raw);
  await deleteAccount(raw);
}
const docker = (args: string[], input?: Buffer) =>
  execFileSync("docker", args, { input, maxBuffer: 256 * 1024 * 1024, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });

/** Drill stand-in for "deletion state known after the backup": user id and confirmation time only, no email/content. */
type DeletionStateEntry = { userId: string; accountDeletionConfirmedAt: Date };

/**
 * Pre-access gate for a restored records DB. Order: (1) invalidate all restored authentication,
 * (2) re-mark every post-backup deletion as confirmed and re-queue its purge, (3) run the existing purge.
 * Idempotent: an entry whose account is absent from the backup changes nothing.
 */
async function reapplyDeletionState(restored: RecordsDatabase, entries: DeletionStateEntry[]) {
  await invalidateRestoredAuthentication(restored);
  await restored.transaction(async tx => {
    for (const entry of entries) {
      const [user] = await tx.select().from(users).where(eq(users.userId, entry.userId)).for("update");
      if (!user) continue;
      if (!user.accountDeletionConfirmedAt) await tx.update(users).set({ accountDeletionConfirmedAt: entry.accountDeletionConfirmedAt }).where(eq(users.userId, entry.userId));
      await tx.insert(scheduledJobs).values({ targetUserId: entry.userId, jobType: "delete_account", scheduledRunAt: entry.accountDeletionConfirmedAt })
        .onConflictDoNothing();
    }
  });
}

describe("DEC-044 drill: deletion state reapplied before restored DB access", { concurrency: false }, () => {
  const restoreName = `talkie_test_restore_${randomBytes(6).toString("hex")}`;
  let restoredPool: Pool | undefined;
  before(async () => {
    assert.ok(container, "Run through scripts/drill-backup-deletion-reapply.sh (DRILL_RECORDS_CONTAINER missing).");
    for (const name of ["DATABASE_URL", "TRANSCRIPT_DATABASE_URL"]) {
      const url = new URL(process.env[name] ?? "");
      assert.match(url.pathname, /^\/talkie_test_drill/, "Drill refuses non-drill databases.");
      assert.equal(url.hostname, "127.0.0.1");
    }
    await migrate(databases().records, { migrationsFolder: "drizzle/records" });
    await migrate(databases().transcripts, { migrationsFolder: "drizzle/transcripts" });
  });
  after(async () => {
    await closeDatabases();
    if (restoredPool) await restoredPool.end();
    try { docker(["exec", container, "psql", "-U", "talkie", "-d", "postgres", "-c", `DROP DATABASE IF EXISTS ${restoreName} WITH (FORCE)`]); } catch { /* container teardown discards it anyway */ }
  });

  it("pre-deletion backup + post-backup deletion state cannot bring back the deleted account or note", async () => {
    // 1) Live synthetic data. keeper: unrelated survivor. gone: deletes after the backup. pending: confirmed before, purged after.
    const keeperRaw = await login("keeper@drill.test"), goneRaw = await login("gone@drill.test"), pendingRaw = await login("pending@drill.test");
    const keeper = await learnAndNote(keeperRaw, "keeper"), gone = await learnAndNote(goneRaw, "gone"), pending = await learnAndNote(pendingRaw, "pending");
    await confirmDeletion(pendingRaw, "pending@drill.test");

    // 2) Backup of the records DB only (transcripts DB is excluded by design, DEC-034). Kept in memory, never on disk.
    const backup = docker(["exec", container, "pg_dump", "-U", "talkie", "-d", new URL(liveUrl).pathname.slice(1), "-Fc", "--no-owner"]);
    const listing = docker(["exec", "-i", container, "pg_restore", "--file=-"], backup).toString("utf8");
    assert.ok(listing.includes(gone.userId) && listing.includes(marker("gone")), "backup predates the deletion and holds the gone account and its note evidence");
    assert.equal(listing.includes("CREATE TABLE public.transcript_"), false);

    // 3) After the backup: gone deletes; the deletion state becomes known; live purge runs.
    await confirmDeletion(goneRaw, "gone@drill.test");
    const [goneRow] = await databases().records.select().from(users).where(eq(users.userId, gone.userId));
    const deletionState: DeletionStateEntry[] = [{ userId: gone.userId, accountDeletionConfirmedAt: goneRow.accountDeletionConfirmedAt! }];
    const live = await maintenance();
    assert.equal(live.deletedAccountCount, 2);
    assert.equal((await databases().records.select().from(users).where(inArray(users.userId, [gone.userId, pending.userId]))).length, 0);

    // 4) Disaster recovery: restore into a fresh DB. No app request may reach it before the gate completes.
    docker(["exec", container, "psql", "-U", "talkie", "-d", "postgres", "-c", `CREATE DATABASE ${restoreName}`]); // identifier is [a-z0-9_] only
    docker(["exec", "-i", container, "pg_restore", "-U", "talkie", "--no-owner", "--exit-on-error", "-d", restoreName], backup);
    const restoredUrl = new URL(liveUrl); restoredUrl.pathname = "/" + restoreName;
    restoredPool = new Pool({ connectionString: restoredUrl.href });
    const restored = drizzle(restoredPool, { schema });

    // Negative control: the naive restore resurrects gone (active, with note) and keeps the login sessions.
    const [naiveGone] = await restored.select().from(users).where(eq(users.userId, gone.userId));
    assert.ok(naiveGone && naiveGone.accountDeletionConfirmedAt === null, "naive restore resurrects gone as an active account");
    assert.equal((await restored.select().from(learningSessionNotes).where(eq(learningSessionNotes.userId, gone.userId))).length, 1);
    assert.ok((await restored.select().from(loginSessions)).length >= 3);

    // 5) Gate: invalidate auth, reapply deletion state (twice: idempotent), then purge with the existing job code.
    await reapplyDeletionState(restored, deletionState);
    await reapplyDeletionState(restored, deletionState);
    await closeDatabases();
    process.env.DATABASE_URL = restoredUrl.href; // the app now points at the restored DB (transcripts DB stays live)
    const purge = await maintenance();
    assert.equal(purge.failures, 0);
    assert.equal(purge.deletedAccountCount, 2, "gone (reapplied) and pending (confirmed in backup) are purged");
    assert.equal((await maintenance()).deletedAccountCount, 0, "a second pass changes nothing");

    // 6) Evidence on the restored DB, the state the reopened service sees.
    const db = databases().records;
    for (const id of [gone.userId, pending.userId]) {
      assert.equal((await db.select().from(users).where(eq(users.userId, id))).length, 0);
      assert.equal((await db.select().from(learningSessions).where(eq(learningSessions.userId, id))).length, 0);
      assert.equal((await db.select().from(learningSessionNotes).where(eq(learningSessionNotes.userId, id))).length, 0);
      assert.equal((await db.select().from(scheduledJobs).where(eq(scheduledJobs.targetUserId, id))).length, 0);
      assert.equal((await databases().transcripts.select().from(transcriptSessionStates).where(eq(transcriptSessionStates.userId, id))).length, 0);
    }
    const remainingEmails = (await db.select({ e: users.emailAddress }).from(users)).map(r => r.e);
    assert.deepEqual(remainingEmails, ["keeper@drill.test"]);
    assert.equal((await db.select().from(emailAuthRequests)).length, 0);
    assert.equal((await db.select().from(emailAuthRateLimits)).length, 0);
    assert.equal((await db.select().from(loginSessions)).length, 0);
    const [keptNote] = await db.select().from(learningSessionNotes).where(eq(learningSessionNotes.userId, keeper.userId));
    assert.equal(keptNote?.noteMarkdown, keeper.noteMarkdown, "unrelated account's note survives unchanged");

    // Pre-restore sessions are invalid for everyone, including the survivor.
    for (const raw of [keeperRaw, goneRaw, pendingRaw]) await assert.rejects(withIdentity(raw, async () => {}), /LOGIN_REQUIRED/);

    // Survivor re-logs in and sees the same record; a fresh signup with gone's synthetic email is a new, empty account.
    const keeperAgain = await login("keeper@drill.test");
    assert.equal(await withIdentity(keeperAgain, async (_tx, w) => w.userId), keeper.userId);
    const keeperView = await listLearningRecords(keeperAgain);
    assert.deepEqual(keeperView.notes.map(n => [n.learningSessionId, n.noteMarkdown]), [[keeper.learningSessionId, keeper.noteMarkdown]]);
    const goneAgain = await login("gone@drill.test");
    assert.notEqual(await withIdentity(goneAgain, async (_tx, w) => w.userId), gone.userId);
    const goneView = await listLearningRecords(goneAgain);
    assert.equal(goneView.notes.length + goneView.sessions.length, 0, "re-signup sees nothing of the deleted account");
    assert.equal((await db.select().from(learningSessionNotes).where(sql`${learningSessionNotes.noteMarkdown} like ${"%" + marker("gone") + "%"}`)).length, 0);
  });
});
