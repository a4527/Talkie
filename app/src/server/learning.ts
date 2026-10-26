import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { AppError } from "./config";
import { DAY, dbNow, digest, token, withIdentity, type Identity } from "./auth";
import { databases, type Transaction } from "./db";
import { scheduledJobs, learningSessions, learningSessionNotes } from "./db/schema";
import { transcriptSessionStates, transcriptSaves } from "./db/transcript-schema";
import { deleteTranscriptSource, transcriptDeletionReason } from "./db/transcript-lifecycle";
import type { Session, Correction } from "../learning/types";
import { koreaDate } from "../learning/note";

export type Snapshot = Pick<Session, "turns" | "corrections" | "learning"> & { gaps?: boolean };
export function validateConversationSnapshot(input: unknown): Snapshot {
  if (!input || typeof input !== "object") throw new AppError("INVALID_RECORD");
  const value = input as Snapshot;
  if (!Array.isArray(value.turns) || !Array.isArray(value.corrections) || !["retry", "conversation"].includes(value.learning)) throw new AppError("INVALID_RECORD");
  if (Buffer.byteLength(JSON.stringify(value)) > 256 * 1024 || value.turns.length > 500) throw new AppError("RECORD_TOO_LARGE", 413);
  const ids = new Set<string>();
  const turns = value.turns.map(t => {
    if (!t || typeof t.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(t.id) || ids.has(t.id) || typeof t.requestId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(t.requestId) || !["user", "assistant"].includes(t.role) || typeof t.text !== "string" || t.text.length > 12_000) throw new AppError("INVALID_RECORD");
    ids.add(t.id);
    return { id: t.id, requestId: t.requestId, role: t.role, text: t.text };
  });
  const corrections = value.corrections.map((c: Correction) => {
    if (!c || typeof c.id !== "string" || c.id.length > 100 || typeof c.replacement !== "string" || c.replacement.length > 1200 || typeof c.explanation !== "string" || c.explanation.length > 2000 || !Array.isArray(c.attempts) || c.attempts.length > 500 ||
      !turns.some(t => t.id === c.sourceTurnId && t.role === "user") || !turns.some(t => t.id === c.deliveredTurnId && t.role === "assistant" && t.text.includes(c.replacement))) throw new AppError("INVALID_RECORD");
    const attempts = c.attempts.map((a: Correction["attempts"][number]) => {
      if (!a || !["success", "failure"].includes(a.outcome) || !turns.some(t => t.id === a.turnId && t.role === "user")) throw new AppError("INVALID_RECORD");
      return { turnId: a.turnId, outcome: a.outcome };
    });
    return { id: c.id, sourceTurnId: c.sourceTurnId, deliveredTurnId: c.deliveredTurnId, replacement: c.replacement, explanation: c.explanation, attempts };
  });
  return { turns, corrections, learning: value.learning, gaps: value.gaps === true };
}

type LearningRow = typeof learningSessions.$inferSelect;
async function owned(tx: Transaction, who: Identity, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new AppError("NOT_FOUND", 404);
  const [row] = await tx.select().from(learningSessions).where(and(eq(learningSessions.learningSessionId, id), eq(learningSessions.userId, who.userId))).for("update");
  if (!row) throw new AppError("NOT_FOUND", 404);
  return row;
}
function connection(row: LearningRow, secret: string, now: Date, allowEnded = false) {
  if ((!allowEnded && row.learningSessionEndedAt) || !row.learningConnectionTokenHash || row.learningConnectionTokenHash !== digest(secret) ||
    (!(allowEnded && row.learningSessionEndedAt) && (!row.learningConnectionExpiresAt || row.learningConnectionExpiresAt <= now))) throw new AppError("CONNECTION_EXPIRED", 409);
}
async function readConfirmed(row: LearningRow): Promise<Snapshot> {
  const stored = await databases().temporary.select().from(transcriptSaves).where(and(eq(transcriptSaves.learningSessionId, row.learningSessionId), sql`${transcriptSaves.saveSequenceNumber} <= ${row.confirmedSaveSequenceNumber}`)).orderBy(asc(transcriptSaves.saveSequenceNumber));
  if (!stored.length || stored.at(-1)!.saveSequenceNumber !== row.confirmedSaveSequenceNumber) throw new AppError("RECORD_UNAVAILABLE", 409);
  const turns = new Map<string, Session["turns"][number]>(), corrections = new Map<string, Correction>();
  let learning: Snapshot["learning"] = "conversation", gaps = false;
  for (const saved of stored) {
    const data = validateConversationSnapshot(saved.conversationSnapshot);
    for (const turn of data.turns) {
      const old = turns.get(turn.id);
      if (old && JSON.stringify(old) !== JSON.stringify(turn)) throw new AppError("SAVE_SEQUENCE_CONFLICT", 409);
      turns.set(turn.id, turn);
    }
    for (const correction of data.corrections) corrections.set(correction.id, correction);
    learning = data.learning; gaps ||= data.gaps === true;
  }
  return { turns: [...turns.values()], corrections: [...corrections.values()], learning, gaps };
}
export async function startLearning(raw: string | undefined, demoScenario: string) {
  return withIdentity(raw, async (tx, who) => {
    const now = await dbNow(tx);
    const [previous] = await tx.select().from(learningSessions).where(and(eq(learningSessions.userId, who.userId), inArray(learningSessions.learningSessionStatus, ["active", "interrupted"]))).for("update");
    if (previous?.learningConnectionExpiresAt && previous.learningConnectionExpiresAt > now && previous.learningSessionStatus === "active") throw new AppError("ALREADY_CONNECTED", 409);
    if (previous) {
      const learningSessionInterruptedAt = previous.learningSessionInterruptedAt ?? previous.learningConnectionExpiresAt ?? now;
      if (now.getTime() >= learningSessionInterruptedAt.getTime() + DAY) throw new AppError("SESSION_CLOSING", 409);
      const payload = await readConfirmed(previous);
      const secret = token();
      await tx.update(learningSessions).set({ learningSessionStatus: "active", learningSessionInterruptedAt: null, learningConnectionTokenHash: digest(secret), learningConnectionExpiresAt: new Date(now.getTime() + 45_000) }).where(eq(learningSessions.learningSessionId, previous.learningSessionId));
      return { id: previous.learningSessionId, secret, confirmedSaveSequenceNumber: previous.confirmedSaveSequenceNumber, demoScenario: previous.demoScenario, conversationSnapshot: payload };
    }
    if (!["correction", "conversation"].includes(demoScenario)) throw new AppError("INVALID_SCENARIO");
    const id = randomUUID(), secret = token();
    const empty: Snapshot = { turns: [], corrections: [], learning: "conversation", gaps: false };
    await tx.insert(learningSessions).values({ learningSessionId: id, userId: who.userId, learningSessionStartedAt: now, learningConnectionTokenHash: digest(secret), learningConnectionExpiresAt: new Date(now.getTime() + 45_000), demoScenario });
    await databases().temporary.transaction(async temp => {
      await temp.insert(transcriptSessionStates).values({ learningSessionId: id, userId: who.userId, transcriptStorageCreatedAt: sql`clock_timestamp()` });
      await temp.insert(transcriptSaves).values({ learningSessionId: id, saveSequenceNumber: 0, snapshotHash: digest(JSON.stringify(empty)), conversationSnapshot: empty });
    });
    return { id, secret, confirmedSaveSequenceNumber: 0, demoScenario, conversationSnapshot: empty };
  });
}

export async function heartbeat(raw: string | undefined, id: string, secret: string, pause = false) {
  return withIdentity(raw, async (tx, who) => {
    const row = await owned(tx, who, id), now = await dbNow(tx);
    connection(row, secret, now, true);
    if (row.noteGenerationStatus === "ready" || row.noteGenerationStatus === "empty" || (row.transcriptDeleteDeadlineAt && row.transcriptDeleteDeadlineAt <= now)) throw new AppError("SESSION_CLOSED", 409);
    if (row.learningSessionEndedAt) {
      await tx.update(learningSessions).set({ learningConnectionExpiresAt: new Date(now.getTime() + 45_000) }).where(eq(learningSessions.learningSessionId, id));
      return;
    }
    await tx.update(learningSessions).set(pause
      ? { learningSessionStatus: "interrupted", learningSessionInterruptedAt: now, learningConnectionExpiresAt: now }
      : { learningConnectionExpiresAt: new Date(now.getTime() + 45_000) }).where(eq(learningSessions.learningSessionId, id));
  });
}

export async function saveLearning(raw: string | undefined, id: string, secret: string, saveSequenceNumber: number, input: unknown) {
  const data = validateConversationSnapshot(input), hash = digest(JSON.stringify(data));
  if (!Number.isSafeInteger(saveSequenceNumber) || saveSequenceNumber < 1) throw new AppError("INVALID_SAVE_SEQUENCE");
  return withIdentity(raw, async (tx, who) => {
    const row = await owned(tx, who, id), now = await dbNow(tx);
    connection(row, secret, now, true);
    if (row.noteGenerationStatus === "ready" || row.noteGenerationStatus === "empty" || (row.transcriptDeleteDeadlineAt && row.transcriptDeleteDeadlineAt <= now)) throw new AppError("SESSION_CLOSED", 409);
    if (saveSequenceNumber < row.confirmedSaveSequenceNumber || saveSequenceNumber > row.confirmedSaveSequenceNumber + 1) throw new AppError("SAVE_SEQUENCE_CONFLICT", 409);
    await databases().temporary.transaction(async temp => {
      const [stored] = await temp.select().from(transcriptSessionStates).where(eq(transcriptSessionStates.learningSessionId, id)).for("update");
      if (!stored || stored.sourceDeletedAt || (stored.transcriptDeleteDeadlineAt && stored.transcriptDeleteDeadlineAt <= now)) throw new AppError("SESSION_CLOSED", 409);
      const history = await temp.select().from(transcriptSaves).where(and(eq(transcriptSaves.learningSessionId, id), sql`${transcriptSaves.saveSequenceNumber} <= ${row.confirmedSaveSequenceNumber}`));
      const known = new Map<string, string>();
      for (const saved of history) for (const turn of validateConversationSnapshot(saved.conversationSnapshot).turns) known.set(turn.id, JSON.stringify(turn));
      if (data.turns.some(turn => known.has(turn.id) && known.get(turn.id) !== JSON.stringify(turn))) throw new AppError("SAVE_SEQUENCE_CONFLICT", 409);
      const [previous] = await temp.select().from(transcriptSaves).where(and(eq(transcriptSaves.learningSessionId, id), eq(transcriptSaves.saveSequenceNumber, saveSequenceNumber)));
      if (previous && previous.snapshotHash !== hash) throw new AppError("SAVE_SEQUENCE_CONFLICT", 409);
      if (saveSequenceNumber === row.confirmedSaveSequenceNumber && !previous) throw new AppError("RECORD_UNAVAILABLE", 409);
      await temp.insert(transcriptSaves).values({ learningSessionId: id, saveSequenceNumber, snapshotHash: hash, conversationSnapshot: data }).onConflictDoNothing();
      if (data.turns.length) await temp.update(transcriptSessionStates)
        .set({ firstNonemptySaveAt: sql`coalesce(${transcriptSessionStates.firstNonemptySaveAt}, clock_timestamp())` })
        .where(and(eq(transcriptSessionStates.learningSessionId, id), sql`${transcriptSessionStates.transcriptStorageCreatedAt} is not null`));
      await temp.update(transcriptSessionStates).set({ transcriptDeleteDeadlineAt: row.transcriptDeleteDeadlineAt }).where(eq(transcriptSessionStates.learningSessionId, id));
    });
    await tx.update(learningSessions).set({ confirmedSaveSequenceNumber: saveSequenceNumber, learningConnectionExpiresAt: new Date(now.getTime() + 45_000) }).where(eq(learningSessions.learningSessionId, id));
    return { confirmedSaveSequenceNumber: saveSequenceNumber };
  });
}

export async function endLearning(raw: string | undefined, id: string, secret: string) {
  return withIdentity(raw, async (tx, who) => {
    const row = await owned(tx, who, id), now = await dbNow(tx);
    if (row.learningSessionEndedAt) return { learningSessionEndedAt: row.learningSessionEndedAt.toISOString() };
    connection(row, secret, now);
    const transcriptDeleteDeadlineAt = new Date(now.getTime() + DAY);
    await tx.update(learningSessions).set({ learningSessionStatus: "ended", learningSessionEndedAt: now, transcriptDeleteDeadlineAt, noteGenerationStatus: "waiting_save", learningConnectionExpiresAt: new Date(now.getTime() + 45_000) }).where(eq(learningSessions.learningSessionId, id));
    await tx.insert(scheduledJobs).values({ targetUserId: who.userId, targetLearningSessionId: id, jobType: "note", scheduledRunAt: new Date(now.getTime() + 60_000) });
    return { learningSessionEndedAt: now.toISOString() };
  });
}

// Deliberately small synthetic summary; actual AI selection is still B-09/B-06 work.
function demoMarkdown(data: Snapshot, learningSessionEndedAt: Date) {
  const users = data.turns.filter(t => t.role === "user");
  if (!users.length) return null;
  const escaped = (text: string) => text.slice(0, 160).replace(/[&<>\\`*_[\]{}()#!|]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] ?? "\\" + c)).replace(/\r?\n/g, "\n> ");
  return `# ${koreaDate(learningSessionEndedAt.toISOString())} 영어 학습 노트\n\n가짜 AI 저장 시험 · 실제 언어 평가 결과가 아닙니다.\n\n${data.gaps ? "일부 대화 기록이 누락됐습니다.\n\n" : ""}## 대화 근거 일부\n\n` + users.slice(-3).map(t => `> ${escaped(t.text)}\n\n근거: ${t.id}`).join("\n\n") + "\n";
}
export async function finalize(tx: Transaction, row: LearningRow) {
  if (!row.learningSessionEndedAt || !row.transcriptDeleteDeadlineAt) return;
  const now = await dbNow(tx);
  if (["ready", "empty", "expired"].includes(row.noteGenerationStatus)) {
    await deleteTranscriptSource(row.learningSessionId, transcriptDeletionReason(row.noteGenerationStatus));
    return;
  }
  if (row.transcriptDeleteDeadlineAt <= now) {
    await deleteTranscriptSource(row.learningSessionId, "deadline_expired");
    await tx.update(learningSessions).set({ noteGenerationStatus: "expired", learningConnectionTokenHash: null }).where(eq(learningSessions.learningSessionId, row.learningSessionId));
    return;
  }
  const data = await readConfirmed(row);
  const markdown = demoMarkdown(data, row.learningSessionEndedAt);
  if (markdown) await tx.insert(learningSessionNotes).values({ learningSessionId: row.learningSessionId, userId: row.userId, learningEndDateKst: koreaDate(row.learningSessionEndedAt.toISOString()), noteMarkdown: markdown,
    noteRetentionExpiresAt: new Date(row.learningSessionEndedAt.getTime() + 30 * DAY) }).onConflictDoNothing();
  await tx.update(learningSessions).set({ noteGenerationStatus: markdown ? "ready" : "empty", learningConnectionTokenHash: null }).where(eq(learningSessions.learningSessionId, row.learningSessionId));
  // Commit durable note first. The worker deletes the source in a subsequent transaction.
}
export async function finishNote(raw: string | undefined, id: string) {
  await withIdentity(raw, async (tx, who) => {
    const row = await owned(tx, who, id);
    await finalize(tx, row);
  });
  await withIdentity(raw, async (tx, who) => {
    const row = await owned(tx, who, id);
    if (["ready", "empty", "expired"].includes(row.noteGenerationStatus)) await deleteTranscriptSource(id, transcriptDeletionReason(row.noteGenerationStatus));
  });
}
export async function listRecords(raw: string | undefined) {
  return withIdentity(raw, async (tx, who) => {
    const now = await dbNow(tx);
    const sessions = await tx.select({ id: learningSessions.learningSessionId, status: learningSessions.learningSessionStatus, noteStatus: learningSessions.noteGenerationStatus, learningSessionEndedAt: learningSessions.learningSessionEndedAt })
      .from(learningSessions).where(eq(learningSessions.userId, who.userId));
    const saved = await tx.select().from(learningSessionNotes).where(and(eq(learningSessionNotes.userId, who.userId), sql`${learningSessionNotes.noteRetentionExpiresAt} > ${now}`));
    return { email: who.email, sessions, notes: saved.map(n => ({ date: n.learningEndDateKst, markdown: n.noteMarkdown })) };
  });
}
