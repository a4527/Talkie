import { buildVoiceNoteMarkdown } from "../src/voice/note";
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { databases, closeDatabases } from "../src/server/db";
import { loginSessions, emailAuthRequests, emailAuthRateLimits, scheduledJobs, learningSessions, learningSessionNotes, users } from "../src/server/db/records-schema";
import { transcriptSessionStates, transcriptSaves } from "../src/server/db/transcripts-schema";
import { deleteTranscriptSource } from "../src/server/db/transcripts-lifecycle";
import { consumeLink, deleteAccount, dbNow, digest, inspectLink, logout, requestLink, withIdentity, type Mail } from "../src/server/auth";
import { endLearning, completeLearningNote, updateLearningHeartbeat, listLearningRecords, saveLearning, startLearning, getVoiceLearningContext, validateConversationSnapshot, encodeStoredConversationSnapshot } from "../src/server/learning";
import { invalidateRestoredAuthentication, maintenance } from "../src/server/maintenance";
import { completeGoogleAuth, unlinkGoogle, type GoogleOAuthState } from "../src/server/google-auth";
import { googleIdentities, learningSessionMissions, learningMissionResults, learningMissionResultDetails } from "../src/server/db/records-schema";
import { currentMission } from "../src/mission/definitions";
import { localDateIn } from "../src/mission/achievement";
import type { ExtractionGenerate } from "../src/voice/note-extraction";
import { priorLearningWindow } from "../src/voice/prior-learning";
import { boundRecords } from "../src/learning/buffer";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../src/server/db/records-schema";

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
  return result.loginSessionToken!;
}
const record = (text = "synthetic private transcript marker") => ({ learningState: "conversation", corrections: [],
  turns: [{ turnId: "user-1", requestId: "request-1", role: "user", text }, { turnId: "assistant-1", requestId: "request-1", role: "assistant", text: "What happened next?" }] });

describe("PostgreSQL authentication and isolated records", { concurrency: false }, () => {
  before(async () => {
    for (const name of ["DATABASE_URL", "TRANSCRIPT_DATABASE_URL"]) {
      assert.match(new URL(process.env[name] ?? "").pathname, /^\/talkie_test_/,
        "Use dedicated talkie_test_* databases; tests refuse ordinary databases.");
    }
    await migrate(databases().records, { migrationsFolder: "drizzle/records" });
    await migrate(databases().transcripts, { migrationsFolder: "drizzle/transcripts" });
  });
  beforeEach(async () => {
    mail.length = 0;
    await databases().records.execute(sql`truncate users, email_auth_rate_limits, email_auth_requests cascade`);
    await databases().transcripts.delete(transcriptSessionStates);
  });
  after(closeDatabases);

  it("migrates existing deadlines and sources without fabricating historical timestamps", async () => {
    const id = randomUUID(), userId = randomUUID(), loginSessionId = randomUUID(), deletedSourceId = randomUUID();
    const knownCreatedAt = new Date("2026-10-24T00:00:00Z");
    const knownDeletedAt = new Date("2026-10-24T01:00:00Z");
    const deadline = new Date("2026-10-25T00:00:00Z");
    await databases().transcripts.transaction(async tx => {
      await tx.execute(sql`create schema test_transcript_migration`);
      await tx.execute(sql`set local search_path to test_transcript_migration`);
      await tx.execute(sql.raw(readFileSync("drizzle/transcripts/0000_mysterious_shape.sql", "utf8").replaceAll('"public".', '"test_transcript_migration".')));
      await tx.execute(sql`insert into transcript_sessions (session_id, user_id, version, digest, payload, erase_at) values (${id}, ${userId}, 0, 'legacy', '{}', ${deadline.toISOString()})`);
      await tx.execute(sql.raw(readFileSync("drizzle/transcripts/0001_strong_warpath.sql", "utf8")));
      await tx.execute(sql`insert into transcript_versions(session_id,version,digest,payload) values (${id},2,'unchanged-snapshot-hash',${JSON.stringify(record())}::jsonb)`);
      await tx.execute(sql`insert into transcript_lifecycle(session_id,user_id,created_at,first_saved_at,deleted_at,deletion_reason) values (${deletedSourceId},${userId},${knownCreatedAt.toISOString()},${knownCreatedAt.toISOString()},${knownDeletedAt.toISOString()},'note_saved')`);
      await tx.execute(sql.raw(readFileSync("drizzle/transcripts/0002_clear_session_state.sql", "utf8").replaceAll('"public".', '"test_transcript_migration".')));
      await tx.execute(sql.raw(readFileSync("drizzle/transcripts/0003_discarded_unconfirmed_save.sql", "utf8")));
      assert.deepEqual((await tx.select().from(transcriptSessionStates).where(eq(transcriptSessionStates.learningSessionId, id)))[0].transcriptDeleteDeadlineAt, deadline);
      const [legacy] = await tx.select().from(transcriptSessionStates).where(eq(transcriptSessionStates.learningSessionId, id));
      assert.equal(legacy.learningSessionId, id);
      assert.equal(legacy.transcriptStorageCreatedAt, null);
      assert.equal(legacy.firstNonemptySaveAt, null);
      assert.equal(legacy.sourceDeletedAt, null);
      assert.equal(legacy.sourceDeletionReason, null);
      assert.equal(legacy.hasDiscardedUnconfirmedSave, false);
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
    await assert.rejects(databases().transcripts.transaction(async tx => {
      await tx.execute(sql`create schema test_invalid_source_migration`);
      await tx.execute(sql`set local search_path to test_invalid_source_migration`);
      await tx.execute(sql.raw(readFileSync("drizzle/transcripts/0000_mysterious_shape.sql", "utf8").replaceAll('"public".', '"test_invalid_source_migration".')));
      await tx.execute(sql.raw(readFileSync("drizzle/transcripts/0001_strong_warpath.sql", "utf8")));
      await tx.execute(sql`insert into transcript_sessions(session_id,user_id,version,digest,payload) values (${id},${userId},0,'synthetic','{}')`);
      await tx.execute(sql`insert into transcript_lifecycle(session_id,user_id,deleted_at,deletion_reason) values (${id},${userId},clock_timestamp(),'note_saved')`);
      await tx.execute(sql.raw(readFileSync("drizzle/transcripts/0002_clear_session_state.sql", "utf8").replaceAll('"public".', '"test_invalid_source_migration".')));
    }), postgresFailure("P0001", "TRANSCRIPT_STATE_CONFLICT"));
    assert.equal((await databases().transcripts.execute(sql`select 1 from pg_namespace where nspname='test_invalid_source_migration'`)).rowCount, 0);
  });

  it("refuses to discard legacy source content that has no matching saved snapshot", async () => {
    const id = randomUUID(), userId = randomUUID();
    await assert.rejects(databases().transcripts.transaction(async tx => {
      await tx.execute(sql`create schema test_unpreserved_source_migration`);
      await tx.execute(sql`set local search_path to test_unpreserved_source_migration`);
      await tx.execute(sql.raw(readFileSync("drizzle/transcripts/0000_mysterious_shape.sql", "utf8").replaceAll('"public".', '"test_unpreserved_source_migration".')));
      await tx.execute(sql`insert into transcript_sessions(session_id,user_id,version,digest,payload) values (${id},${userId},1,'synthetic-legacy-hash',${JSON.stringify(record())}::jsonb)`);
      await tx.execute(sql.raw(readFileSync("drizzle/transcripts/0001_strong_warpath.sql", "utf8")));
      await tx.execute(sql.raw(readFileSync("drizzle/transcripts/0002_clear_session_state.sql", "utf8").replaceAll('"public".', '"test_unpreserved_source_migration".')));
    }), postgresFailure("P0001", "TRANSCRIPT_INITIAL_CONTENT_NOT_PRESERVED"));
    assert.equal((await databases().transcripts.execute(sql`select 1 from pg_namespace where nspname='test_unpreserved_source_migration'`)).rowCount, 0);
  });

  it("does not create accounts on request/preview, stores hashes, consumes a link exactly once concurrently", async () => {
    await requestLink("learner@example.test", "login", undefined, capture);
    const link = secret();
    assert.equal((await databases().records.select().from(users)).length, 0);
    assert.equal((await inspectLink(link)).emailAddress, "learner@example.test");
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
    assert.equal((await withIdentity(raw, async (_tx, who) => who.emailAddress)), "a@example.test");
  });
  it("applies Google identities with explicit linking only, Google reauthentication and guarded unlinking (DEC-067)", async () => {
    const flow = (purpose: GoogleOAuthState["purpose"], loginSessionId?: string): GoogleOAuthState => ({ purpose, state: "s".repeat(43), nonce: "n".repeat(43), codeVerifier: "v".repeat(43), loginSessionId });
    const sessionId = (raw: string) => withIdentity(raw, async (_tx, who) => who.loginSessionId);
    // A new verified Google user gets a new account with the Google email.
    const created = await completeGoogleAuth(flow("login"), { sub: "google-sub-new", email: "New.Person@Gmail.COM", email_verified: true }, undefined);
    assert.ok("loginSessionToken" in created);
    assert.equal(await withIdentity(created.loginSessionToken, async (_tx, who) => who.emailAddress), "New.Person@gmail.com");
    const again = await completeGoogleAuth(flow("login"), { sub: "google-sub-new", email: "changed@gmail.com", email_verified: true }, undefined);
    assert.equal(await withIdentity((again as { loginSessionToken: string }).loginSessionToken, async (_tx, who) => who.emailAddress), "New.Person@gmail.com");
    // Unverified emails never create accounts.
    await assert.rejects(completeGoogleAuth(flow("login"), { sub: "google-sub-unverified", email: "x@gmail.com", email_verified: false }, undefined), /GOOGLE_EMAIL_UNVERIFIED/);
    // Same email as an email-link account: refused, not merged.
    const emailUser = await login("linker@example.test");
    await assert.rejects(completeGoogleAuth(flow("login"), { sub: "google-sub-linker", email: "linker@example.test", email_verified: true }, undefined), /GOOGLE_EMAIL_IN_USE/);
    assert.equal((await databases().records.select().from(googleIdentities).where(eq(googleIdentities.googleSubject, "google-sub-linker"))).length, 0);
    // Linking requires the session that started the flow.
    await assert.rejects(completeGoogleAuth(flow("link", randomUUID()), { sub: "google-sub-linker", email: "linker@gmail.com", email_verified: true }, emailUser), /ORIGINAL_BROWSER_REQUIRED/);
    await completeGoogleAuth(flow("link", await sessionId(emailUser)), { sub: "google-sub-linker", email: "linker@gmail.com", email_verified: true }, emailUser);
    const viaGoogle = await completeGoogleAuth(flow("login"), { sub: "google-sub-linker", email: "linker@gmail.com", email_verified: true }, undefined);
    assert.equal(await withIdentity((viaGoogle as { loginSessionToken: string }).loginSessionToken, async (_tx, who) => who.emailAddress), "linker@example.test");
    await assert.rejects(completeGoogleAuth(flow("link", await sessionId(emailUser)), { sub: "google-sub-other", email: "o@gmail.com", email_verified: true }, emailUser), /GOOGLE_ALREADY_LINKED/);
    await assert.rejects(completeGoogleAuth(flow("login"), { sub: "google-sub-new", email: "New.Person@gmail.com", email_verified: true }, emailUser), /LOGOUT_FIRST/);
    // Google-only accounts keep their only login method; email-capable accounts may unlink.
    await assert.rejects(unlinkGoogle(created.loginSessionToken), /GOOGLE_ONLY_ACCOUNT/);
    // Reauthentication must match the linked subject, then grants the usual 10-minute deletion authority.
    await assert.rejects(completeGoogleAuth(flow("reauth", await sessionId(created.loginSessionToken)), { sub: "google-sub-linker", email: "linker@gmail.com", email_verified: true }, created.loginSessionToken), /GOOGLE_REAUTH_MISMATCH/);
    await assert.rejects(deleteAccount(created.loginSessionToken), /CONFIRM_DELETE_FIRST/);
    await completeGoogleAuth(flow("reauth", await sessionId(created.loginSessionToken)), { sub: "google-sub-new", email: "New.Person@gmail.com", email_verified: true }, created.loginSessionToken);
    await deleteAccount(created.loginSessionToken);
    await assert.rejects(completeGoogleAuth(flow("login"), { sub: "google-sub-new", email: "New.Person@gmail.com", email_verified: true }, undefined), /GOOGLE_ACCOUNT_UNAVAILABLE/);
    await unlinkGoogle(emailUser);
    assert.equal((await databases().records.select().from(googleIdentities).where(eq(googleIdentities.googleSubject, "google-sub-linker"))).length, 0);
  });
  it("stores and resumes voice evidence, isolates its connection and finalizes a voice note", async () => {
    const oldTest = process.env.TALKIE_VOICE_TEST, oldFree = process.env.GEMINI_FREE_TIER_CONFIRMED, oldKey = process.env.GOOGLE_API_KEY;
    process.env.TALKIE_VOICE_TEST = "gemini-free"; process.env.GEMINI_FREE_TIER_CONFIRMED = "true"; process.env.GOOGLE_API_KEY = "synthetic";
    try {
      const raw = await login(), other = await login("other@example.test");
      const session = await startLearning(raw, "voice");
      await getVoiceLearningContext(raw, session.learningSessionId, session.learningConnectionToken);
      await assert.rejects(getVoiceLearningContext(other, session.learningSessionId, session.learningConnectionToken), /NOT_FOUND/);
      await assert.rejects(getVoiceLearningContext(raw, session.learningSessionId, "wrong"), /CONNECTION_EXPIRED/);
      const snapshot = { ...record("I go yesterday."), learningState: "retry", corrections: [{ correctionId: "c1", sourceTurnId: "user-1", deliveredTurnId: "assistant-1", replacement: "What happened next?", explanation: "Synthetic test correction", attempts: [] }] };
      await saveLearning(raw, session.learningSessionId, session.learningConnectionToken, 1, snapshot);
      await updateLearningHeartbeat(raw, session.learningSessionId, session.learningConnectionToken, true);
      await assert.rejects(startLearning(raw, "conversation"), /LEARNING_MODE_CONFLICT/);
      const resumed = await startLearning(raw, "voice");
      assert.equal(resumed.conversationSnapshot.learningState, "retry");
      assert.equal(resumed.conversationSnapshot.corrections.length, 1);
      await assert.rejects(getVoiceLearningContext(raw, session.learningSessionId, session.learningConnectionToken), /CONNECTION_EXPIRED/);
      await endLearning(raw, resumed.learningSessionId, resumed.learningConnectionToken);
      let attempts = 0;
      const down: ExtractionGenerate = async () => { attempts++; throw new Error("provider down"); };
      await assert.rejects(completeLearningNote(raw, resumed.learningSessionId, { generate: down }), /NOTE_PENDING/);
      assert.ok(attempts > 0);
      assert.equal((await listLearningRecords(raw)).notes.length, 0, "no fallback note when the model fails");
      const emptyReply: ExtractionGenerate = async () => JSON.stringify({ contextItems: [], detailItems: [] });
      await assert.rejects(completeLearningNote(raw, resumed.learningSessionId, { generate: emptyReply }), /NOTE_PENDING/);
      assert.equal((await listLearningRecords(raw)).notes.length, 0, "an empty model result must not complete a note");
      let savedDuringExtraction = false;
      const staleReply: ExtractionGenerate = async () => {
        if (!savedDuringExtraction) {
          savedDuringExtraction = true;
          await saveLearning(raw, resumed.learningSessionId, resumed.learningConnectionToken, 2, {
            ...snapshot, turns: [{ turnId: "user-2", requestId: "request-2", role: "user", text: "A final saved turn." }], corrections: [],
          });
        }
        return JSON.stringify({ contextItems: [], detailItems: [{ kind: "summary", text: "Old input only", evidence: [{ turnId: "user-1", role: "user", text: "I go yesterday." }] }] });
      };
      await assert.rejects(completeLearningNote(raw, resumed.learningSessionId, { generate: staleReply }), /NOTE_PENDING/);
      assert.equal((await listLearningRecords(raw)).notes.length, 0, "a save during extraction must not finalize an outdated note");
      const reply: ExtractionGenerate = async () => JSON.stringify({ contextItems: [], detailItems: [{ kind: "summary", text: "Past tense practice", evidence: [{ turnId: "user-1", role: "user", text: "I go yesterday." }] }] });
      await completeLearningNote(raw, resumed.learningSessionId, { generate: reply });
      const notes = (await listLearningRecords(raw)).notes;
      assert.equal(notes.length, 1); assert.match(notes[0].noteMarkdown, /비공개 음성 통합 시험/);
      assert.match(notes[0].noteMarkdown, /Past tense practice/);
      assert.match(notes[0].noteMarkdown, /A final saved turn/);
      assert.match(notes[0].noteMarkdown, /Synthetic test correction/);
      assert.equal((await databases().transcripts.select().from(transcriptSaves)).length, 0);
      const next = await startLearning(raw, "voice");
      assert.equal(next.conversationSnapshot.learningState, "conversation");
      assert.equal(next.conversationSnapshot.turns.length, 0);
      assert.deepEqual((await getVoiceLearningContext(raw, next.learningSessionId, next.learningConnectionToken)).priorLearningContext.reviewExpressions,
        [{ expression: "What happened next?", observations: ["추천"] }]);
      const otherSession = await startLearning(other, "voice");
      assert.deepEqual((await getVoiceLearningContext(other, otherSession.learningSessionId, otherSession.learningConnectionToken)).priorLearningContext.reviewExpressions, []);
      await databases().records.update(learningSessionNotes).set({ noteRetentionExpiresAt: new Date("2000-01-01T00:00:00Z") }).where(eq(learningSessionNotes.learningSessionId, resumed.learningSessionId));
      assert.deepEqual((await getVoiceLearningContext(raw, next.learningSessionId, next.learningConnectionToken)).priorLearningContext.reviewExpressions, []);
      const { now, userId } = await withIdentity(raw, async (tx, who) => ({ now: await dbNow(tx), userId: who.userId }));
      const { fromDateKst, toDateKst } = priorLearningWindow(now);
      const before = new Date(fromDateKst + "T00:00:00Z"); before.setUTCDate(before.getUTCDate() - 1);
      const future = new Date(toDateKst + "T00:00:00Z"); future.setUTCDate(future.getUTCDate() + 1);
      for (const [date, expression] of [[before.toISOString().slice(0, 10), "Outside window."], [fromDateKst, "At boundary."], [future.toISOString().slice(0, 10), "Future note."]]) {
        const learningSessionId = randomUUID(), endedAt = new Date(date + "T00:00:00Z");
        await databases().records.insert(learningSessions).values({ learningSessionId, userId, learningSessionStartedAt: endedAt, learningSessionEndedAt: endedAt,
          learningSessionStatus: "ended", demoScenario: "voice", noteGenerationStatus: "ready" });
        await databases().records.insert(learningSessionNotes).values({ learningSessionId, userId, learningEndDateKst: date,
          noteMarkdown: notes[0].noteMarkdown.replaceAll("What happened next?", expression), noteRetentionExpiresAt: new Date(now.getTime() + 86400000) });
      }
      assert.deepEqual((await getVoiceLearningContext(raw, next.learningSessionId, next.learningConnectionToken)).priorLearningContext.reviewExpressions,
        [{ expression: "At boundary.", observations: ["추천"] }]);
      assert.equal((await listLearningRecords(raw)).notes.length, 3, "Context window must not hide or delete retained notes");
    } finally {
      for (const [key, value] of Object.entries({ TALKIE_VOICE_TEST: oldTest, GEMINI_FREE_TIER_CONFIRMED: oldFree, GOOGLE_API_KEY: oldKey })) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
  it("fixes a mission at start, resumes stored values and never mixes mission and free sessions", async () => {
    const oldTest = process.env.TALKIE_VOICE_TEST, oldFree = process.env.GEMINI_FREE_TIER_CONFIRMED, oldKey = process.env.GOOGLE_API_KEY;
    process.env.TALKIE_VOICE_TEST = "gemini-free"; process.env.GEMINI_FREE_TIER_CONFIRMED = "true"; process.env.GOOGLE_API_KEY = "synthetic";
    try {
      const raw = await login(), other = await login("other@example.test");
      await assert.rejects(startLearning(raw, "voice", { missionId: "unknown-mission", missionMode: "practice", languageLevel: "B1" }), /INVALID_MISSION/);
      await assert.rejects(startLearning(raw, "correction", { missionId: "cafe-wrong-order", missionMode: "practice", languageLevel: "B1" }), /INVALID_REQUEST/);
      assert.equal((await listLearningRecords(raw)).sessions.length, 0, "Rejected starts must not create a session");
      const started = await startLearning(raw, "voice", { missionId: "cafe-wrong-order", missionMode: "real", languageLevel: "B2" });
      assert.equal(started.demoScenario, "voice");
      assert.deepEqual({ ...started.mission, goals: undefined, title: undefined, situation: undefined, learnerRole: undefined, partnerRole: undefined },
        { missionId: "cafe-wrong-order", definitionVersion: 1, rubricVersion: 1, missionMode: "real", languageLevel: "B2", goals: undefined, title: undefined, situation: undefined, learnerRole: undefined, partnerRole: undefined, routeIds: ["remake", "refund"] });
      assert.ok(!JSON.stringify(started.mission).includes("A different staff member"), "Partner knowledge must not reach the browser");
      await assert.rejects(startLearning(raw, "voice", { missionId: "cafe-wrong-order", missionMode: "practice", languageLevel: "A1" }), /ALREADY_CONNECTED/);
      await updateLearningHeartbeat(raw, started.learningSessionId, started.learningConnectionToken, true);
      // Resume ignores the new request values and returns what was fixed at start.
      const resumed = await startLearning(raw, "voice", { missionId: "cafe-wrong-order", missionMode: "practice", languageLevel: "A1" });
      assert.equal(resumed.learningSessionId, started.learningSessionId);
      assert.equal(resumed.mission?.missionMode, "real"); assert.equal(resumed.mission?.languageLevel, "B2");
      // The realtime connection reads the fixed definition on the server (partner knowledge stays server-side).
      const voiceContext = await getVoiceLearningContext(raw, resumed.learningSessionId, resumed.learningConnectionToken);
      assert.deepEqual([voiceContext.mission?.definition.missionId, voiceContext.mission?.definition.definitionVersion, voiceContext.mission?.missionMode, voiceContext.mission?.languageLevel], ["cafe-wrong-order", 1, "real", "B2"]);
      await updateLearningHeartbeat(raw, resumed.learningSessionId, resumed.learningConnectionToken, true);
      await assert.rejects(startLearning(raw, "voice"), /LEARNING_MODE_CONFLICT/, "A free voice start must not resume a mission");
      const [stored] = await databases().records.select().from(learningSessionMissions).where(eq(learningSessionMissions.learningSessionId, started.learningSessionId));
      assert.deepEqual([stored.missionMode, stored.languageLevel, stored.definitionVersion, stored.rubricVersion, stored.missionEndReason], ["real", "B2", 1, 1, null]);
      const listed = (await listLearningRecords(raw)).sessions[0].mission;
      assert.deepEqual(listed, { missionId: "cafe-wrong-order", definitionVersion: 1, rubricVersion: 1, missionMode: "real", languageLevel: "B2", missionEndReason: null, finalRouteId: null });
      // A free voice session stays free: a mission start must not convert it.
      const free = await startLearning(other, "voice");
      assert.equal((await getVoiceLearningContext(other, free.learningSessionId, free.learningConnectionToken)).mission, undefined);
      await updateLearningHeartbeat(other, free.learningSessionId, free.learningConnectionToken, true);
      await assert.rejects(startLearning(other, "voice", { missionId: "cafe-wrong-order", missionMode: "practice", languageLevel: "B1" }), /LEARNING_MODE_CONFLICT/);
      assert.equal(free.mission, null);
      assert.equal((await listLearningRecords(other)).sessions[0].mission, null);
      await assert.rejects(databases().records.insert(learningSessionMissions).values({ learningSessionId: free.learningSessionId, userId: stored.userId, missionId: "cafe-wrong-order", definitionVersion: 1, rubricVersion: 1, missionMode: "practice", languageLevel: "B1" }),
        postgresFailure("23503", "learning_mission_session_owner"), "Mission rows must belong to the session owner");
      await assert.rejects(databases().records.update(learningSessionMissions).set({ missionMode: "casual" }).where(eq(learningSessionMissions.learningSessionId, started.learningSessionId)),
        postgresFailure("23514", "learning_mission_mode"));
    } finally {
      for (const [key, value] of Object.entries({ TALKIE_VOICE_TEST: oldTest, GEMINI_FREE_TIER_CONFIRMED: oldFree, GOOGLE_API_KEY: oldKey })) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
  it("confirms mission progress with the save sequence, merges route events and restarts no-progress on resume", async () => {
    const oldTest = process.env.TALKIE_VOICE_TEST, oldFree = process.env.GEMINI_FREE_TIER_CONFIRMED, oldKey = process.env.GOOGLE_API_KEY;
    process.env.TALKIE_VOICE_TEST = "gemini-free"; process.env.GEMINI_FREE_TIER_CONFIRMED = "true"; process.env.GOOGLE_API_KEY = "synthetic";
    try {
      const raw = await login(), other = await login("other@example.test");
      const s = await startLearning(raw, "voice", { missionId: "cafe-wrong-order", missionMode: "real", languageLevel: "B1" });
      const turns = [{ turnId: "u1", requestId: "u1", role: "user", text: "I ordered a hot decaf." }, { turnId: "a1", requestId: "u1", role: "assistant", text: "I can remake it or refund it." },
        { turnId: "u2", requestId: "u2", role: "user", text: "A remake, please." }];
      const proposed = { eventId: "e1", kind: "proposed", routeId: "remake", evidenceTurnId: "a1" }, accepted = { eventId: "e2", kind: "user_accepted", routeId: "remake", evidenceTurnId: "u2" };
      const snap = (missionProgress: unknown, list = turns) => ({ learningState: "conversation", corrections: [], turns: list, missionProgress });
      // Routes outside the fixed definition are rejected before anything is stored.
      await assert.rejects(saveLearning(raw, s.learningSessionId, s.learningConnectionToken, 1, snap({ routeEvents: [{ ...proposed, routeId: "discount" }], noProgress: { count: 0, evidenceTurnIds: [] } })), /INVALID_RECORD/);
      await saveLearning(raw, s.learningSessionId, s.learningConnectionToken, 1, snap({ routeEvents: [proposed], noProgress: { count: 1, evidenceTurnIds: ["u1"] } }));
      // A later window without the old event keeps it; the no-progress streak follows the latest save.
      await saveLearning(raw, s.learningSessionId, s.learningConnectionToken, 2, snap({ routeEvents: [accepted], noProgress: { count: 2, evidenceTurnIds: ["u1", "u2"] } }));
      await assert.rejects(saveLearning(raw, s.learningSessionId, s.learningConnectionToken, 3, snap({ routeEvents: [{ ...accepted, routeId: "refund" }], noProgress: { count: 0, evidenceTurnIds: [] } })), /SAVE_SEQUENCE_CONFLICT/,
        "A confirmed route event is immutable");
      const [stored] = await databases().transcripts.select().from(transcriptSaves).where(and(eq(transcriptSaves.learningSessionId, s.learningSessionId), eq(transcriptSaves.saveSequenceNumber, 2)));
      assert.deepEqual((stored.conversationSnapshot as { mission: unknown }).mission, { events: [{ id: "e2", kind: "user_accepted", route: "remake", turn: "u2" }], noProgress: { count: 2, turns: ["u1", "u2"] } });
      await updateLearningHeartbeat(raw, s.learningSessionId, s.learningConnectionToken, true);
      const resumed = await startLearning(raw, "voice", { missionId: "cafe-wrong-order", missionMode: "real", languageLevel: "B1" });
      assert.equal(resumed.confirmedSaveSequenceNumber, 2);
      assert.deepEqual(resumed.conversationSnapshot.missionProgress, { routeEvents: [proposed, accepted], noProgress: { count: 0, evidenceTurnIds: [] } });
      // Free sessions never carry mission progress.
      const free = await startLearning(other, "voice");
      await assert.rejects(saveLearning(other, free.learningSessionId, free.learningConnectionToken, 1, snap({ routeEvents: [proposed], noProgress: { count: 0, evidenceTurnIds: [] } })), /INVALID_RECORD/);
      await saveLearning(other, free.learningSessionId, free.learningConnectionToken, 1, snap(undefined));
      assert.equal((await startLearning(other, "voice").catch(() => null)), null, "Still connected; no second session");
    } finally {
      for (const [key, value] of Object.entries({ TALKIE_VOICE_TEST: oldTest, GEMINI_FREE_TIER_CONFIRMED: oldFree, GOOGLE_API_KEY: oldKey })) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
  it("records the mission end reason once from confirmed progress, not from the client", async () => {
    const oldTest = process.env.TALKIE_VOICE_TEST, oldFree = process.env.GEMINI_FREE_TIER_CONFIRMED, oldKey = process.env.GOOGLE_API_KEY;
    process.env.TALKIE_VOICE_TEST = "gemini-free"; process.env.GEMINI_FREE_TIER_CONFIRMED = "true"; process.env.GOOGLE_API_KEY = "synthetic";
    const failing: ExtractionGenerate = async () => { throw new Error("synthetic extraction outage"); };
    const turns = [{ turnId: "a0", requestId: "a0", role: "assistant", text: "Hi, how can I help?" }, { turnId: "u1", requestId: "u1", role: "user", text: "My latte is wrong." },
      { turnId: "a1", requestId: "u1", role: "assistant", text: "I can remake it as a hot decaf in five minutes." }, { turnId: "u2", requestId: "u2", role: "user", text: "Yes, please." },
      { turnId: "a2", requestId: "u2", role: "assistant", text: "Great, I'll remake it now." }];
    const ev = (kind: string, turn: string) => ({ eventId: `${kind}-${turn}`, kind, routeId: "remake", evidenceTurnId: turn });
    const ended = async (email: string, missionMode: "practice" | "real", missionProgress: unknown) => {
      const raw = await login(email), s = await startLearning(raw, "voice", { missionId: "cafe-wrong-order", missionMode, languageLevel: "B1" });
      if (missionProgress !== null) await saveLearning(raw, s.learningSessionId, s.learningConnectionToken, 1, { learningState: "conversation", corrections: [], turns, missionProgress });
      await endLearning(raw, s.learningSessionId, s.learningConnectionToken);
      // Reason is recorded before any model call; an empty session settles without one.
      await completeLearningNote(raw, s.learningSessionId, { generate: failing }).catch(error => assert.match(String(error), /NOTE_PENDING/));
      const [row] = await databases().records.select().from(learningSessionMissions).where(eq(learningSessionMissions.learningSessionId, s.learningSessionId));
      return { raw, s, row };
    };
    try {
      const done = await ended("done@example.test", "real", { routeEvents: [ev("proposed", "a1"), ev("user_accepted", "u2"), ev("staff_confirmed", "a2")], noProgress: { count: 0, evidenceTurnIds: [] } });
      assert.deepEqual([done.row.missionEndReason, done.row.finalRouteId], ["goal_completed", "remake"]);
      // Written once: a later note run does not change it.
      await databases().records.update(learningSessionMissions).set({ finalRouteId: "refund" }).where(eq(learningSessionMissions.learningSessionId, done.s.learningSessionId));
      await assert.rejects(completeLearningNote(done.raw, done.s.learningSessionId, { generate: failing }), /NOTE_PENDING/);
      const [again] = await databases().records.select().from(learningSessionMissions).where(eq(learningSessionMissions.learningSessionId, done.s.learningSessionId));
      assert.equal(again.finalRouteId, "refund");
      const wrongOrder = await ended("order@example.test", "real", { routeEvents: [ev("user_accepted", "u1"), ev("proposed", "a1"), ev("staff_confirmed", "a2")], noProgress: { count: 0, evidenceTurnIds: [] } });
      assert.deepEqual([wrongOrder.row.missionEndReason, wrongOrder.row.finalRouteId], ["user_ended", null], "Out-of-order events are not a completion");
      const failed = await ended("stuck@example.test", "real", { routeEvents: [], noProgress: { count: 3, evidenceTurnIds: ["u1", "u2", "a2"] } });
      assert.deepEqual([failed.row.missionEndReason, failed.row.finalRouteId], ["no_progress_failed", null]);
      const short = await ended("short@example.test", "real", { routeEvents: [], noProgress: { count: 2, evidenceTurnIds: ["u1", "u2"] } });
      assert.equal(short.row.missionEndReason, "user_ended");
      const practice = await ended("practice@example.test", "practice", { routeEvents: [], noProgress: { count: 3, evidenceTurnIds: ["u1", "u2", "a2"] } });
      assert.equal(practice.row.missionEndReason, "user_ended", "Practice never fails for no progress");
      const empty = await ended("empty@example.test", "real", null);
      assert.equal(empty.row.missionEndReason, "user_ended");
      // Automatic close after 24 hours of interruption.
      const idle = await login("idle@example.test"), s = await startLearning(idle, "voice", { missionId: "cafe-wrong-order", missionMode: "real", languageLevel: "B1" });
      await saveLearning(idle, s.learningSessionId, s.learningConnectionToken, 1, { learningState: "conversation", corrections: [], turns, missionProgress: { routeEvents: [ev("proposed", "a1")], noProgress: { count: 0, evidenceTurnIds: [] } } });
      await databases().records.update(learningSessions).set({ learningSessionStatus: "interrupted", learningSessionInterruptedAt: new Date(Date.now() - 86_400_001) }).where(eq(learningSessions.learningSessionId, s.learningSessionId));
      await maintenance({ generate: failing });
      const [expired] = await databases().records.select().from(learningSessionMissions).where(eq(learningSessionMissions.learningSessionId, s.learningSessionId));
      assert.deepEqual([expired.missionEndReason, expired.finalRouteId], ["resume_expired", null]);
      assert.equal((await listLearningRecords(idle)).sessions[0].mission?.missionEndReason, "resume_expired");
    } finally {
      for (const [key, value] of Object.entries({ TALKIE_VOICE_TEST: oldTest, GEMINI_FREE_TIER_CONFIRMED: oldFree, GOOGLE_API_KEY: oldKey })) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
  it("evaluates a mission with the note, keeps the source until both settle, and keeps only the aggregate after details expire", async () => {
    const oldTest = process.env.TALKIE_VOICE_TEST, oldFree = process.env.GEMINI_FREE_TIER_CONFIRMED, oldKey = process.env.GOOGLE_API_KEY;
    process.env.TALKIE_VOICE_TEST = "gemini-free"; process.env.GEMINI_FREE_TIER_CONFIRMED = "true"; process.env.GOOGLE_API_KEY = "synthetic";
    const { rubric } = currentMission("cafe-wrong-order")!;
    const turns = [{ turnId: "a0", requestId: "a0", role: "assistant", text: "Hi, how can I help?" }, { turnId: "u1", requestId: "u1", role: "user", text: "I ordered a hot decaf latte but this is iced." },
      { turnId: "a1", requestId: "u1", role: "assistant", text: "I can remake it in five minutes." }, { turnId: "u2", requestId: "u2", role: "user", text: "Yes, please remake it." },
      { turnId: "a2", requestId: "u2", role: "assistant", text: "Okay, I'll remake it now." }];
    const note: ExtractionGenerate = async () => JSON.stringify({ contextItems: [], detailItems: [{ kind: "summary", text: "Cafe complaint", evidence: [{ turnId: "u1", role: "user", text: "this is iced" }] }] });
    const verdict = (id: string) => id === "caffeine_mismatch" ? { verdict: "unmet", evidence: [] } : id === "grammar_level_stability" ? { verdict: "partial", evidence: [{ turnId: "u1", text: "but this is iced" }] }
      : { verdict: "met", evidence: [{ turnId: "u2", text: "please remake it" }] };
    const evaluation: ExtractionGenerate = async () => JSON.stringify({ judgements: [...rubric.goalCriteria, ...rubric.languageCriteria].map(c => ({ criterionId: c.criterionId, ...verdict(c.criterionId), counterEvidence: [], reason: "합성 판정" })) });
    const down: ExtractionGenerate = async () => { throw new Error("synthetic evaluation outage"); };
    const ended = async (email: string, list = turns) => {
      const raw = await login(email), s = await startLearning(raw, "voice", { missionId: "cafe-wrong-order", missionMode: "practice", languageLevel: "B1" });
      if (list.length) await saveLearning(raw, s.learningSessionId, s.learningConnectionToken, 1, { learningState: "conversation", corrections: [], turns: list });
      await endLearning(raw, s.learningSessionId, s.learningConnectionToken);
      return { raw, s };
    };
    const result = async (id: string) => (await databases().records.select().from(learningMissionResults).where(eq(learningMissionResults.learningSessionId, id)))[0];
    const sourceRows = async (id: string) => (await databases().transcripts.select().from(transcriptSaves).where(eq(transcriptSaves.learningSessionId, id))).length;
    try {
      // The note settles but the evaluation fails: the source stays for the retry, and only the evaluation is requested again.
      const a = await ended("eval@example.test");
      await assert.rejects(completeLearningNote(a.raw, a.s.learningSessionId, { generate: note, evaluate: down }), /NOTE_PENDING/);
      assert.equal((await result(a.s.learningSessionId)).evaluationStatus, "pending");
      assert.ok(await sourceRows(a.s.learningSessionId) > 0, "Source waits for the pending evaluation");
      let noteCalls = 0;
      await completeLearningNote(a.raw, a.s.learningSessionId, { generate: async (...args) => { noteCalls++; return note(...args); }, evaluate: evaluation });
      assert.equal(noteCalls, 0, "A settled note is not requested again");
      const ready = await result(a.s.learningSessionId);
      assert.equal(ready.evaluationStatus, "ready");
      // Goal 60 - 5 (caffeine unmet) = 55; language 40 - 1.5 (stability partial) = 38.5; 93.5/100.
      assert.deepEqual([ready.totalEarnedHalf, ready.totalMaxHalf, ready.meetsThreshold], [187, 200, true]);
      assert.deepEqual((ready.areaScores as Record<string, unknown>).grammar, { earnedHalf: 17, maxHalf: 20 });
      assert.equal(await sourceRows(a.s.learningSessionId), 0, "Source is deleted once both settled");
      const [detail] = await databases().records.select().from(learningMissionResultDetails).where(eq(learningMissionResultDetails.learningSessionId, a.s.learningSessionId));
      assert.equal((detail.judgements as unknown[]).length, 18);
      const records = await listLearningRecords(a.raw), listed = records.sessions[0];
      const { criteria, ...aggregate } = listed.missionResult!;
      assert.deepEqual(aggregate, { evaluationStatus: "ready", areaScores: ready.areaScores, totalEarnedHalf: 187, totalMaxHalf: 200, meetsThreshold: true, achievementDate: ready.achievementDate });
      const [endedRow] = await databases().records.select().from(learningSessions).where(eq(learningSessions.learningSessionId, a.s.learningSessionId));
      assert.equal(ready.achievementDate, localDateIn(endedRow.learningSessionEndedAt!, "Asia/Seoul"), "A start without a zone falls back to Asia/Seoul");
      assert.equal(records.achievementDayCount, 1);
      assert.ok(!JSON.stringify(aggregate).includes("remake it"), "The aggregate carries no learner text");
      // Details come with fixed labels/points in rubric order for the result screen.
      assert.deepEqual(criteria?.map(c => c.criterionId), [...rubric.goalCriteria, ...rubric.languageCriteria].map(c => c.criterionId));
      assert.deepEqual(criteria?.find(c => c.criterionId === "grammar_level_stability"), { criterionId: "grammar_level_stability", area: "grammar", label: "선택 수준에서의 안정성", points: 3,
        verdict: "partial", reason: "합성 판정", evidence: ["but this is iced"], counterEvidence: [] });
      assert.deepEqual(records.missions.map(m => m.missionId), ["cafe-wrong-order"]);
      assert.ok(!JSON.stringify(records.missions).includes("different staff member"), "The catalog carries no partner knowledge");
      // Details expire with the note (hidden at once, deleted by maintenance); the aggregate stays.
      await databases().records.update(learningMissionResultDetails).set({ detailRetentionExpiresAt: new Date(Date.now() - 1000) }).where(eq(learningMissionResultDetails.learningSessionId, a.s.learningSessionId));
      assert.equal((await listLearningRecords(a.raw)).sessions[0].missionResult?.criteria, null, "Expired details are not listed");
      await maintenance({ generate: down });
      assert.equal((await databases().records.select().from(learningMissionResultDetails).where(eq(learningMissionResultDetails.learningSessionId, a.s.learningSessionId))).length, 0);
      assert.equal((await result(a.s.learningSessionId)).evaluationStatus, "ready");

      // The background job evaluates too; a deadline passed before settling makes it unavailable and frees the source.
      const b = await ended("late@example.test");
      await databases().records.update(learningSessions).set({ learningConnectionExpiresAt: new Date(Date.now() - 1000) }).where(eq(learningSessions.learningSessionId, b.s.learningSessionId));
      await databases().records.update(scheduledJobs).set({ scheduledRunAt: new Date(Date.now() - 1000) }).where(eq(scheduledJobs.targetLearningSessionId, b.s.learningSessionId));
      await maintenance({ generate: note, evaluate: down });
      assert.equal((await result(b.s.learningSessionId)).evaluationStatus, "pending");
      assert.ok(await sourceRows(b.s.learningSessionId) > 0);
      await databases().records.update(learningSessions).set({ transcriptDeleteDeadlineAt: new Date(Date.now() - 1000) }).where(eq(learningSessions.learningSessionId, b.s.learningSessionId));
      await maintenance({ generate: note, evaluate: evaluation });
      assert.equal((await result(b.s.learningSessionId)).evaluationStatus, "unavailable", "No evaluation after the deadline");
      assert.equal(await sourceRows(b.s.learningSessionId), 0);
      const c = await ended("bg@example.test");
      await databases().records.update(learningSessions).set({ learningConnectionExpiresAt: new Date(Date.now() - 1000) }).where(eq(learningSessions.learningSessionId, c.s.learningSessionId));
      await databases().records.update(scheduledJobs).set({ scheduledRunAt: new Date(Date.now() - 1000) }).where(eq(scheduledJobs.targetLearningSessionId, c.s.learningSessionId));
      await maintenance({ generate: note, evaluate: evaluation });
      assert.equal((await result(c.s.learningSessionId)).evaluationStatus, "ready");
      await maintenance({ generate: note, evaluate: evaluation });
      assert.equal(await sourceRows(c.s.learningSessionId), 0);

      // No learner utterance: nothing to evaluate.
      const d = await ended("silent@example.test", []);
      await completeLearningNote(d.raw, d.s.learningSessionId, { generate: down, evaluate: down });
      assert.equal((await result(d.s.learningSessionId)).evaluationStatus, "skipped");
      await assert.rejects(databases().records.update(learningMissionResults).set({ evaluationStatus: "ready" }).where(eq(learningMissionResults.learningSessionId, d.s.learningSessionId)),
        postgresFailure("23514", "learning_mission_result_scores"), "A ready result needs its scores");

      for (const path of ["request", "maintenance"]) {
        const late = await ended(`in-flight-${path}@example.test`);
        const id = late.s.learningSessionId;
        assert.ok(await sourceRows(id) > 0);
        let evaluationCalls = 0;
        const evaluate: ExtractionGenerate = async (...args) => {
          evaluationCalls++;
          await databases().records.update(learningSessions)
            .set({ transcriptDeleteDeadlineAt: new Date(Date.now() - 1000) }).where(eq(learningSessions.learningSessionId, id));
          return evaluation(...args);
        };
        if (path === "request") {
          await completeLearningNote(late.raw, id, { generate: note, evaluate });
        } else {
          const due = new Date(Date.now() - 1000);
          await databases().records.update(learningSessions).set({ learningConnectionExpiresAt: due }).where(eq(learningSessions.learningSessionId, id));
          await databases().records.update(scheduledJobs).set({ scheduledRunAt: due }).where(eq(scheduledJobs.targetLearningSessionId, id));
          assert.equal((await maintenance({ generate: note, evaluate })).failures, 0);
        }
        assert.equal(evaluationCalls, 1, `Evaluation must be in flight via ${path}`);
        const expired = await result(id);
        assert.equal(expired.evaluationStatus, "unavailable", `Late evaluation via ${path}`);
        assert.equal(expired.totalEarnedHalf, null);
        assert.equal((await databases().records.select().from(learningMissionResultDetails).where(eq(learningMissionResultDetails.learningSessionId, id))).length, 0);
        assert.equal((await listLearningRecords(late.raw)).notes.length, 0, "A late note must not be saved");
        assert.equal(await sourceRows(id), 0);
        const [lifecycle] = await databases().transcripts.select().from(transcriptSessionStates).where(eq(transcriptSessionStates.learningSessionId, id));
        assert.equal(lifecycle.sourceDeletionReason, "deadline_expired");
      }

      const interruptedCommit = await ended("evaluation-commit@example.test");
      const id = interruptedCommit.s.learningSessionId;
      await assert.rejects(completeLearningNote(interruptedCommit.raw, id, { generate: note, evaluate: down }), /NOTE_PENDING/);
      const db = databases().records;
      await db.execute(sql`create function reject_test_evaluation_commit() returns trigger language plpgsql as $test$
        begin raise exception 'SIMULATED_EVALUATION_COMMIT_FAILURE'; end $test$`);
      try {
        await db.execute(sql`create constraint trigger reject_test_evaluation_commit after insert on learning_mission_result_details
          deferrable initially deferred for each row execute function reject_test_evaluation_commit()`);
        await assert.rejects(completeLearningNote(interruptedCommit.raw, id, { generate: down, evaluate: evaluation }),
          postgresFailure("P0001", "SIMULATED_EVALUATION_COMMIT_FAILURE"));
        assert.equal((await result(id)).evaluationStatus, "pending");
        assert.ok(await sourceRows(id) > 0, "A failed evaluation commit must retain the source");
        assert.equal((await listLearningRecords(interruptedCommit.raw)).notes.length, 1, "A settled note survives the evaluation failure");
      } finally {
        await db.execute(sql`drop trigger if exists reject_test_evaluation_commit on learning_mission_result_details`);
        await db.execute(sql`drop function reject_test_evaluation_commit()`);
      }
      await completeLearningNote(interruptedCommit.raw, id, { generate: down, evaluate: evaluation });
      assert.equal((await result(id)).evaluationStatus, "ready");
      assert.equal(await sourceRows(id), 0);
    } finally {
      for (const [key, value] of Object.entries({ TALKIE_VOICE_TEST: oldTest, GEMINI_FREE_TIER_CONFIRMED: oldFree, GOOGLE_API_KEY: oldKey })) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
  it("credits one achievement day per local end date in the start time zone, excluding resume expiry", async () => {
    const oldTest = process.env.TALKIE_VOICE_TEST, oldFree = process.env.GEMINI_FREE_TIER_CONFIRMED, oldKey = process.env.GOOGLE_API_KEY;
    process.env.TALKIE_VOICE_TEST = "gemini-free"; process.env.GEMINI_FREE_TIER_CONFIRMED = "true"; process.env.GOOGLE_API_KEY = "synthetic";
    const { rubric } = currentMission("cafe-wrong-order")!, criteria = [...rubric.goalCriteria, ...rubric.languageCriteria];
    const turns = [{ turnId: "a0", requestId: "a0", role: "assistant", text: "Hi, how can I help?" }, { turnId: "u1", requestId: "u1", role: "user", text: "My latte is wrong." },
      { turnId: "a1", requestId: "u1", role: "assistant", text: "I can remake it in five minutes." }, { turnId: "u2", requestId: "u2", role: "user", text: "Yes, please remake it." }];
    const note: ExtractionGenerate = async () => JSON.stringify({ contextItems: [], detailItems: [{ kind: "summary", text: "Cafe complaint", evidence: [{ turnId: "u1", role: "user", text: "My latte is wrong." }] }] });
    const judge = (met: boolean): ExtractionGenerate => async () => JSON.stringify({ judgements: criteria.map(c => ({ criterionId: c.criterionId, counterEvidence: [], reason: "합성 판정",
      ...(met ? { verdict: "met", evidence: [{ turnId: "u2", text: "please remake it" }] } : { verdict: "unmet", evidence: [] }) })) });
    const mission = { missionId: "cafe-wrong-order", missionMode: "real" as const, languageLevel: "B1" as const };
    const result = async (id: string) => (await databases().records.select().from(learningMissionResults).where(eq(learningMissionResults.learningSessionId, id)))[0];
    // Ends the session at a fixed instant so the local date does not depend on when the test runs.
    const finish = async (raw: string, s: { learningSessionId: string; learningConnectionToken: string }, endedAt: string, met: boolean) => {
      await saveLearning(raw, s.learningSessionId, s.learningConnectionToken, 1, { learningState: "conversation", corrections: [], turns });
      await endLearning(raw, s.learningSessionId, s.learningConnectionToken);
      await databases().records.update(learningSessions).set({ learningSessionEndedAt: new Date(endedAt) }).where(eq(learningSessions.learningSessionId, s.learningSessionId));
      await completeLearningNote(raw, s.learningSessionId, { generate: note, evaluate: judge(met) });
      return result(s.learningSessionId);
    };
    try {
      const raw = await login("days@example.test");
      // The zone is fixed at start; a resume from another zone keeps it.
      const first = await startLearning(raw, "voice", mission, "America/Los_Angeles");
      await updateLearningHeartbeat(raw, first.learningSessionId, first.learningConnectionToken, true);
      const resumed = await startLearning(raw, "voice", mission, "Asia/Seoul");
      assert.equal(resumed.learningSessionId, first.learningSessionId);
      const [fixed] = await databases().records.select().from(learningSessionMissions).where(eq(learningSessionMissions.learningSessionId, first.learningSessionId));
      assert.equal(fixed.missionTimeZone, "America/Los_Angeles");
      // 06:30Z is the previous evening in Los Angeles but the afternoon of the 19th in Seoul.
      assert.equal((await finish(raw, resumed, "2026-11-19T06:30:00Z", true)).achievementDate, "2026-11-18");
      const sameDay = await startLearning(raw, "voice", mission, "Asia/Seoul");
      assert.equal((await finish(raw, sameDay, "2026-11-18T10:00:00Z", true)).achievementDate, "2026-11-18");
      const below = await startLearning(raw, "voice", mission, "Asia/Seoul");
      const unmet = await finish(raw, below, "2026-11-17T01:00:00Z", false);
      assert.deepEqual([unmet.evaluationStatus, unmet.meetsThreshold, unmet.achievementDate], ["ready", false, null]);
      const other = await startLearning(raw, "voice", mission, "Asia/Seoul");
      assert.equal((await finish(raw, other, "2026-11-17T01:00:00Z", true)).achievementDate, "2026-11-17");
      // A resume-expired mission is scored but never credits a day.
      const idle = await startLearning(raw, "voice", mission, "Asia/Seoul");
      await saveLearning(raw, idle.learningSessionId, idle.learningConnectionToken, 1, { learningState: "conversation", corrections: [], turns });
      await databases().records.update(learningSessions).set({ learningSessionStatus: "interrupted", learningSessionInterruptedAt: new Date(Date.now() - 86_400_001) }).where(eq(learningSessions.learningSessionId, idle.learningSessionId));
      await maintenance({ generate: note, evaluate: judge(true) });
      await maintenance({ generate: note, evaluate: judge(true) });
      const expired = await result(idle.learningSessionId);
      assert.deepEqual([expired.evaluationStatus, expired.meetsThreshold, expired.achievementDate], ["ready", true, null]);
      const records = await listLearningRecords(raw);
      assert.equal(records.achievementDayCount, 2, "Two credited missions on 11-18 count once");
      assert.deepEqual(records.sessions.map(s => s.missionResult?.achievementDate), [null, "2026-11-17", null, "2026-11-18", "2026-11-18"]);
      await assert.rejects(databases().records.update(learningMissionResults).set({ achievementDate: "2026-11-17" }).where(eq(learningMissionResults.learningSessionId, below.learningSessionId)),
        postgresFailure("23514", "learning_mission_result_achievement"), "Only a result at or above 80% can carry a date");
    } finally {
      for (const [key, value] of Object.entries({ TALKIE_VOICE_TEST: oldTest, GEMINI_FREE_TIER_CONFIRMED: oldFree, GOOGLE_API_KEY: oldKey })) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
  it("reads retained difficulty outside the review window and keeps topic context isolated", async () => {
    const oldTest = process.env.TALKIE_VOICE_TEST, oldFree = process.env.GEMINI_FREE_TIER_CONFIRMED, oldKey = process.env.GOOGLE_API_KEY;
    process.env.TALKIE_VOICE_TEST = "gemini-free"; process.env.GEMINI_FREE_TIER_CONFIRMED = "true"; process.env.GOOGLE_API_KEY = "synthetic";
    try {
    const raw = await login(), other = await login("other@example.test");
    const next = await startLearning(raw, "voice"), otherNext = await startLearning(other, "voice");
    const { now, userId } = await withIdentity(raw, async (tx, who) => ({ now: await dbNow(tx), userId: who.userId }));
    const { fromDateKst, toDateKst } = priorLearningWindow(now);
    const oldDate = new Date(fromDateKst + "T00:00:00Z"); oldDate.setUTCDate(oldDate.getUTCDate() - 1);
    const seeded: string[] = [];
    for (const [date, summary] of [[oldDate.toISOString().slice(0, 10), "Older difficulty"], [toDateKst, "Cafe topic"]]) {
      const id = randomUUID(); seeded.push(id);
      const snapshot = { learningState: "conversation" as const, corrections: [], turns: [
        { turnId: "u1", requestId: "r1", role: "user" as const, text: "Synthetic answer." },
      ] };
      const noteMarkdown = buildVoiceNoteMarkdown(snapshot, date + "T00:00:00Z", [{ kind: summary === "Cafe topic" ? "topic" : "difficulty", summary,
        evidence: [{ turnId: "u1", role: "user", text: "Synthetic answer." }] }])!;
      await databases().records.insert(learningSessions).values({ learningSessionId: id, userId, learningSessionStartedAt: new Date(date), learningSessionEndedAt: new Date(date), learningSessionStatus: "ended", demoScenario: "voice", noteGenerationStatus: "ready" });
      await databases().records.insert(learningSessionNotes).values({ learningSessionId: id, userId, learningEndDateKst: date, noteMarkdown, noteRetentionExpiresAt: new Date(now.getTime() + 86400000) });
    }
    const context = (await getVoiceLearningContext(raw, next.learningSessionId, next.learningConnectionToken)).priorLearningContext;
    assert.equal(context.topics?.[0].summary, "Cafe topic");
    assert.equal(context.difficulty?.[0].summary, "Older difficulty");
    assert.deepEqual((await getVoiceLearningContext(other, otherNext.learningSessionId, otherNext.learningConnectionToken)).priorLearningContext, { reviewExpressions: [] });
    await databases().records.update(learningSessionNotes).set({ noteRetentionExpiresAt: new Date(0) }).where(eq(learningSessionNotes.learningSessionId, seeded[0]));
    assert.equal((await getVoiceLearningContext(raw, next.learningSessionId, next.learningConnectionToken)).priorLearningContext.difficulty, undefined);
    } finally {
      for (const [key, value] of Object.entries({ TALKIE_VOICE_TEST: oldTest, GEMINI_FREE_TIER_CONFIRMED: oldFree, GOOGLE_API_KEY: oldKey })) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
  it("enforces one connection, isolated ownership and idempotent/save-sequence-conflict saves", async () => {
    const raw = await login(), b = await login("b@example.test");
    const s = await startLearning(raw, "conversation");
    await assert.rejects(startLearning(raw, "conversation"), /ALREADY_CONNECTED/);
    await saveLearning(raw, s.learningSessionId, s.learningConnectionToken, 1, record());
    await saveLearning(raw, s.learningSessionId, s.learningConnectionToken, 1, record());
    await assert.rejects(saveLearning(raw, s.learningSessionId, s.learningConnectionToken, 1, record("changed")), /SAVE_SEQUENCE_CONFLICT/);
    await assert.rejects(saveLearning(b, s.learningSessionId, s.learningConnectionToken, 2, record()), /NOT_FOUND/);
    assert.equal((await listLearningRecords(b)).sessions.length, 0);
    await updateLearningHeartbeat(raw, s.learningSessionId, s.learningConnectionToken, true);
    const restored = await startLearning(raw, "conversation");
    assert.equal(restored.confirmedSaveSequenceNumber, 1);
    assert.equal(restored.conversationSnapshot.turns[0].text, record().turns[0].text);
    await assert.rejects(saveLearning(raw, s.learningSessionId, s.learningConnectionToken, 2, record()), /CONNECTION_EXPIRED/);
  });
  it("keeps acknowledged history when the client window loses old turns and ignores unacknowledged saves on resume", async () => {
    const raw = await login(), s = await startLearning(raw, "conversation");
    await saveLearning(raw, s.learningSessionId, s.learningConnectionToken, 1, record("old confirmed"));
    const recent = { learningState: "conversation", hasConversationGaps: false, corrections: [], turns: [{ turnId: "user-2", requestId: "request-2", role: "user", text: "recent confirmed" }] };
    await saveLearning(raw, s.learningSessionId, s.learningConnectionToken, 2, recent);
    await databases().transcripts.insert(transcriptSaves).values({ learningSessionId: s.learningSessionId, saveSequenceNumber: 3, snapshotHash: "unconfirmed", conversationSnapshot: record("must not restore") });
    await updateLearningHeartbeat(raw, s.learningSessionId, s.learningConnectionToken, true);
    const restored = await startLearning(raw, "conversation");
    assert.deepEqual(restored.conversationSnapshot.turns.filter(t => t.role === "user").map(t => t.text), ["old confirmed", "recent confirmed"]);
  });
  it("restores legacy JSON and replays its acknowledged sequence without changing bytes or hash", async () => {
    const loginSessionToken = await login(), session = await startLearning(loginSessionToken, "conversation");
    const legacy = {
      turns: [{ id: "u-old", requestId: "r-old", role: "user", text: "Synthetic original" },
        { id: "a-old", requestId: "r-old", role: "assistant", text: "Synthetic replacement" }],
      corrections: [{ id: "c-old", sourceTurnId: "u-old", deliveredTurnId: "a-old", replacement: "Synthetic replacement", explanation: "Synthetic explanation", attempts: [] }],
      learning: "retry", gaps: true,
    };
    const snapshotHash = digest(JSON.stringify(legacy));
    await databases().transcripts.insert(transcriptSaves).values({ learningSessionId: session.learningSessionId, saveSequenceNumber: 1, conversationSnapshot: legacy, snapshotHash });
    await databases().records.update(learningSessions).set({ confirmedSaveSequenceNumber: 1 }).where(eq(learningSessions.learningSessionId, session.learningSessionId));
    const renamed = validateConversationSnapshot(legacy);
    await saveLearning(loginSessionToken, session.learningSessionId, session.learningConnectionToken, 1, renamed);
    await saveLearning(loginSessionToken, session.learningSessionId, session.learningConnectionToken, 1, legacy);
    const [unchanged] = await databases().transcripts.select().from(transcriptSaves).where(eq(transcriptSaves.saveSequenceNumber, 1));
    assert.equal(unchanged.snapshotHash, snapshotHash);
    assert.deepEqual(unchanged.conversationSnapshot, legacy);
    assert.deepEqual(encodeStoredConversationSnapshot(renamed), legacy);
    await assert.rejects(saveLearning(loginSessionToken, session.learningSessionId, session.learningConnectionToken, 1, { ...renamed, hasConversationGaps: false }), /SAVE_SEQUENCE_CONFLICT/);
    await updateLearningHeartbeat(loginSessionToken, session.learningSessionId, session.learningConnectionToken, true);
    const resumed = await startLearning(loginSessionToken, "conversation");
    assert.deepEqual(resumed.conversationSnapshot, renamed);
    assert.equal(resumed.conversationSnapshot.corrections[0].correctionId, "c-old");
  });

  it("preserves first end time, commits a bounded demo note before deleting source, rejects late writes", async () => {
    const raw = await login(), s = await startLearning(raw, "conversation");
    const [created] = await databases().transcripts.select().from(transcriptSessionStates);
    assert.ok(created.transcriptStorageCreatedAt);
    assert.equal(created.firstNonemptySaveAt, null);
    assert.equal(created.sourceDeletedAt, null);
    await saveLearning(raw, s.learningSessionId, s.learningConnectionToken, 1, record("x".repeat(1000)));
    const [stored] = await databases().transcripts.select().from(transcriptSessionStates);
    assert.ok(stored.firstNonemptySaveAt! >= created.transcriptStorageCreatedAt!);
    await saveLearning(raw, s.learningSessionId, s.learningConnectionToken, 1, record("x".repeat(1000)));
    assert.deepEqual((await databases().transcripts.select().from(transcriptSessionStates))[0], stored);
    const end = await endLearning(raw, s.learningSessionId, s.learningConnectionToken);
    assert.equal((await endLearning(raw, s.learningSessionId, s.learningConnectionToken)).learningSessionEndedAt, end.learningSessionEndedAt);
    await completeLearningNote(raw, s.learningSessionId);
    assert.equal((await databases().transcripts.select().from(transcriptSaves)).length, 0);
    assert.equal((await databases().transcripts.select().from(transcriptSaves)).length, 0);
    const [deleted] = await databases().transcripts.select().from(transcriptSessionStates);
    assert.ok(deleted.sourceDeletedAt! >= stored.firstNonemptySaveAt!);
    assert.equal(deleted.sourceDeletionReason, "note_saved");
    assert.equal(JSON.stringify(deleted).includes("x".repeat(100)), false);
    await completeLearningNote(raw, s.learningSessionId);
    assert.equal((await maintenance()).failures, 0);
    assert.deepEqual((await databases().transcripts.select().from(transcriptSessionStates))[0], deleted);
    const saved = await databases().records.select().from(learningSessionNotes);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].noteMarkdown.includes("x".repeat(161)), false);
    await assert.rejects(saveLearning(raw, s.learningSessionId, s.learningConnectionToken, 2, record()), /CONNECTION_EXPIRED/);
  });
  it("rolls back source deletion if recording completion fails, then retries without inventing missing-source history", async () => {
    const raw = await login(), s = await startLearning(raw, "conversation");
    await saveLearning(raw, s.learningSessionId, s.learningConnectionToken, 1, record());
    await endLearning(raw, s.learningSessionId, s.learningConnectionToken);
    await databases().transcripts.execute(sql`create function reject_test_deletion_audit() returns trigger language plpgsql as $$ begin if NEW.source_deleted_at is not null then raise exception 'SIMULATED_AUDIT_FAILURE'; end if; return NEW; end $$`);
    await databases().transcripts.execute(sql`create trigger reject_test_deletion_audit before update on transcript_session_states for each row execute function reject_test_deletion_audit()`);
    try { await assert.rejects(completeLearningNote(raw, s.learningSessionId)); }
    finally {
      await databases().transcripts.execute(sql`drop trigger reject_test_deletion_audit on transcript_session_states`);
      await databases().transcripts.execute(sql`drop function reject_test_deletion_audit()`);
    }
    assert.equal((await databases().records.select().from(learningSessionNotes)).length, 1);
    assert.equal((await databases().transcripts.select().from(transcriptSaves)).length, 2);
    assert.equal((await databases().transcripts.select().from(transcriptSaves)).length, 2);
    assert.equal((await databases().transcripts.select().from(transcriptSessionStates))[0].sourceDeletedAt, null);
    assert.equal((await maintenance()).failures, 0);
    assert.equal((await databases().transcripts.select().from(transcriptSaves)).length, 0);
    assert.equal((await databases().transcripts.select().from(transcriptSessionStates))[0].sourceDeletionReason, "note_saved");
    const missing = randomUUID();
    await deleteTranscriptSource(missing, "deadline_expired");
    assert.equal((await databases().transcripts.select().from(transcriptSessionStates).where(eq(transcriptSessionStates.learningSessionId, missing))).length, 0);
  });
  it("keeps unknown legacy creation and first-save times unknown after later writes", async () => {
    const raw = await login(), s = await startLearning(raw, "conversation");
    await databases().transcripts.update(transcriptSessionStates).set({ transcriptStorageCreatedAt: null });
    await saveLearning(raw, s.learningSessionId, s.learningConnectionToken, 1, record());
    await endLearning(raw, s.learningSessionId, s.learningConnectionToken);
    await completeLearningNote(raw, s.learningSessionId);
    const [legacy] = await databases().transcripts.select().from(transcriptSessionStates);
    assert.equal(legacy.transcriptStorageCreatedAt, null);
    assert.equal(legacy.firstNonemptySaveAt, null);
    assert.ok(legacy.sourceDeletedAt);
    assert.equal(legacy.sourceDeletionReason, "note_saved");
  });
  it("recovers each pool after a checked-out database connection is terminated", { timeout: 5000 }, async () => {
    const { recordsPool, transcriptsPool } = databases();
    for (const pool of [recordsPool, transcriptsPool]) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const { rows: [{ pid }] } = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
        // Listen for socket closure so the production error listener handles the driver error.
        const disconnected = new Promise<void>(resolve => client.once("end", resolve));
        const { rows: [{ terminated }] } = await pool.query<{ terminated: boolean }>(
          "select pg_terminate_backend($1) as terminated", [pid],
        );
        assert.equal(terminated, true);
        await disconnected;
        await assert.rejects(client.query("rollback"));
      } finally {
        client.release();
      }
      const { rows: [{ ready }] } = await pool.query<{ ready: number }>("select 1 as ready");
      assert.equal(ready, 1);
    }
  });

  it("recovers a temporary-only commit without losing acknowledged state or duplicating the retried save", async () => {
    const raw = await login(), s = await startLearning(raw, "conversation");
    await saveLearning(raw, s.learningSessionId, s.learningConnectionToken, 1, record());
    const next = { ...record(), turns: [...record().turns, { turnId: "user-2", requestId: "request-2", role: "user", text: "new synthetic answer" }] };
    await databases().records.execute(sql`create function reject_test_confirmation() returns trigger language plpgsql as $$ begin if NEW.confirmed_save_sequence_number = 2 then raise exception 'SIMULATED_CONFIRM_FAILURE'; end if; return NEW; end $$`);
    await databases().records.execute(sql`create trigger reject_test_confirmation before update on learning_sessions for each row execute function reject_test_confirmation()`);
    try { await assert.rejects(saveLearning(raw, s.learningSessionId, s.learningConnectionToken, 2, next)); }
    finally {
      await databases().records.execute(sql`drop trigger reject_test_confirmation on learning_sessions`);
      await databases().records.execute(sql`drop function reject_test_confirmation()`);
    }
    assert.equal((await databases().records.select().from(learningSessions))[0].confirmedSaveSequenceNumber, 1);
    assert.equal((await databases().transcripts.select().from(transcriptSaves)).some(v => v.saveSequenceNumber === 2), true);
    await updateLearningHeartbeat(raw, s.learningSessionId, s.learningConnectionToken, true);
    const resumed = await startLearning(raw, "conversation");
    assert.equal(resumed.conversationSnapshot.turns.length, 2);
    await saveLearning(raw, s.learningSessionId, resumed.learningConnectionToken, 2, next);
    assert.equal((await databases().transcripts.select().from(transcriptSaves)).filter(v => v.saveSequenceNumber === 2).length, 1);
  });
  it("reclaims a temporary-only save after the client loses memory and reconnects, without using it as evidence", async () => {
    const raw = await login(), s = await startLearning(raw, "conversation"), id = s.learningSessionId;
    await saveLearning(raw, id, s.learningConnectionToken, 1, record());
    const withSecondTurn = (text: string) => ({ ...record(), turns: [...record().turns, { turnId: "user-2", requestId: "request-2", role: "user", text }] });
    const lost = withSecondTurn("unconfirmed lost marker"), fresh = withSecondTurn("fresh confirmed answer");
    const savesAt = async (sequence: number) => (await databases().transcripts.select().from(transcriptSaves)
      .where(and(eq(transcriptSaves.learningSessionId, id), eq(transcriptSaves.saveSequenceNumber, sequence))));
    const confirmed = async () => (await databases().records.select().from(learningSessions).where(eq(learningSessions.learningSessionId, id)))[0].confirmedSaveSequenceNumber;
    await databases().records.execute(sql`create function reject_test_confirmation() returns trigger language plpgsql as $$ begin if NEW.confirmed_save_sequence_number = 2 then raise exception 'SIMULATED_CONFIRM_FAILURE'; end if; return NEW; end $$`);
    await databases().records.execute(sql`create trigger reject_test_confirmation before update on learning_sessions for each row execute function reject_test_confirmation()`);
    try { await assert.rejects(saveLearning(raw, id, s.learningConnectionToken, 2, lost), postgresFailure("P0001", "SIMULATED_CONFIRM_FAILURE")); }
    finally {
      await databases().records.execute(sql`drop trigger reject_test_confirmation on learning_sessions`);
      await databases().records.execute(sql`drop function reject_test_confirmation()`);
    }
    assert.equal(await confirmed(), 1);
    assert.equal((await savesAt(2)).length, 1, "Sequence 2 is committed only in the temporary DB");
    // On the same connection the unconfirmed upload keeps its content: a different payload is still rejected.
    await assert.rejects(saveLearning(raw, id, s.learningConnectionToken, 2, fresh), /SAVE_SEQUENCE_CONFLICT/);
    assert.equal(await confirmed(), 1);

    // The client loses its memory window and reconnects; only confirmed state is restored.
    await updateLearningHeartbeat(raw, id, s.learningConnectionToken, true);
    const resumed = await startLearning(raw, "conversation");
    assert.equal(resumed.confirmedSaveSequenceNumber, 1);
    assert.deepEqual(resumed.conversationSnapshot.turns.map(t => t.turnId), ["user-1", "assistant-1"]);
    assert.equal(resumed.conversationSnapshot.hasConversationGaps, true);
    assert.equal(JSON.stringify(resumed.conversationSnapshot).includes("unconfirmed lost marker"), false);
    assert.equal((await savesAt(2)).length, 0, "Connection rotation reclaims the stale unconfirmed upload");
    assert.equal((await savesAt(1)).length, 1, "Confirmed history is untouched");

    // The old connection can no longer write; the new connection's different sequence 2 is accepted once.
    await assert.rejects(saveLearning(raw, id, s.learningConnectionToken, 2, lost), /CONNECTION_EXPIRED/);
    assert.deepEqual(await saveLearning(raw, id, resumed.learningConnectionToken, 2, fresh), { confirmedSaveSequenceNumber: 2 });
    assert.deepEqual(await saveLearning(raw, id, resumed.learningConnectionToken, 2, fresh), { confirmedSaveSequenceNumber: 2 }, "Identical retry stays idempotent");
    await assert.rejects(saveLearning(raw, id, resumed.learningConnectionToken, 2, lost), /SAVE_SEQUENCE_CONFLICT/, "A confirmed sequence is never replaced");
    const stored = await savesAt(2);
    assert.equal(stored.length, 1);
    assert.equal(JSON.stringify(stored[0].conversationSnapshot).includes("fresh confirmed answer"), true);

    // A later reconnect and the note see only confirmed content.
    await updateLearningHeartbeat(raw, id, resumed.learningConnectionToken, true);
    const again = await startLearning(raw, "conversation");
    assert.equal(again.confirmedSaveSequenceNumber, 2);
    assert.equal(again.conversationSnapshot.hasConversationGaps, true, "Gap survives even if the client did not send the flag");
    assert.deepEqual(again.conversationSnapshot.turns.find(t => t.turnId === "user-2")?.text, "fresh confirmed answer");
    await endLearning(raw, id, again.learningConnectionToken);
    await completeLearningNote(raw, id);
    const [note] = (await listLearningRecords(raw)).notes;
    assert.ok(note.noteMarkdown.includes("fresh confirmed answer"));
    assert.ok(note.noteMarkdown.includes("일부 대화 기록이 누락됐습니다."));
    assert.equal(note.noteMarkdown.includes("unconfirmed lost marker"), false);
  });
  it("keeps confirmed saves on rotation and rejects a stale-connection save racing the reconnect", async () => {
    const raw = await login(), s = await startLearning(raw, "conversation"), id = s.learningSessionId;
    await saveLearning(raw, id, s.learningConnectionToken, 1, record());
    await updateLearningHeartbeat(raw, id, s.learningConnectionToken, true);
    // A save racing the reconnect either fails on the expired connection or is confirmed before rotation.
    const [late, resumed] = await Promise.allSettled([saveLearning(raw, id, s.learningConnectionToken, 2, record("racing marker")), startLearning(raw, "conversation")]);
    assert.equal(late.status, "rejected");
    assert.match(String((late as PromiseRejectedResult).reason), /CONNECTION_EXPIRED/);
    assert.equal(resumed.status, "fulfilled");
    const rows = await databases().transcripts.select().from(transcriptSaves).where(eq(transcriptSaves.learningSessionId, id));
    assert.deepEqual(rows.map(r => r.saveSequenceNumber).sort(), [0, 1], "Confirmed saves survive rotation; nothing unconfirmed is left");
  });
  it("requires deletion recheck in the original session, blocks all sessions immediately and removes source on maintenance", async () => {
    const a = await login(), s = await startLearning(a, "conversation");
    await saveLearning(a, s.learningSessionId, s.learningConnectionToken, 1, record());
    await databases().records.update(emailAuthRateLimits).set({ lastAuthEmailRequestedAt: new Date(Date.now() - 31_000) });
    const b = await login();
    await databases().records.update(emailAuthRateLimits).set({ lastAuthEmailRequestedAt: new Date(Date.now() - 31_000) });
    await requestLink("learner@example.test", "account_deletion", a, capture);
    const link = secret();
    await assert.rejects(consumeLink(link, b), /ORIGINAL_BROWSER_REQUIRED/);
    await consumeLink(link, a);
    await deleteAccount(a);
    await assert.rejects(withIdentity(b, async () => {}), /LOGIN_REQUIRED/);
    await assert.rejects(saveLearning(a, s.learningSessionId, s.learningConnectionToken, 2, record()), /LOGIN_REQUIRED/);
    await maintenance();
    assert.equal((await databases().records.select().from(users)).length, 0);
    assert.equal((await databases().transcripts.select().from(transcriptSaves)).length, 0);
    assert.equal((await databases().transcripts.select().from(transcriptSessionStates)).length, 0);
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
    await saveLearning(raw, s.learningSessionId, s.learningConnectionToken, 1, record());
    const results = await Promise.allSettled([
      deleteTranscriptSource(s.learningSessionId, "deadline_expired"),
      saveLearning(raw, s.learningSessionId, s.learningConnectionToken, 2, record()),
    ]);
    assert.equal(results[0].status, "fulfilled");
    if (results[1].status === "rejected") assert.match(results[1].reason.message, /SESSION_CLOSED/);
    assert.equal((await databases().transcripts.select().from(transcriptSaves)).length, 0);
    const [deleted] = await databases().transcripts.select().from(transcriptSessionStates);
    assert.ok(deleted.sourceDeletedAt);
    await assert.rejects(saveLearning(raw, s.learningSessionId, s.learningConnectionToken, 2, record()), /SESSION_CLOSED/);
    await deleteTranscriptSource(s.learningSessionId, "note_saved");
    assert.deepEqual((await databases().transcripts.select().from(transcriptSessionStates))[0], deleted);
  });

  it("rejects mismatched owners, duplicate account jobs and invalid state values in the database", async () => {
    const raw = await login(), other = await login("other@example.test"), s = await startLearning(raw, "conversation");
    const otherUserId = await withIdentity(other, async (_tx, who) => who.userId);
    const userId = await withIdentity(raw, async (_tx, who) => who.userId);
    await assert.rejects(databases().records.insert(learningSessionNotes).values({ learningSessionId: s.learningSessionId, userId: otherUserId, learningEndDateKst: "2026-10-25", noteMarkdown: "Synthetic", noteRetentionExpiresAt: new Date() }), postgresFailure("23503", "learning_note_session_owner"));
    await assert.rejects(databases().records.insert(scheduledJobs).values({ targetUserId: otherUserId, targetLearningSessionId: s.learningSessionId, jobType: "note", scheduledRunAt: new Date() }), postgresFailure("23503", "scheduled_job_session_owner"));
    await databases().records.insert(scheduledJobs).values({ targetUserId: userId, jobType: "delete_account", scheduledRunAt: new Date() });
    await assert.rejects(databases().records.insert(scheduledJobs).values({ targetUserId: userId, jobType: "delete_account", scheduledRunAt: new Date() }), postgresFailure("23505", "scheduled_account_job_target"));
    await assert.rejects(databases().records.update(learningSessions).set({ learningSessionStatus: "unknown" }), postgresFailure("23514", "learning_session_status"));
    await assert.rejects(databases().records.update(learningSessions).set({ confirmedSaveSequenceNumber: -1 }), postgresFailure("23514", "confirmed_save_sequence_nonnegative"));
    await assert.rejects(databases().transcripts.update(transcriptSessionStates).set({ sourceDeletedAt: new Date() }), postgresFailure("23514", "transcript_source_deletion_pair"));
    await assert.rejects(databases().transcripts.update(transcriptSaves).set({ saveSequenceNumber: -1 }), postgresFailure("23514", "transcript_save_sequence_nonnegative"));
  });

  it("auto-closes after interruption, does not generate empty notes and removes expired source on the original deadline", async () => {
    const raw = await login(), s = await startLearning(raw, "conversation");
    await databases().records.update(learningSessions).set({ learningSessionStatus: "interrupted", learningSessionInterruptedAt: new Date(Date.now() - 86_400_001) });
    await maintenance();
    const [closed] = await databases().records.select().from(learningSessions);
    assert.equal(closed.learningSessionStatus, "ended"); assert.equal(closed.noteGenerationStatus, "empty");
    assert.equal((await databases().records.select().from(learningSessionNotes)).length, 0);
    assert.equal((await databases().transcripts.select().from(transcriptSaves)).length, 0);
    assert.ok(closed.transcriptDeleteDeadlineAt!.getTime() - closed.learningSessionEndedAt!.getTime() === 86_400_000);
    const [lifecycle] = await databases().transcripts.select().from(transcriptSessionStates);
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
    await saveLearning(raw, s.learningSessionId, s.learningConnectionToken, 1, record());
    await endLearning(raw, s.learningSessionId, s.learningConnectionToken);
    await databases().records.update(scheduledJobs).set({ scheduledRunAt: new Date(Date.now() - 60_000) });
    await maintenance();
    assert.equal((await databases().records.select().from(learningSessions))[0].noteGenerationStatus, "waiting_save");
    assert.equal((await databases().transcripts.select().from(transcriptSaves)).length, 2);
    await databases().records.update(learningSessions).set({ learningConnectionExpiresAt: new Date(Date.now() - 60_000) });
    await updateLearningHeartbeat(raw, s.learningSessionId, s.learningConnectionToken); // Closing retry owner can reconnect until its original erase deadline.
    await databases().records.update(learningSessions).set({ transcriptDeleteDeadlineAt: new Date(Date.now() - 1) });
    await assert.rejects(saveLearning(raw, s.learningSessionId, s.learningConnectionToken, 2, record()), /SESSION_CLOSED/);
    await maintenance();
    assert.equal((await databases().transcripts.select().from(transcriptSaves)).length, 0);
    assert.equal((await databases().records.select().from(learningSessions))[0].noteGenerationStatus, "expired");
    const [lifecycle] = await databases().transcripts.select().from(transcriptSessionStates);
    assert.ok(lifecycle.firstNonemptySaveAt);
    assert.ok(lifecycle.sourceDeletedAt);
    assert.equal(lifecycle.sourceDeletionReason, "deadline_expired");
  });
  it("bounds whole request units, keeping recent content without partially retaining correction evidence", () => {
    const turns = Array.from({ length: 8 }, (_, i) => ({ turnId: `t-${i}`, requestId: `r-${Math.floor(i / 2)}`, role: i % 2 ? "assistant" as const : "user" as const, text: "x".repeat(200) }));
    const bounded = boundRecords(turns, [], 1100);
    assert.ok(bounded.dropped);
    assert.equal(bounded.turns[0].role, "user");
    assert.equal(bounded.turns.at(-1)!.turnId, "t-7");
    assert.ok(new TextEncoder().encode(JSON.stringify({ turns: bounded.turns, corrections: [] })).length <= 1100);
  });
  it("backs up only durable records and invalidates authentication after a real PostgreSQL restore", { skip: !process.env.PG_BIN_DIR }, async () => {
    const raw = await login(), s = await startLearning(raw, "conversation");
    const marker = `TRANSCRIPT_ONLY_${randomUUID()}`;
    await saveLearning(raw, s.learningSessionId, s.learningConnectionToken, 1, record(marker));
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
