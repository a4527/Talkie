import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { databases, closeDatabases } from "../src/server/db";
import { loginSessions, emailAuthRequests, emailAuthRateLimits, scheduledJobs, learningSessions, learningSessionNotes, users } from "../src/server/db/schema";
import { transcriptSessionStates, transcriptSaves } from "../src/server/db/transcript-schema";
import { deleteTranscriptSource } from "../src/server/db/transcript-lifecycle";
import { consumeLink, deleteAccount, digest, inspectLink, logout, requestLink, withIdentity, type Mail } from "../src/server/auth";
import { endLearning, finishNote, heartbeat, listRecords, saveLearning, startLearning } from "../src/server/learning";
import { invalidateRestoredAuthentication, maintenance } from "../src/server/maintenance";
import { boundRecords } from "../src/learning/buffer";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../src/server/db/schema";

const mail: Mail[] = [];
const capture = async (value: Mail) => { mail.push(value); };
const secret = () => new URL(mail.at(-1)!.url).hash.slice(1);
const postgresFailure = (code: string, identifier: string) => (error: unknown): boolean => {
  let current = error;
  for (let depth = 0; current && typeof current === "object" && depth < 8; depth++) {
    const detail = current as { code?: string; constraint?: string; message?: string; cause?: unknown };
    if (detail.code === code && (detail.constraint === identifier || detail.message?.includes(identifier))) return true;
    current = detail.cause;
  }
  return false;
};
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
    await databases().records.execute(sql`truncate users, email_auth_rate_limits, email_auth_requests cascade`);
    await databases().temporary.delete(transcriptSessionStates);
  });
  after(closeDatabases);

  it("migrates existing deadlines and sources without fabricating historical timestamps", async () => {
    const id = randomUUID(), userId = randomUUID(), loginSessionId = randomUUID(), deletedSourceId = randomUUID();
    const knownCreatedAt = new Date("2026-10-24T00:00:00Z");
    const knownDeletedAt = new Date("2026-10-24T01:00:00Z");
    const deadline = new Date("2026-10-25T00:00:00Z");
    await databases().temporary.transaction(async tx => {
      await tx.execute(sql`create schema test_transcript_migration`);
      await tx.execute(sql`set local search_path to test_transcript_migration`);
      await tx.execute(sql.raw(readFileSync("drizzle/transcripts/0000_mysterious_shape.sql", "utf8").replaceAll('"public".', '"test_transcript_migration".')));
      await tx.execute(sql`insert into transcript_sessions (session_id, user_id, version, digest, payload, erase_at) values (${id}, ${userId}, 0, 'legacy', '{}', ${deadline.toISOString()})`);
      await tx.execute(sql.raw(readFileSync("drizzle/transcripts/0001_strong_warpath.sql", "utf8")));
      await tx.execute(sql`insert into transcript_versions(session_id,version,digest,payload) values (${id},2,'unchanged-snapshot-hash',${JSON.stringify(record())}::jsonb)`);
      await tx.execute(sql`insert into transcript_lifecycle(session_id,user_id,created_at,first_saved_at,deleted_at,deletion_reason) values (${deletedSourceId},${userId},${knownCreatedAt.toISOString()},${knownCreatedAt.toISOString()},${knownDeletedAt.toISOString()},'note_saved')`);
      await tx.execute(sql.raw(readFileSync("drizzle/transcripts/0002_clear_session_state.sql", "utf8").replaceAll('"public".', '"test_transcript_migration".')));
      assert.deepEqual((await tx.select().from(transcriptSessionStates).where(eq(transcriptSessionStates.learningSessionId, id)))[0].transcriptDeleteDeadlineAt, deadline);
      const [legacy] = await tx.select().from(transcriptSessionStates).where(eq(transcriptSessionStates.learningSessionId, id));
      assert.equal(legacy.learningSessionId, id);
      assert.equal(legacy.transcriptStorageCreatedAt, null);
      assert.equal(legacy.firstNonemptySaveAt, null);
      assert.equal(legacy.sourceDeletedAt, null);
      assert.equal(legacy.sourceDeletionReason, null);
      const [saved] = await tx.select().from(transcriptSaves);
      assert.equal(saved.saveSequenceNumber, 2);
      assert.equal(saved.snapshotHash, 'unchanged-snapshot-hash');
      assert.deepEqual(saved.conversationSnapshot, record());
      const [deleted] = await tx.select().from(transcriptSessionStates).where(eq(transcriptSessionStates.learningSessionId, deletedSourceId));
      assert.deepEqual(deleted.transcriptStorageCreatedAt, knownCreatedAt);
      assert.deepEqual(deleted.firstNonemptySaveAt, knownCreatedAt);
      assert.deepEqual(deleted.sourceDeletedAt, knownDeletedAt);
      assert.equal(deleted.sourceDeletionReason, 'note_saved');
      await tx.execute(sql`drop schema test_transcript_migration cascade`);
    });
    await databases().records.transaction(async tx => {
      await tx.execute(sql`create schema test_records_migration`);
      await tx.execute(sql`set local search_path to test_records_migration`);
      await tx.execute(sql.raw(readFileSync("drizzle/records/0000_wet_polaris.sql", "utf8").replaceAll('"public".', '"test_records_migration".')));
      await tx.execute(sql`insert into users (id, email) values (${userId}, 'legacy@example.test')`);
      await tx.execute(sql`insert into learning_sessions (id, user_id, created_at, erase_at) values (${id}, ${userId}, clock_timestamp(), ${deadline.toISOString()})`);
      await tx.execute(sql.raw(readFileSync("drizzle/records/0001_flaky_bastion.sql", "utf8")));
      await tx.execute(sql`update users set created_at=${knownCreatedAt.toISOString()} where id=${userId}`);
      await tx.execute(sql`update learning_sessions set version=2 where id=${id}`);
      await tx.execute(sql`insert into auth_sessions(id,user_id,token_hash,created_at,last_seen_at,expires_at) values (${loginSessionId},${userId},'unchanged-login-hash',${knownCreatedAt.toISOString()},${knownCreatedAt.toISOString()},${deadline.toISOString()})`);
      await tx.execute(sql`insert into deletion_confirmations(session_id,expires_at,consumed_at) values (${loginSessionId},${deadline.toISOString()},${knownDeletedAt.toISOString()})`);
      await tx.execute(sql`insert into auth_challenges(email,purpose,token_hash,session_id,created_at,expires_at,delivery) values ('legacy@example.test','delete','unchanged-link-hash',${loginSessionId},${knownCreatedAt.toISOString()},${deadline.toISOString()},'accepted')`);
      await tx.execute(sql`insert into session_notes(session_id,user_id,date,markdown,expires_at) values (${id},${userId},'2026-10-24','Synthetic legacy note',${deadline.toISOString()})`);
      await tx.execute(sql`insert into scheduled_jobs(user_id,session_id,kind,due_at) values (${userId},${id},'note',${deadline.toISOString()})`);
      await tx.execute(sql.raw(readFileSync("drizzle/records/0002_clear_session_state.sql", "utf8").replaceAll('"public".', '"test_records_migration".')));
      assert.deepEqual((await tx.select().from(learningSessions))[0].transcriptDeleteDeadlineAt, deadline);
      assert.equal((await tx.select().from(learningSessions))[0].confirmedSaveSequenceNumber, 2);
      assert.deepEqual((await tx.select().from(users))[0].accountCreatedAt, knownCreatedAt);
      const [session] = await tx.select().from(loginSessions);
      assert.equal(session.loginSessionId, loginSessionId);
      assert.equal(session.loginTokenHash, 'unchanged-login-hash');
      assert.deepEqual(session.accountDeletionAuthorizationExpiresAt, deadline);
      assert.deepEqual(session.accountDeletionAuthorizationUsedAt, knownDeletedAt);
      const [request] = await tx.select().from(emailAuthRequests);
      assert.equal(request.authenticationPurpose, 'account_deletion');
      assert.equal(request.emailSendStatus, 'smtp_accepted');
      assert.equal(request.authLinkTokenHash, 'unchanged-link-hash');
      assert.equal(request.requestingLoginSessionId, loginSessionId);
      assert.equal((await tx.select().from(learningSessionNotes))[0].noteMarkdown, 'Synthetic legacy note');
      assert.deepEqual((await tx.select().from(scheduledJobs))[0].scheduledRunAt, deadline);
      await tx.execute(sql`drop schema test_records_migration cascade`);
    });
  });

  it("rolls back schema changes when legacy note ownership is inconsistent", async () => {
    const id = randomUUID(), owner = randomUUID(), other = randomUUID();
    await assert.rejects(databases().records.transaction(async tx => {
      await tx.execute(sql`create schema test_invalid_owner_migration`);
      await tx.execute(sql`set local search_path to test_invalid_owner_migration`);
      await tx.execute(sql.raw(readFileSync("drizzle/records/0000_wet_polaris.sql", "utf8").replaceAll('"public".', '"test_invalid_owner_migration".')));
      await tx.execute(sql.raw(readFileSync("drizzle/records/0001_flaky_bastion.sql", "utf8")));
      await tx.execute(sql`insert into users(id,email) values (${owner},'owner@example.test'),(${other},'other@example.test')`);
      await tx.execute(sql`insert into learning_sessions(id,user_id,created_at) values (${id},${owner},clock_timestamp())`);
      await tx.execute(sql`insert into session_notes(session_id,user_id,date,markdown,expires_at) values (${id},${other},'2026-10-25','Synthetic invalid owner',clock_timestamp())`);
      await tx.execute(sql.raw(readFileSync("drizzle/records/0002_clear_session_state.sql", "utf8").replaceAll('"public".', '"test_invalid_owner_migration".')));
    }), postgresFailure("23503", "learning_note_session_owner"));
    assert.equal((await databases().records.execute(sql`select 1 from pg_namespace where nspname='test_invalid_owner_migration'`)).rowCount, 0);
  });

  it("refuses to merge contradictory legacy live-source and deletion states", async () => {
    const id = randomUUID(), userId = randomUUID();
    await assert.rejects(databases().temporary.transaction(async tx => {
      await tx.execute(sql`create schema test_invalid_source_migration`);
      await tx.execute(sql`set local search_path to test_invalid_source_migration`);
      await tx.execute(sql.raw(readFileSync("drizzle/transcripts/0000_mysterious_shape.sql", "utf8").replaceAll('"public".', '"test_invalid_source_migration".')));
      await tx.execute(sql.raw(readFileSync("drizzle/transcripts/0001_strong_warpath.sql", "utf8")));
      await tx.execute(sql`insert into transcript_sessions(session_id,user_id,version,digest,payload) values (${id},${userId},0,'synthetic','{}')`);
      await tx.execute(sql`insert into transcript_lifecycle(session_id,user_id,deleted_at,deletion_reason) values (${id},${userId},clock_timestamp(),'note_saved')`);
      await tx.execute(sql.raw(readFileSync("drizzle/transcripts/0002_clear_session_state.sql", "utf8").replaceAll('"public".', '"test_invalid_source_migration".')));
    }), postgresFailure("P0001", "TRANSCRIPT_STATE_CONFLICT"));
    assert.equal((await databases().temporary.execute(sql`select 1 from pg_namespace where nspname='test_invalid_source_migration'`)).rowCount, 0);
  });

  it("refuses to discard legacy source content that has no matching saved snapshot", async () => {
    const id = randomUUID(), userId = randomUUID();
    await assert.rejects(databases().temporary.transaction(async tx => {
      await tx.execute(sql`create schema test_unpreserved_source_migration`);
      await tx.execute(sql`set local search_path to test_unpreserved_source_migration`);
      await tx.execute(sql.raw(readFileSync("drizzle/transcripts/0000_mysterious_shape.sql", "utf8").replaceAll('"public".', '"test_unpreserved_source_migration".')));
      await tx.execute(sql`insert into transcript_sessions(session_id,user_id,version,digest,payload) values (${id},${userId},1,'synthetic-legacy-hash',${JSON.stringify(record())}::jsonb)`);
      await tx.execute(sql.raw(readFileSync("drizzle/transcripts/0001_strong_warpath.sql", "utf8")));
      await tx.execute(sql.raw(readFileSync("drizzle/transcripts/0002_clear_session_state.sql", "utf8").replaceAll('"public".', '"test_unpreserved_source_migration".')));
    }), postgresFailure("P0001", "TRANSCRIPT_INITIAL_CONTENT_NOT_PRESERVED"));
    assert.equal((await databases().temporary.execute(sql`select 1 from pg_namespace where nspname='test_unpreserved_source_migration'`)).rowCount, 0);
  });

  it("does not create accounts on request/preview, stores hashes, consumes a link exactly once concurrently", async () => {
    await requestLink("learner@example.test", "login", undefined, capture);
    const link = secret();
    assert.equal((await databases().records.select().from(users)).length, 0);
    assert.equal((await inspectLink(link)).email, "learner@example.test");
    await inspectLink(link);
    const rows = await databases().records.select().from(emailAuthRequests);
    assert.equal(rows[0].authLinkTokenHash, digest(link));
    assert.equal(JSON.stringify(rows).includes(link), false);
    const results = await Promise.allSettled([consumeLink(link), consumeLink(link)]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal((await databases().records.select().from(loginSessions)).length, 1);
  });
  it("serializes simultaneous issuance and revokes older unused links; no mail retry on failure", async () => {
    const results = await Promise.allSettled([requestLink("a@example.test", "login", undefined, capture), requestLink("a@example.test", "login", undefined, capture)]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    const old = secret();
    await databases().records.update(emailAuthRateLimits).set({ lastAuthEmailRequestedAt: new Date(Date.now() - 31_000) });
    let attempts = 0;
    await requestLink("a@example.test", "login", undefined, async () => { attempts++; throw new Error("PRIVATE_SMTP_BODY"); });
    assert.equal(attempts, 1);
    await assert.rejects(consumeLink(old), /REPLACED_LINK/);
    const rows = await databases().records.select().from(emailAuthRequests);
    assert.equal(rows.some(r => r.emailSendStatus === "failed_or_unknown"), true);
    assert.equal(JSON.stringify(rows).includes("PRIVATE_SMTP_BODY"), false);
  });
  it("rejects expiration, refreshes only valid sessions and never resurrects logout", async () => {
    const raw = await login();
    await withIdentity(raw, async (_tx, who) => assert.ok(who.expiresAt.getTime() > Date.now() + 29 * 86_400_000));
    await logout(raw);
    await assert.rejects(withIdentity(raw, async () => {}), /LOGIN_REQUIRED/);
    await databases().records.update(emailAuthRequests).set({ authLinkUsedAt: null, authLinkExpiresAt: new Date(Date.now() - 1) });
    await assert.rejects(consumeLink(secret()), /EXPIRED_LINK/);
  });
  it("does not replace a different logged-in account when confirming a link", async () => {
    const raw = await login("a@example.test");
    await requestLink("b@example.test", "login", undefined, capture);
    await assert.rejects(consumeLink(secret(), raw), /LOGOUT_FIRST/);
    assert.equal((await withIdentity(raw, async (_tx, who) => who.email)), "a@example.test");
  });
  it("enforces one connection, isolated ownership and idempotent/save-sequence-conflict saves", async () => {
    const raw = await login(), b = await login("b@example.test");
    const s = await startLearning(raw, "conversation");
    await assert.rejects(startLearning(raw, "conversation"), /ALREADY_CONNECTED/);
    await saveLearning(raw, s.id, s.secret, 1, record());
    await saveLearning(raw, s.id, s.secret, 1, record());
    await assert.rejects(saveLearning(raw, s.id, s.secret, 1, record("changed")), /SAVE_SEQUENCE_CONFLICT/);
    await assert.rejects(saveLearning(b, s.id, s.secret, 2, record()), /NOT_FOUND/);
    assert.equal((await listRecords(b)).sessions.length, 0);
    await heartbeat(raw, s.id, s.secret, true);
    const restored = await startLearning(raw, "conversation");
    assert.equal(restored.confirmedSaveSequenceNumber, 1);
    assert.equal(restored.conversationSnapshot.turns[0].text, record().turns[0].text);
    await assert.rejects(saveLearning(raw, s.id, s.secret, 2, record()), /CONNECTION_EXPIRED/);
  });
  it("keeps acknowledged history when the client window loses old turns and ignores unacknowledged saves on resume", async () => {
    const raw = await login(), s = await startLearning(raw, "conversation");
    await saveLearning(raw, s.id, s.secret, 1, record("old confirmed"));
    const recent = { learning: "conversation", gaps: false, corrections: [], turns: [{ id: "user-2", requestId: "request-2", role: "user", text: "recent confirmed" }] };
    await saveLearning(raw, s.id, s.secret, 2, recent);
    await databases().temporary.insert(transcriptSaves).values({ learningSessionId: s.id, saveSequenceNumber: 3, snapshotHash: "unconfirmed", conversationSnapshot: record("must not restore") });
    await heartbeat(raw, s.id, s.secret, true);
    const restored = await startLearning(raw, "conversation");
    assert.deepEqual(restored.conversationSnapshot.turns.filter(t => t.role === "user").map(t => t.text), ["old confirmed", "recent confirmed"]);
  });
  it("preserves first end time, commits a bounded demo note before deleting source, rejects late writes", async () => {
    const raw = await login(), s = await startLearning(raw, "conversation");
    const [created] = await databases().temporary.select().from(transcriptSessionStates);
    assert.ok(created.transcriptStorageCreatedAt);
    assert.equal(created.firstNonemptySaveAt, null);
    assert.equal(created.sourceDeletedAt, null);
    await saveLearning(raw, s.id, s.secret, 1, record("x".repeat(1000)));
    const [stored] = await databases().temporary.select().from(transcriptSessionStates);
    assert.ok(stored.firstNonemptySaveAt! >= created.transcriptStorageCreatedAt!);
    await saveLearning(raw, s.id, s.secret, 1, record("x".repeat(1000)));
    assert.deepEqual((await databases().temporary.select().from(transcriptSessionStates))[0], stored);
    const end = await endLearning(raw, s.id, s.secret);
    assert.equal((await endLearning(raw, s.id, s.secret)).learningSessionEndedAt, end.learningSessionEndedAt);
    await finishNote(raw, s.id);
    assert.equal((await databases().temporary.select().from(transcriptSaves)).length, 0);
    assert.equal((await databases().temporary.select().from(transcriptSaves)).length, 0);
    const [deleted] = await databases().temporary.select().from(transcriptSessionStates);
    assert.ok(deleted.sourceDeletedAt! >= stored.firstNonemptySaveAt!);
    assert.equal(deleted.sourceDeletionReason, "note_saved");
    assert.equal(JSON.stringify(deleted).includes("x".repeat(100)), false);
    await finishNote(raw, s.id);
    assert.equal((await maintenance()).failures, 0);
    assert.deepEqual((await databases().temporary.select().from(transcriptSessionStates))[0], deleted);
    const saved = await databases().records.select().from(learningSessionNotes);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].noteMarkdown.includes("x".repeat(161)), false);
    await assert.rejects(saveLearning(raw, s.id, s.secret, 2, record()), /CONNECTION_EXPIRED/);
  });
  it("rolls back source deletion if recording completion fails, then retries without inventing missing-source history", async () => {
    const raw = await login(), s = await startLearning(raw, "conversation");
    await saveLearning(raw, s.id, s.secret, 1, record());
    await endLearning(raw, s.id, s.secret);
    await databases().temporary.execute(sql`create function reject_test_deletion_audit() returns trigger language plpgsql as $$ begin if NEW.source_deleted_at is not null then raise exception 'SIMULATED_AUDIT_FAILURE'; end if; return NEW; end $$`);
    await databases().temporary.execute(sql`create trigger reject_test_deletion_audit before update on transcript_session_states for each row execute function reject_test_deletion_audit()`);
    try { await assert.rejects(finishNote(raw, s.id)); }
    finally {
      await databases().temporary.execute(sql`drop trigger reject_test_deletion_audit on transcript_session_states`);
      await databases().temporary.execute(sql`drop function reject_test_deletion_audit()`);
    }
    assert.equal((await databases().records.select().from(learningSessionNotes)).length, 1);
    assert.equal((await databases().temporary.select().from(transcriptSaves)).length, 2);
    assert.equal((await databases().temporary.select().from(transcriptSaves)).length, 2);
    assert.equal((await databases().temporary.select().from(transcriptSessionStates))[0].sourceDeletedAt, null);
    assert.equal((await maintenance()).failures, 0);
    assert.equal((await databases().temporary.select().from(transcriptSaves)).length, 0);
    assert.equal((await databases().temporary.select().from(transcriptSessionStates))[0].sourceDeletionReason, "note_saved");
    const missing = randomUUID();
    await deleteTranscriptSource(missing, "deadline_expired");
    assert.equal((await databases().temporary.select().from(transcriptSessionStates).where(eq(transcriptSessionStates.learningSessionId, missing))).length, 0);
  });
  it("keeps unknown legacy creation and first-save times unknown after later writes", async () => {
    const raw = await login(), s = await startLearning(raw, "conversation");
    await databases().temporary.update(transcriptSessionStates).set({ transcriptStorageCreatedAt: null });
    await saveLearning(raw, s.id, s.secret, 1, record());
    await endLearning(raw, s.id, s.secret);
    await finishNote(raw, s.id);
    const [legacy] = await databases().temporary.select().from(transcriptSessionStates);
    assert.equal(legacy.transcriptStorageCreatedAt, null);
    assert.equal(legacy.firstNonemptySaveAt, null);
    assert.ok(legacy.sourceDeletedAt);
    assert.equal(legacy.sourceDeletionReason, "note_saved");
  });
  it("recovers a temporary-only commit without losing acknowledged state or duplicating the retried save", async () => {
    const raw = await login(), s = await startLearning(raw, "conversation");
    await saveLearning(raw, s.id, s.secret, 1, record());
    const next = { ...record(), turns: [...record().turns, { id: "user-2", requestId: "request-2", role: "user", text: "new synthetic answer" }] };
    await databases().records.execute(sql`create function reject_test_confirmation() returns trigger language plpgsql as $$ begin if NEW.confirmed_save_sequence_number = 2 then raise exception 'SIMULATED_CONFIRM_FAILURE'; end if; return NEW; end $$`);
    await databases().records.execute(sql`create trigger reject_test_confirmation before update on learning_sessions for each row execute function reject_test_confirmation()`);
    try { await assert.rejects(saveLearning(raw, s.id, s.secret, 2, next)); }
    finally {
      await databases().records.execute(sql`drop trigger reject_test_confirmation on learning_sessions`);
      await databases().records.execute(sql`drop function reject_test_confirmation()`);
    }
    assert.equal((await databases().records.select().from(learningSessions))[0].confirmedSaveSequenceNumber, 1);
    assert.equal((await databases().temporary.select().from(transcriptSaves)).some(v => v.saveSequenceNumber === 2), true);
    await heartbeat(raw, s.id, s.secret, true);
    const resumed = await startLearning(raw, "conversation");
    assert.equal(resumed.conversationSnapshot.turns.length, 2);
    await saveLearning(raw, s.id, resumed.secret, 2, next);
    assert.equal((await databases().temporary.select().from(transcriptSaves)).filter(v => v.saveSequenceNumber === 2).length, 1);
  });
  it("requires deletion recheck in the original session, blocks all sessions immediately and removes source on maintenance", async () => {
    const a = await login(), s = await startLearning(a, "conversation");
    await saveLearning(a, s.id, s.secret, 1, record());
    await databases().records.update(emailAuthRateLimits).set({ lastAuthEmailRequestedAt: new Date(Date.now() - 31_000) });
    const b = await login();
    await databases().records.update(emailAuthRateLimits).set({ lastAuthEmailRequestedAt: new Date(Date.now() - 31_000) });
    await requestLink("learner@example.test", "account_deletion", a, capture);
    const link = secret();
    await assert.rejects(consumeLink(link, b), /ORIGINAL_BROWSER_REQUIRED/);
    await consumeLink(link, a);
    await deleteAccount(a);
    await assert.rejects(withIdentity(b, async () => {}), /LOGIN_REQUIRED/);
    await assert.rejects(saveLearning(a, s.id, s.secret, 2, record()), /LOGIN_REQUIRED/);
    await maintenance();
    assert.equal((await databases().records.select().from(users)).length, 0);
    assert.equal((await databases().temporary.select().from(transcriptSaves)).length, 0);
    assert.equal((await databases().temporary.select().from(transcriptSessionStates)).length, 0);
  });
  it("expires and consumes deletion authority independently of a valid login", async () => {
    const raw = await login();
    await databases().records.update(emailAuthRateLimits).set({ lastAuthEmailRequestedAt: new Date(Date.now() - 31_000) });
    await requestLink("learner@example.test", "account_deletion", raw, capture);
    const link = secret();
    await consumeLink(link, raw);
    const [authorized] = await databases().records.select().from(loginSessions);
    assert.ok(authorized.accountDeletionAuthorizationExpiresAt! > new Date());
    assert.equal(authorized.accountDeletionAuthorizationUsedAt, null);
    await assert.rejects(consumeLink(link, raw), /USED_LINK/);
    await databases().records.update(loginSessions).set({ accountDeletionAuthorizationExpiresAt: new Date(Date.now() - 1) });
    await assert.rejects(deleteAccount(raw), /CONFIRM_DELETE_FIRST/);
    await withIdentity(raw, async () => {});
    await databases().records.update(loginSessions).set({ accountDeletionAuthorizationExpiresAt: new Date(Date.now() - 86_400_001) });
    assert.equal((await maintenance()).failures, 0);
    const [cleaned] = await databases().records.select().from(loginSessions);
    assert.ok(cleaned);
    assert.equal(cleaned.accountDeletionAuthorizationExpiresAt, null);
    assert.equal(cleaned.accountDeletionAuthorizationUsedAt, null);
    await withIdentity(raw, async () => {});
    await databases().records.update(emailAuthRateLimits).set({ lastAuthEmailRequestedAt: new Date(Date.now() - 31_000) });
    await requestLink("learner@example.test", "account_deletion", raw, capture);
    await consumeLink(secret(), raw);
    await databases().records.update(loginSessions).set({ accountDeletionAuthorizationUsedAt: new Date() });
    await assert.rejects(deleteAccount(raw), /CONFIRM_DELETE_FIRST/);
    await invalidateRestoredAuthentication();
    assert.equal((await databases().records.select().from(loginSessions)).length, 0);
  });

  it("serializes deletion against a concurrent save and retains a tombstone that blocks later writes", async () => {
    const raw = await login(), s = await startLearning(raw, "conversation");
    await saveLearning(raw, s.id, s.secret, 1, record());
    const results = await Promise.allSettled([
      deleteTranscriptSource(s.id, "deadline_expired"),
      saveLearning(raw, s.id, s.secret, 2, record()),
    ]);
    assert.equal(results[0].status, "fulfilled");
    if (results[1].status === "rejected") assert.match(results[1].reason.message, /SESSION_CLOSED/);
    assert.equal((await databases().temporary.select().from(transcriptSaves)).length, 0);
    const [deleted] = await databases().temporary.select().from(transcriptSessionStates);
    assert.ok(deleted.sourceDeletedAt);
    await assert.rejects(saveLearning(raw, s.id, s.secret, 2, record()), /SESSION_CLOSED/);
    await deleteTranscriptSource(s.id, "note_saved");
    assert.deepEqual((await databases().temporary.select().from(transcriptSessionStates))[0], deleted);
  });

  it("rejects mismatched owners, duplicate account jobs and invalid state values in the database", async () => {
    const raw = await login(), other = await login("other@example.test"), s = await startLearning(raw, "conversation");
    const otherUserId = await withIdentity(other, async (_tx, who) => who.userId);
    const userId = await withIdentity(raw, async (_tx, who) => who.userId);
    await assert.rejects(databases().records.insert(learningSessionNotes).values({ learningSessionId: s.id, userId: otherUserId, learningEndDateKst: "2026-10-25", noteMarkdown: "Synthetic", noteRetentionExpiresAt: new Date() }), postgresFailure("23503", "learning_note_session_owner"));
    await assert.rejects(databases().records.insert(scheduledJobs).values({ targetUserId: otherUserId, targetLearningSessionId: s.id, jobType: "note", scheduledRunAt: new Date() }), postgresFailure("23503", "scheduled_job_session_owner"));
    await databases().records.insert(scheduledJobs).values({ targetUserId: userId, jobType: "delete_account", scheduledRunAt: new Date() });
    await assert.rejects(databases().records.insert(scheduledJobs).values({ targetUserId: userId, jobType: "delete_account", scheduledRunAt: new Date() }), postgresFailure("23505", "scheduled_account_job_target"));
    await assert.rejects(databases().records.update(learningSessions).set({ learningSessionStatus: "unknown" }), postgresFailure("23514", "learning_session_status"));
    await assert.rejects(databases().records.update(learningSessions).set({ confirmedSaveSequenceNumber: -1 }), postgresFailure("23514", "confirmed_save_sequence_nonnegative"));
    await assert.rejects(databases().temporary.update(transcriptSessionStates).set({ sourceDeletedAt: new Date() }), postgresFailure("23514", "transcript_source_deletion_pair"));
    await assert.rejects(databases().temporary.update(transcriptSaves).set({ saveSequenceNumber: -1 }), postgresFailure("23514", "transcript_save_sequence_nonnegative"));
  });

  it("auto-closes after interruption, does not generate empty notes and removes expired source on the original deadline", async () => {
    const raw = await login(), s = await startLearning(raw, "conversation");
    await databases().records.update(learningSessions).set({ learningSessionStatus: "interrupted", learningSessionInterruptedAt: new Date(Date.now() - 86_400_001) });
    await maintenance();
    const [closed] = await databases().records.select().from(learningSessions);
    assert.equal(closed.learningSessionStatus, "ended"); assert.equal(closed.noteGenerationStatus, "empty");
    assert.equal((await databases().records.select().from(learningSessionNotes)).length, 0);
    assert.equal((await databases().temporary.select().from(transcriptSaves)).length, 0);
    assert.ok(closed.transcriptDeleteDeadlineAt!.getTime() - closed.learningSessionEndedAt!.getTime() === 86_400_000);
    const [lifecycle] = await databases().temporary.select().from(transcriptSessionStates);
    assert.ok(lifecycle.transcriptStorageCreatedAt);
    assert.equal(lifecycle.firstNonemptySaveAt, null);
    assert.ok(lifecycle.sourceDeletedAt);
    assert.equal(lifecycle.sourceDeletionReason, "no_user_turns");
  });
  it("invalidates restored auth while ordinary reconnection keeps it; deletes expired authentication after 24 hours", async () => {
    const raw = await login();
    await closeDatabases();
    await withIdentity(raw, async () => {});
    await databases().records.update(loginSessions).set({ loginSessionInvalidatedAt: new Date(Date.now() - 86_400_001) });
    await maintenance();
    assert.equal((await databases().records.select().from(loginSessions)).length, 0);
    await invalidateRestoredAuthentication();
    assert.equal((await databases().records.select().from(emailAuthRequests)).length, 0);
    await assert.rejects(withIdentity(raw, async () => {}), /LOGIN_REQUIRED/);
  });
  it("keeps final-save retries alive while the browser is connected, then deletes source at the first end deadline", async () => {
    const raw = await login(), s = await startLearning(raw, "conversation");
    await saveLearning(raw, s.id, s.secret, 1, record());
    await endLearning(raw, s.id, s.secret);
    await databases().records.update(scheduledJobs).set({ scheduledRunAt: new Date(Date.now() - 60_000) });
    await maintenance();
    assert.equal((await databases().records.select().from(learningSessions))[0].noteGenerationStatus, "waiting_save");
    assert.equal((await databases().temporary.select().from(transcriptSaves)).length, 2);
    await databases().records.update(learningSessions).set({ learningConnectionExpiresAt: new Date(Date.now() - 60_000) });
    await heartbeat(raw, s.id, s.secret); // Closing retry owner can reconnect until its original erase deadline.
    await databases().records.update(learningSessions).set({ transcriptDeleteDeadlineAt: new Date(Date.now() - 1) });
    await assert.rejects(saveLearning(raw, s.id, s.secret, 2, record()), /SESSION_CLOSED/);
    await maintenance();
    assert.equal((await databases().temporary.select().from(transcriptSaves)).length, 0);
    assert.equal((await databases().records.select().from(learningSessions))[0].noteGenerationStatus, "expired");
    const [lifecycle] = await databases().temporary.select().from(transcriptSessionStates);
    assert.ok(lifecycle.firstNonemptySaveAt);
    assert.ok(lifecycle.sourceDeletedAt);
    assert.equal(lifecycle.sourceDeletionReason, "deadline_expired");
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
      assert.equal((await restored.select().from(loginSessions)).length, 1);
      assert.equal((await pool.query("select count(*) from information_schema.tables where table_name like 'transcript_%'")).rows[0].count, "0");
      await invalidateRestoredAuthentication(restored);
      assert.equal((await restored.select().from(loginSessions)).length, 0);
      assert.equal((await restored.select().from(emailAuthRequests)).length, 0);
    } finally {
      if (pool) await pool.end();
      await databases().recordsPool.query(`DROP DATABASE IF EXISTS ${restoreName} WITH (FORCE)`);
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
