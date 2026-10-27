import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { AppError } from "./config";
import { DAY, dbNow, digest, token, withIdentity, type Identity } from "./auth";
import { databases, type RecordsTransaction } from "./db";
import { scheduledJobs, learningSessions, learningSessionNotes } from "./db/records-schema";
import { transcriptSessionStates, transcriptSaves } from "./db/transcripts-schema";
import { deleteTranscriptSource, transcriptDeletionReason } from "./db/transcripts-lifecycle";
import type { LearningSessionState, Correction, ConversationSnapshot, LearningRecordsResponse } from "../learning/types";
import { formatKstDate } from "../learning/note";

export function validateConversationSnapshot(input: unknown): ConversationSnapshot {
  if (!input || typeof input !== "object") throw new AppError("INVALID_RECORD");
  // Stored snapshots keep the original JSON keys and canonical hash. Normalize
  // only at the boundary so old rows and an unacknowledged save remain replayable.
  const source = input as Record<string, unknown>;
  const legacy = !("learningState" in source);
  const value = (legacy ? {
    turns: Array.isArray(source.turns) ? source.turns.map(t => t && ({ turnId: t.id, requestId: t.requestId, role: t.role, text: t.text })) : source.turns,
    corrections: Array.isArray(source.corrections) ? source.corrections.map(c => c && ({ correctionId: c.id, sourceTurnId: c.sourceTurnId, deliveredTurnId: c.deliveredTurnId, replacement: c.replacement, explanation: c.explanation, attempts: c.attempts })) : source.corrections,
    learningState: source.learning, hasConversationGaps: source.gaps,
  } : source) as ConversationSnapshot;
  if (!Array.isArray(value.turns) || !Array.isArray(value.corrections) || !["retry", "conversation"].includes(value.learningState)) throw new AppError("INVALID_RECORD");
  if (Buffer.byteLength(JSON.stringify(value)) > 256 * 1024 || value.turns.length > 500) throw new AppError("RECORD_TOO_LARGE", 413);
  const ids = new Set<string>();
  const turns = value.turns.map(t => {
    if (!t || typeof t.turnId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(t.turnId) || ids.has(t.turnId) || typeof t.requestId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(t.requestId) || !["user", "assistant"].includes(t.role) || typeof t.text !== "string" || t.text.length > 12_000) throw new AppError("INVALID_RECORD");
    ids.add(t.turnId);
    return { turnId: t.turnId, requestId: t.requestId, role: t.role, text: t.text };
  });
  const corrections = value.corrections.map((c: Correction) => {
    if (!c || typeof c.correctionId !== "string" || c.correctionId.length > 100 || typeof c.replacement !== "string" || c.replacement.length > 1200 || typeof c.explanation !== "string" || c.explanation.length > 2000 || !Array.isArray(c.attempts) || c.attempts.length > 500 ||
      !turns.some(t => t.turnId === c.sourceTurnId && t.role === "user") || !turns.some(t => t.turnId === c.deliveredTurnId && t.role === "assistant" && t.text.includes(c.replacement))) throw new AppError("INVALID_RECORD");
    const attempts = c.attempts.map((a: Correction["attempts"][number]) => {
      if (!a || !["success", "failure"].includes(a.outcome) || !turns.some(t => t.turnId === a.turnId && t.role === "user")) throw new AppError("INVALID_RECORD");
      return { turnId: a.turnId, outcome: a.outcome };
    });
    return { correctionId: c.correctionId, sourceTurnId: c.sourceTurnId, deliveredTurnId: c.deliveredTurnId, replacement: c.replacement, explanation: c.explanation, attempts };
  });
  return { turns, corrections, learningState: value.learningState, hasConversationGaps: value.hasConversationGaps === true };
}

// This is a storage compatibility codec, not a new persistence format. Property
// order matches the previous validator, including gaps:false, for SHA-256 replay.
export function encodeStoredConversationSnapshot(conversationSnapshot: ConversationSnapshot) {
  return {
    turns: conversationSnapshot.turns.map(t => ({ id: t.turnId, requestId: t.requestId, role: t.role, text: t.text })),
    corrections: conversationSnapshot.corrections.map(c => ({ id: c.correctionId, sourceTurnId: c.sourceTurnId, deliveredTurnId: c.deliveredTurnId, replacement: c.replacement, explanation: c.explanation, attempts: c.attempts })),
    learning: conversationSnapshot.learningState, gaps: conversationSnapshot.hasConversationGaps === true,
  };
}

type LearningRow = typeof learningSessions.$inferSelect;
async function requireOwnedLearningSession(tx: RecordsTransaction, who: Identity, learningSessionId: string) {
  if (!/^[0-9a-f-]{36}$/.test(learningSessionId)) throw new AppError("NOT_FOUND", 404);
  const [row] = await tx.select().from(learningSessions).where(and(eq(learningSessions.learningSessionId, learningSessionId), eq(learningSessions.userId, who.userId))).for("update");
  if (!row) throw new AppError("NOT_FOUND", 404);
  return row;
}
function requireLearningConnection(row: LearningRow, learningConnectionToken: string, now: Date, allowEnded = false) {
  if ((!allowEnded && row.learningSessionEndedAt) || !row.learningConnectionTokenHash || row.learningConnectionTokenHash !== digest(learningConnectionToken) ||
    (!(allowEnded && row.learningSessionEndedAt) && (!row.learningConnectionExpiresAt || row.learningConnectionExpiresAt <= now))) throw new AppError("CONNECTION_EXPIRED", 409);
}
async function readConfirmed(row: LearningRow): Promise<ConversationSnapshot> {
  const stored = await databases().transcripts.select().from(transcriptSaves).where(and(eq(transcriptSaves.learningSessionId, row.learningSessionId), sql`${transcriptSaves.saveSequenceNumber} <= ${row.confirmedSaveSequenceNumber}`)).orderBy(asc(transcriptSaves.saveSequenceNumber));
  if (!stored.length || stored.at(-1)!.saveSequenceNumber !== row.confirmedSaveSequenceNumber) throw new AppError("RECORD_UNAVAILABLE", 409);
  const turns = new Map<string, LearningSessionState["turns"][number]>(), corrections = new Map<string, Correction>();
  let learningState: ConversationSnapshot["learningState"] = "conversation", hasConversationGaps = false;
  for (const saved of stored) {
    const conversationSnapshot = validateConversationSnapshot(saved.conversationSnapshot);
    for (const turn of conversationSnapshot.turns) {
      const old = turns.get(turn.turnId);
      if (old && JSON.stringify(old) !== JSON.stringify(turn)) throw new AppError("SAVE_SEQUENCE_CONFLICT", 409);
      turns.set(turn.turnId, turn);
    }
    for (const correction of conversationSnapshot.corrections) corrections.set(correction.correctionId, correction);
    learningState = conversationSnapshot.learningState; hasConversationGaps ||= conversationSnapshot.hasConversationGaps === true;
  }
  return { turns: [...turns.values()], corrections: [...corrections.values()], learningState, hasConversationGaps };
}
export async function startLearning(loginSessionToken: string | undefined, demoScenario: string) {
  return withIdentity(loginSessionToken, async (tx, who) => {
    const now = await dbNow(tx);
    const [previous] = await tx.select().from(learningSessions).where(and(eq(learningSessions.userId, who.userId), inArray(learningSessions.learningSessionStatus, ["active", "interrupted"]))).for("update");
    if (previous?.learningConnectionExpiresAt && previous.learningConnectionExpiresAt > now && previous.learningSessionStatus === "active") throw new AppError("ALREADY_CONNECTED", 409);
    if (previous) {
      const learningSessionInterruptedAt = previous.learningSessionInterruptedAt ?? previous.learningConnectionExpiresAt ?? now;
      if (now.getTime() >= learningSessionInterruptedAt.getTime() + DAY) throw new AppError("SESSION_CLOSING", 409);
      const conversationSnapshot = await readConfirmed(previous);
      const learningConnectionToken = token();
      await tx.update(learningSessions).set({ learningSessionStatus: "active", learningSessionInterruptedAt: null, learningConnectionTokenHash: digest(learningConnectionToken), learningConnectionExpiresAt: new Date(now.getTime() + 45_000) }).where(eq(learningSessions.learningSessionId, previous.learningSessionId));
      return { learningSessionId: previous.learningSessionId, learningConnectionToken, confirmedSaveSequenceNumber: previous.confirmedSaveSequenceNumber, demoScenario: previous.demoScenario, conversationSnapshot };
    }
    if (!["correction", "conversation"].includes(demoScenario)) throw new AppError("INVALID_SCENARIO");
    const learningSessionId = randomUUID(), learningConnectionToken = token();
    const emptyConversationSnapshot: ConversationSnapshot = { turns: [], corrections: [], learningState: "conversation", hasConversationGaps: false };
    await tx.insert(learningSessions).values({ learningSessionId, userId: who.userId, learningSessionStartedAt: now, learningConnectionTokenHash: digest(learningConnectionToken), learningConnectionExpiresAt: new Date(now.getTime() + 45_000), demoScenario });
    await databases().transcripts.transaction(async temp => {
      await temp.insert(transcriptSessionStates).values({ learningSessionId, userId: who.userId, transcriptStorageCreatedAt: sql`clock_timestamp()` });
      await temp.insert(transcriptSaves).values({ learningSessionId, saveSequenceNumber: 0, snapshotHash: digest(JSON.stringify(encodeStoredConversationSnapshot(emptyConversationSnapshot))), conversationSnapshot: encodeStoredConversationSnapshot(emptyConversationSnapshot) });
    });
    return { learningSessionId, learningConnectionToken, confirmedSaveSequenceNumber: 0, demoScenario, conversationSnapshot: emptyConversationSnapshot };
  });
}

export async function updateLearningHeartbeat(loginSessionToken: string | undefined, learningSessionId: string, learningConnectionToken: string, pause = false) {
  return withIdentity(loginSessionToken, async (tx, who) => {
    const row = await requireOwnedLearningSession(tx, who, learningSessionId), now = await dbNow(tx);
    requireLearningConnection(row, learningConnectionToken, now, true);
    if (row.noteGenerationStatus === "ready" || row.noteGenerationStatus === "empty" || (row.transcriptDeleteDeadlineAt && row.transcriptDeleteDeadlineAt <= now)) throw new AppError("SESSION_CLOSED", 409);
    if (row.learningSessionEndedAt) {
      await tx.update(learningSessions).set({ learningConnectionExpiresAt: new Date(now.getTime() + 45_000) }).where(eq(learningSessions.learningSessionId, learningSessionId));
      return;
    }
    await tx.update(learningSessions).set(pause
      ? { learningSessionStatus: "interrupted", learningSessionInterruptedAt: now, learningConnectionExpiresAt: now }
      : { learningConnectionExpiresAt: new Date(now.getTime() + 45_000) }).where(eq(learningSessions.learningSessionId, learningSessionId));
  });
}

export async function saveLearning(loginSessionToken: string | undefined, learningSessionId: string, learningConnectionToken: string, saveSequenceNumber: number, input: unknown) {
  const conversationSnapshot = validateConversationSnapshot(input);
  const storedConversationSnapshot = encodeStoredConversationSnapshot(conversationSnapshot);
  const hash = digest(JSON.stringify(storedConversationSnapshot));
  if (!Number.isSafeInteger(saveSequenceNumber) || saveSequenceNumber < 1) throw new AppError("INVALID_SAVE_SEQUENCE");
  return withIdentity(loginSessionToken, async (tx, who) => {
    const row = await requireOwnedLearningSession(tx, who, learningSessionId), now = await dbNow(tx);
    requireLearningConnection(row, learningConnectionToken, now, true);
    if (row.noteGenerationStatus === "ready" || row.noteGenerationStatus === "empty" || (row.transcriptDeleteDeadlineAt && row.transcriptDeleteDeadlineAt <= now)) throw new AppError("SESSION_CLOSED", 409);
    if (saveSequenceNumber < row.confirmedSaveSequenceNumber || saveSequenceNumber > row.confirmedSaveSequenceNumber + 1) throw new AppError("SAVE_SEQUENCE_CONFLICT", 409);
    await databases().transcripts.transaction(async temp => {
      const [stored] = await temp.select().from(transcriptSessionStates).where(eq(transcriptSessionStates.learningSessionId, learningSessionId)).for("update");
      if (!stored || stored.sourceDeletedAt || (stored.transcriptDeleteDeadlineAt && stored.transcriptDeleteDeadlineAt <= now)) throw new AppError("SESSION_CLOSED", 409);
      const history = await temp.select().from(transcriptSaves).where(and(eq(transcriptSaves.learningSessionId, learningSessionId), sql`${transcriptSaves.saveSequenceNumber} <= ${row.confirmedSaveSequenceNumber}`));
      const known = new Map<string, string>();
      for (const saved of history) for (const turn of validateConversationSnapshot(saved.conversationSnapshot).turns) known.set(turn.turnId, JSON.stringify(turn));
      if (conversationSnapshot.turns.some(turn => known.has(turn.turnId) && known.get(turn.turnId) !== JSON.stringify(turn))) throw new AppError("SAVE_SEQUENCE_CONFLICT", 409);
      const [previous] = await temp.select().from(transcriptSaves).where(and(eq(transcriptSaves.learningSessionId, learningSessionId), eq(transcriptSaves.saveSequenceNumber, saveSequenceNumber)));
      if (previous && previous.snapshotHash !== hash) throw new AppError("SAVE_SEQUENCE_CONFLICT", 409);
      if (saveSequenceNumber === row.confirmedSaveSequenceNumber && !previous) throw new AppError("RECORD_UNAVAILABLE", 409);
      await temp.insert(transcriptSaves).values({ learningSessionId, saveSequenceNumber, snapshotHash: hash, conversationSnapshot: storedConversationSnapshot }).onConflictDoNothing();
      if (conversationSnapshot.turns.length) await temp.update(transcriptSessionStates)
        .set({ firstNonemptySaveAt: sql`coalesce(${transcriptSessionStates.firstNonemptySaveAt}, clock_timestamp())` })
        .where(and(eq(transcriptSessionStates.learningSessionId, learningSessionId), sql`${transcriptSessionStates.transcriptStorageCreatedAt} is not null`));
      await temp.update(transcriptSessionStates).set({ transcriptDeleteDeadlineAt: row.transcriptDeleteDeadlineAt }).where(eq(transcriptSessionStates.learningSessionId, learningSessionId));
    });
    await tx.update(learningSessions).set({ confirmedSaveSequenceNumber: saveSequenceNumber, learningConnectionExpiresAt: new Date(now.getTime() + 45_000) }).where(eq(learningSessions.learningSessionId, learningSessionId));
    return { confirmedSaveSequenceNumber: saveSequenceNumber };
  });
}

export async function endLearning(loginSessionToken: string | undefined, learningSessionId: string, learningConnectionToken: string) {
  return withIdentity(loginSessionToken, async (tx, who) => {
    const row = await requireOwnedLearningSession(tx, who, learningSessionId), now = await dbNow(tx);
    if (row.learningSessionEndedAt) return { learningSessionEndedAt: row.learningSessionEndedAt.toISOString() };
    requireLearningConnection(row, learningConnectionToken, now);
    const transcriptDeleteDeadlineAt = new Date(now.getTime() + DAY);
    await tx.update(learningSessions).set({ learningSessionStatus: "ended", learningSessionEndedAt: now, transcriptDeleteDeadlineAt, noteGenerationStatus: "waiting_save", learningConnectionExpiresAt: new Date(now.getTime() + 45_000) }).where(eq(learningSessions.learningSessionId, learningSessionId));
    await tx.insert(scheduledJobs).values({ targetUserId: who.userId, targetLearningSessionId: learningSessionId, jobType: "note", scheduledRunAt: new Date(now.getTime() + 60_000) });
    return { learningSessionEndedAt: now.toISOString() };
  });
}

// Deliberately small synthetic summary; actual AI selection is still B-09/B-06 work.
function buildDemoNoteMarkdown(conversationSnapshot: ConversationSnapshot, learningSessionEndedAt: Date) {
  const userTurns = conversationSnapshot.turns.filter(t => t.role === "user");
  if (!userTurns.length) return null;
  const escaped = (text: string) => text.slice(0, 160).replace(/[&<>\\`*_[\]{}()#!|]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] ?? "\\" + c)).replace(/\r?\n/g, "\n> ");
  return `# ${formatKstDate(learningSessionEndedAt.toISOString())} 영어 학습 노트\n\n가짜 AI 저장 시험 · 실제 언어 평가 결과가 아닙니다.\n\n${conversationSnapshot.hasConversationGaps ? "일부 대화 기록이 누락됐습니다.\n\n" : ""}## 대화 근거 일부\n\n` + userTurns.slice(-3).map(t => `> ${escaped(t.text)}\n\n근거: ${t.turnId}`).join("\n\n") + "\n";
}
export async function finalizeLearningNote(tx: RecordsTransaction, row: LearningRow) {
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
  const conversationSnapshot = await readConfirmed(row);
  const noteMarkdown = buildDemoNoteMarkdown(conversationSnapshot, row.learningSessionEndedAt);
  if (noteMarkdown) await tx.insert(learningSessionNotes).values({ learningSessionId: row.learningSessionId, userId: row.userId, learningEndDateKst: formatKstDate(row.learningSessionEndedAt.toISOString()), noteMarkdown,
    noteRetentionExpiresAt: new Date(row.learningSessionEndedAt.getTime() + 30 * DAY) }).onConflictDoNothing();
  await tx.update(learningSessions).set({ noteGenerationStatus: noteMarkdown ? "ready" : "empty", learningConnectionTokenHash: null }).where(eq(learningSessions.learningSessionId, row.learningSessionId));
  // Commit durable note first. The worker deletes the source in a subsequent transaction.
}
export async function completeLearningNote(loginSessionToken: string | undefined, learningSessionId: string) {
  await withIdentity(loginSessionToken, async (tx, who) => {
    const row = await requireOwnedLearningSession(tx, who, learningSessionId);
    await finalizeLearningNote(tx, row);
  });
  await withIdentity(loginSessionToken, async (tx, who) => {
    const row = await requireOwnedLearningSession(tx, who, learningSessionId);
    if (["ready", "empty", "expired"].includes(row.noteGenerationStatus)) await deleteTranscriptSource(learningSessionId, transcriptDeletionReason(row.noteGenerationStatus));
  });
}
export async function listLearningRecords(loginSessionToken: string | undefined): Promise<LearningRecordsResponse> {
  return withIdentity(loginSessionToken, async (tx, who) => {
    const now = await dbNow(tx);
    const sessions = await tx.select({ learningSessionId: learningSessions.learningSessionId, learningSessionStatus: learningSessions.learningSessionStatus, noteGenerationStatus: learningSessions.noteGenerationStatus, learningSessionEndedAt: learningSessions.learningSessionEndedAt })
      .from(learningSessions).where(eq(learningSessions.userId, who.userId));
    const saved = await tx.select().from(learningSessionNotes).where(and(eq(learningSessionNotes.userId, who.userId), sql`${learningSessionNotes.noteRetentionExpiresAt} > ${now}`));
    return { emailAddress: who.emailAddress, sessions, notes: saved.map(n => ({ learningEndDateKst: n.learningEndDateKst, noteMarkdown: n.noteMarkdown })) };
  });
}
