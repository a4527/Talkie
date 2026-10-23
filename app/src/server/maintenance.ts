import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { DAY, dbNow } from "./auth";
import { databases, type Records } from "./db";
import { authSessions, challenges, controls, deletionConfirmations, jobs, learningSessions, notes, users } from "./db/schema";
import { transcripts } from "./db/transcript-schema";
import { finalize } from "./learning";

export async function maintenance() {
  const db = databases();
  let accounts = 0, sessions = 0, failures = 0;
  // One user's changes serialize with authentication/save/end/delete. No provider calls under locks.
  const owners = await db.records.select({ id: users.id }).from(users);
  for (const owner of owners) {
    try {
      await db.records.transaction(async tx => {
        const [user] = await tx.select().from(users).where(eq(users.id, owner.id)).for("update");
        if (!user) return;
        const now = await dbNow(tx);
        if (user.deletedAt) {
          await db.temporary.delete(transcripts).where(eq(transcripts.userId, user.id));
          await tx.delete(challenges).where(eq(challenges.email, user.email));
          await tx.delete(controls).where(eq(controls.email, user.email));
          await tx.delete(users).where(eq(users.id, user.id));
          accounts++;
          return;
        }
        const rows = await tx.select().from(learningSessions).where(eq(learningSessions.userId, user.id)).for("update");
        for (let row of rows) {
          if (row.status === "active" && row.leaseUntil && row.leaseUntil <= now) {
            await tx.update(learningSessions).set({ status: "interrupted", interruptedAt: row.leaseUntil }).where(eq(learningSessions.id, row.id));
            row = { ...row, status: "interrupted", interruptedAt: row.leaseUntil };
          }
          if (row.status === "interrupted" && row.interruptedAt && now.getTime() >= row.interruptedAt.getTime() + DAY) {
            const eraseAt = new Date(now.getTime() + DAY);
            await tx.update(learningSessions).set({ status: "ended", endedAt: now, eraseAt, noteStatus: "pending", connectionHash: null }).where(eq(learningSessions.id, row.id));
            row = { ...row, status: "ended", endedAt: now, eraseAt, noteStatus: "pending", connectionHash: null };
          }
          const [job] = await tx.select().from(jobs).where(and(eq(jobs.sessionId, row.id), eq(jobs.kind, "note")));
          if (row.endedAt && (row.noteStatus !== "waiting_save" || (row.eraseAt && row.eraseAt <= now) ||
            (job && job.dueAt <= now && (!row.leaseUntil || row.leaseUntil <= now)))) {
            await finalize(tx, row);
            if (job) await tx.delete(jobs).where(eq(jobs.id, job.id));
          }
          // A trimmed client window must not erase previously saved conversation history.
          sessions++;
        }
        await tx.delete(notes).where(and(eq(notes.userId, user.id), sql`${notes.expiresAt} <= ${now}`));
        // A successful note commits before its source is deleted, in the next pass below.
      });
      await db.records.transaction(async tx => {
        const [user] = await tx.select().from(users).where(eq(users.id, owner.id)).for("update");
        if (!user) return;
        const rows = await tx.select().from(learningSessions).where(and(eq(learningSessions.userId, user.id), sql`${learningSessions.noteStatus} in ('ready','empty','expired')`)).for("update");
        for (const row of rows) await db.temporary.delete(transcripts).where(eq(transcripts.sessionId, row.id));
      });
    } catch { failures++; }
  }
  // Remove provisional sources from a rolled-back session creation under the same user lock.
  const sources = await db.temporary.select({ id: transcripts.sessionId, userId: transcripts.userId }).from(transcripts);
  for (const source of sources) await db.records.transaction(async tx => {
    const [user] = await tx.select().from(users).where(eq(users.id, source.userId)).for("update");
    const [session] = await tx.select({ id: learningSessions.id }).from(learningSessions).where(eq(learningSessions.id, source.id));
    if (!user || !session) await db.temporary.delete(transcripts).where(eq(transcripts.sessionId, source.id));
  });
  await db.records.transaction(async tx => {
    // Start before the 24-hour maximum, leaving scheduling/retry room.
    const now = await dbNow(tx), cutoff = new Date(now.getTime() - 23 * 3_600_000);
    await tx.delete(challenges).where(sql`least(${challenges.expiresAt}, coalesce(${challenges.consumedAt}, 'infinity'::timestamptz), coalesce(${challenges.revokedAt}, 'infinity'::timestamptz)) <= ${cutoff}`);
    await tx.delete(deletionConfirmations).where(sql`least(${deletionConfirmations.expiresAt}, coalesce(${deletionConfirmations.consumedAt}, 'infinity'::timestamptz)) <= ${cutoff}`);
    await tx.delete(authSessions).where(sql`least(${authSessions.expiresAt}, coalesce(${authSessions.revokedAt}, 'infinity'::timestamptz)) <= ${cutoff}`);
  });
  // Do not acquire email locks while holding authentication-row locks: issuance uses the opposite order.
  const oldControls = await db.records.select().from(controls).where(sql`${controls.requestedAt} < clock_timestamp() - interval '23 hours'`);
  for (const control of oldControls) await db.records.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${control.email}, 0))`);
    await tx.delete(controls).where(and(eq(controls.email, control.email), sql`${controls.requestedAt} < clock_timestamp() - interval '23 hours'`));
  });
  return { accounts, sessions, failures };
}

export async function invalidateRestoredAuthentication(records: Records = databases().records) {
  await records.transaction(async tx => {
    await tx.delete(deletionConfirmations);
    await tx.delete(authSessions);
    await tx.delete(challenges);
    await tx.delete(controls);
  });
}
