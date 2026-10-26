import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { DAY, dbNow } from "./auth";
import { databases, type Records } from "./db";
import { loginSessions, emailAuthRequests, emailAuthRateLimits, scheduledJobs, learningSessions, learningSessionNotes, users } from "./db/schema";
import { transcriptSessionStates } from "./db/transcript-schema";
import { deleteTranscriptSource, transcriptDeletionReason } from "./db/transcript-lifecycle";
import { finalize } from "./learning";

export async function maintenance() {
  const db = databases();
  let accounts = 0, sessions = 0, failures = 0;
  // One user's changes serialize with authentication/save/end/delete. No provider calls under locks.
  const owners = await db.records.select({ id: users.userId }).from(users);
  for (const owner of owners) {
    try {
      await db.records.transaction(async tx => {
        const [user] = await tx.select().from(users).where(eq(users.userId, owner.id)).for("update");
        if (!user) return;
        const now = await dbNow(tx);
        if (user.accountDeletionConfirmedAt) {
          await db.temporary.transaction(async temp => {
            await temp.delete(transcriptSessionStates).where(eq(transcriptSessionStates.userId, user.userId));
          });
          await tx.delete(emailAuthRequests).where(eq(emailAuthRequests.emailAddress, user.emailAddress));
          await tx.delete(emailAuthRateLimits).where(eq(emailAuthRateLimits.emailAddress, user.emailAddress));
          await tx.delete(users).where(eq(users.userId, user.userId));
          accounts++;
          return;
        }
        const rows = await tx.select().from(learningSessions).where(eq(learningSessions.userId, user.userId)).for("update");
        for (let row of rows) {
          if (row.learningSessionStatus === "active" && row.learningConnectionExpiresAt && row.learningConnectionExpiresAt <= now) {
            await tx.update(learningSessions).set({ learningSessionStatus: "interrupted", learningSessionInterruptedAt: row.learningConnectionExpiresAt }).where(eq(learningSessions.learningSessionId, row.learningSessionId));
            row = { ...row, learningSessionStatus: "interrupted", learningSessionInterruptedAt: row.learningConnectionExpiresAt };
          }
          if (row.learningSessionStatus === "interrupted" && row.learningSessionInterruptedAt && now.getTime() >= row.learningSessionInterruptedAt.getTime() + DAY) {
            const transcriptDeleteDeadlineAt = new Date(now.getTime() + DAY);
            await tx.update(learningSessions).set({ learningSessionStatus: "ended", learningSessionEndedAt: now, transcriptDeleteDeadlineAt, noteGenerationStatus: "pending", learningConnectionTokenHash: null }).where(eq(learningSessions.learningSessionId, row.learningSessionId));
            row = { ...row, learningSessionStatus: "ended", learningSessionEndedAt: now, transcriptDeleteDeadlineAt, noteGenerationStatus: "pending", learningConnectionTokenHash: null };
          }
          const [job] = await tx.select().from(scheduledJobs).where(and(eq(scheduledJobs.targetLearningSessionId, row.learningSessionId), eq(scheduledJobs.jobType, "note")));
          if (row.learningSessionEndedAt && (row.noteGenerationStatus !== "waiting_save" || (row.transcriptDeleteDeadlineAt && row.transcriptDeleteDeadlineAt <= now) ||
            (job && job.scheduledRunAt <= now && (!row.learningConnectionExpiresAt || row.learningConnectionExpiresAt <= now)))) {
            await finalize(tx, row);
            if (job) await tx.delete(scheduledJobs).where(eq(scheduledJobs.scheduledJobId, job.scheduledJobId));
          }
          // A trimmed client window must not erase previously saved conversation history.
          sessions++;
        }
        await tx.delete(learningSessionNotes).where(and(eq(learningSessionNotes.userId, user.userId), sql`${learningSessionNotes.noteRetentionExpiresAt} <= ${now}`));
        // A successful note commits before its source is deleted, in the next pass below.
      });
      await db.records.transaction(async tx => {
        const [user] = await tx.select().from(users).where(eq(users.userId, owner.id)).for("update");
        if (!user) return;
        const rows = await tx.select().from(learningSessions).where(and(eq(learningSessions.userId, user.userId), sql`${learningSessions.noteGenerationStatus} in ('ready','empty','expired')`)).for("update");
        for (const row of rows) await deleteTranscriptSource(row.learningSessionId, transcriptDeletionReason(row.noteGenerationStatus));
      });
    } catch { failures++; }
  }
  // Remove provisional sources from a rolled-back session creation under the same user lock.
  const sources = await db.temporary.select({ id: transcriptSessionStates.learningSessionId, userId: transcriptSessionStates.userId }).from(transcriptSessionStates);
  for (const source of sources) await db.records.transaction(async tx => {
    const [user] = await tx.select().from(users).where(eq(users.userId, source.userId)).for("update");
    const [session] = await tx.select({ id: learningSessions.learningSessionId }).from(learningSessions).where(eq(learningSessions.learningSessionId, source.id));
    if (!user || !session) await db.temporary.transaction(async temp => {
      await temp.delete(transcriptSessionStates).where(eq(transcriptSessionStates.learningSessionId, source.id));
    });
  });
  await db.records.transaction(async tx => {
    // Start before the 24-hour maximum, leaving scheduling/retry room.
    const now = await dbNow(tx), cutoff = new Date(now.getTime() - 23 * 3_600_000);
    await tx.delete(emailAuthRequests).where(sql`least(${emailAuthRequests.authLinkExpiresAt}, coalesce(${emailAuthRequests.authLinkUsedAt}, 'infinity'::timestamptz), coalesce(${emailAuthRequests.authLinkInvalidatedAt}, 'infinity'::timestamptz)) <= ${cutoff}`);
    // Expired deletion authority has its own retention even while login stays valid.
    await tx.update(loginSessions).set({ accountDeletionAuthorizationExpiresAt: null, accountDeletionAuthorizationUsedAt: null })
      .where(sql`least(coalesce(${loginSessions.accountDeletionAuthorizationExpiresAt}, 'infinity'::timestamptz), coalesce(${loginSessions.accountDeletionAuthorizationUsedAt}, 'infinity'::timestamptz)) <= ${cutoff}`);
    await tx.delete(loginSessions).where(sql`least(${loginSessions.loginSessionExpiresAt}, coalesce(${loginSessions.loginSessionInvalidatedAt}, 'infinity'::timestamptz)) <= ${cutoff}`);
  });
  // Do not acquire email locks while holding authentication-row locks: issuance uses the opposite order.
  const oldControls = await db.records.select().from(emailAuthRateLimits).where(sql`${emailAuthRateLimits.lastAuthEmailRequestedAt} < clock_timestamp() - interval '23 hours'`);
  for (const control of oldControls) await db.records.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${control.emailAddress}, 0))`);
    await tx.delete(emailAuthRateLimits).where(and(eq(emailAuthRateLimits.emailAddress, control.emailAddress), sql`${emailAuthRateLimits.lastAuthEmailRequestedAt} < clock_timestamp() - interval '23 hours'`));
  });
  return { accounts, sessions, failures };
}

export async function invalidateRestoredAuthentication(records: Records = databases().records) {
  await records.transaction(async tx => {
    await tx.delete(loginSessions);
    await tx.delete(emailAuthRequests);
    await tx.delete(emailAuthRateLimits);
  });
}
