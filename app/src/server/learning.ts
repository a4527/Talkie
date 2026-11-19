import "server-only";
import { priorLearningWindow, selectPriorLearningContext } from "../voice/prior-learning";
import { requireVoiceTestConfiguration } from "./voice-token";
import { buildVoiceNoteMarkdown } from "../voice/note";
import { extractNote, NOTE_EXTRACTION_LIMITS, type ExtractionGenerate, type ExtractionRun } from "../voice/note-extraction";
import { createGeminiExtractionGenerate } from "./voice-cascade";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { AppError } from "./config";
import { DAY, dbNow, digest, token, withIdentity, type Identity } from "./auth";
import { databases, type RecordsTransaction } from "./db";
import { scheduledJobs, learningSessions, learningSessionNotes, learningSessionMissions, learningMissionResults, learningMissionResultDetails, learningNoteReviewExclusions } from "./db/records-schema";
import { readNoteContext } from "../voice/note-context";
import { evaluateMission, type AreaScores, type EvaluationRun } from "../mission/evaluation";
import { currentMission, describeJudgements, listMissionCatalog, findMissionDefinition, findMissionRubric, toPublicMission, type LanguageLevel, type MissionMode, type MissionStartRequest, type PublicMission } from "../mission/definitions";
import { achievementDateFor, DEFAULT_MISSION_TIME_ZONE, resolutionUnconfirmed } from "../mission/achievement";
import { holdMissionUsage, missionAllowance, settleMissionUsage } from "./mission-usage";
import { DEFAULT_NO_PROGRESS_THRESHOLD, findCompletedRoute } from "../mission/realtime";
import { missionProgressRouteIds, resumeMissionProgress, validateMissionProgress, type MissionProgress, type MissionRouteEvent } from "../mission/progress";
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
    learningState: source.learning, hasConversationGaps: source.gaps, missionProgress: decodeStoredMissionProgress(source.mission),
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
  let missionProgress: MissionProgress | undefined;
  try { missionProgress = validateMissionProgress(value.missionProgress, turns); } catch { throw new AppError("INVALID_RECORD"); }
  return { turns, corrections, learningState: value.learningState, hasConversationGaps: value.hasConversationGaps === true, ...(missionProgress ? { missionProgress } : {}) };
}
function decodeStoredMissionProgress(stored: unknown) {
  if (stored === undefined) return undefined;
  const m = stored as { events?: unknown; noProgress?: { count?: unknown; turns?: unknown } } | null;
  return { routeEvents: Array.isArray(m?.events) ? m.events.map(e => e && ({ eventId: e.id, kind: e.kind, routeId: e.route, evidenceTurnId: e.turn })) : m?.events,
    noProgress: m?.noProgress && { count: m.noProgress.count, evidenceTurnIds: m.noProgress.turns } };
}

// This is a storage compatibility codec, not a new persistence format. Property
// order matches the previous validator, including gaps:false, for SHA-256 replay.
export function encodeStoredConversationSnapshot(conversationSnapshot: ConversationSnapshot) {
  return {
    turns: conversationSnapshot.turns.map(t => ({ id: t.turnId, requestId: t.requestId, role: t.role, text: t.text })),
    corrections: conversationSnapshot.corrections.map(c => ({ id: c.correctionId, sourceTurnId: c.sourceTurnId, deliveredTurnId: c.deliveredTurnId, replacement: c.replacement, explanation: c.explanation, attempts: c.attempts })),
    learning: conversationSnapshot.learningState, gaps: conversationSnapshot.hasConversationGaps === true,
    // Appended only when non-empty so snapshots without mission progress keep their legacy bytes/hash.
    ...(conversationSnapshot.missionProgress ? { mission: {
      events: conversationSnapshot.missionProgress.routeEvents.map(e => ({ id: e.eventId, kind: e.kind, route: e.routeId, turn: e.evidenceTurnId })),
      noProgress: { count: conversationSnapshot.missionProgress.noProgress.count, turns: conversationSnapshot.missionProgress.noProgress.evidenceTurnIds },
    } } : {}),
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
  const stored = await databases().transcripts.select({
    saveSequenceNumber: transcriptSaves.saveSequenceNumber, conversationSnapshot: transcriptSaves.conversationSnapshot,
    hasDiscardedUnconfirmedSave: transcriptSessionStates.hasDiscardedUnconfirmedSave,
  }).from(transcriptSaves)
    .innerJoin(transcriptSessionStates, eq(transcriptSaves.learningSessionId, transcriptSessionStates.learningSessionId))
    .where(and(eq(transcriptSaves.learningSessionId, row.learningSessionId), sql`${transcriptSaves.saveSequenceNumber} <= ${row.confirmedSaveSequenceNumber}`))
    .orderBy(asc(transcriptSaves.saveSequenceNumber));
  if (!stored.length || stored.at(-1)!.saveSequenceNumber !== row.confirmedSaveSequenceNumber) throw new AppError("RECORD_UNAVAILABLE", 409);
  const turns = new Map<string, LearningSessionState["turns"][number]>(), corrections = new Map<string, Correction>();
  let learningState: ConversationSnapshot["learningState"] = "conversation", hasConversationGaps = stored[0].hasDiscardedUnconfirmedSave;
  // Route events accumulate by ID like corrections (a bounded client window may drop old ones);
  // the no-progress streak is the latest save's value.
  const routeEvents = new Map<string, MissionRouteEvent>();
  let noProgress: MissionProgress["noProgress"] = { count: 0, evidenceTurnIds: [] };
  for (const saved of stored) {
    const conversationSnapshot = validateConversationSnapshot(saved.conversationSnapshot);
    for (const turn of conversationSnapshot.turns) {
      const old = turns.get(turn.turnId);
      if (old && JSON.stringify(old) !== JSON.stringify(turn)) throw new AppError("SAVE_SEQUENCE_CONFLICT", 409);
      turns.set(turn.turnId, turn);
    }
    for (const correction of conversationSnapshot.corrections) corrections.set(correction.correctionId, correction);
    for (const event of conversationSnapshot.missionProgress?.routeEvents ?? []) {
      const old = routeEvents.get(event.eventId);
      if (old && JSON.stringify(old) !== JSON.stringify(event)) throw new AppError("SAVE_SEQUENCE_CONFLICT", 409);
      routeEvents.set(event.eventId, event);
    }
    noProgress = conversationSnapshot.missionProgress?.noProgress ?? { count: 0, evidenceTurnIds: [] };
    learningState = conversationSnapshot.learningState; hasConversationGaps ||= conversationSnapshot.hasConversationGaps === true;
  }
  const missionProgress = routeEvents.size || noProgress.count ? { routeEvents: [...routeEvents.values()], noProgress } : undefined;
  return { turns: [...turns.values()], corrections: [...corrections.values()], learningState, hasConversationGaps, ...(missionProgress ? { missionProgress } : {}) };
}
/**
 * Called only while rotating the connection, with the session row locked. A save committed to the
 * temporary DB whose confirmation failed belongs to the retired connection: the new connection
 * restores confirmed state only and may build a different next save, so the stale upload is removed
 * instead of blocking that sequence. Lock order matches saveLearning (records row, then state row).
 * If the records transaction later rolls back, only unconfirmed data was lost; an identical retry re-inserts it.
 */
async function discardUnconfirmedSaves(row: LearningRow) {
  return databases().transcripts.transaction(async temp => {
    const [state] = await temp.select().from(transcriptSessionStates).where(eq(transcriptSessionStates.learningSessionId, row.learningSessionId)).for("update");
    if (!state || state.sourceDeletedAt) return false;
    const unconfirmed = await temp.delete(transcriptSaves)
      .where(and(eq(transcriptSaves.learningSessionId, row.learningSessionId), sql`${transcriptSaves.saveSequenceNumber} > ${row.confirmedSaveSequenceNumber}`))
      .returning({ snapshotHash: transcriptSaves.snapshotHash });
    if (state.hasDiscardedUnconfirmedSave || !unconfirmed.length) return state.hasDiscardedUnconfirmedSave;
    const [confirmed] = await temp.select({ snapshotHash: transcriptSaves.snapshotHash }).from(transcriptSaves)
      .where(and(eq(transcriptSaves.learningSessionId, row.learningSessionId), eq(transcriptSaves.saveSequenceNumber, row.confirmedSaveSequenceNumber)));
    if (unconfirmed.every(save => save.snapshotHash === confirmed?.snapshotHash)) return false;
    await temp.update(transcriptSessionStates).set({ hasDiscardedUnconfirmedSave: true })
      .where(eq(transcriptSessionStates.learningSessionId, row.learningSessionId));
    return true;
  });
}
type MissionRow = typeof learningSessionMissions.$inferSelect;
function publicMissionFromRow(row: MissionRow): PublicMission {
  const definition = findMissionDefinition(row.missionId, row.definitionVersion);
  // Stored versions are never removed from the registry; a miss is a deployment error, not user input.
  if (!definition) throw new AppError("MISSION_UNAVAILABLE", 503);
  return toPublicMission(definition, row.rubricVersion, { missionMode: row.missionMode as PublicMission["missionMode"], languageLevel: row.languageLevel as PublicMission["languageLevel"] });
}
/**
 * Starts or resumes the account's single open learning session. A mission start always uses the
 * private voice path and fixes mission/version/mode/level at creation; resuming ignores the request
 * values and returns the stored ones. Mission and legacy free sessions never resume as each other.
 */
export async function startLearning(loginSessionToken: string | undefined, demoScenario: string, missionRequest?: MissionStartRequest, missionTimeZone = DEFAULT_MISSION_TIME_ZONE) {
  if (missionRequest && demoScenario !== "voice") throw new AppError("INVALID_REQUEST");
  const mission = missionRequest && currentMission(missionRequest.missionId);
  if (missionRequest && !mission) throw new AppError("INVALID_MISSION");
  if (demoScenario === "voice") requireVoiceTestConfiguration();
  return withIdentity(loginSessionToken, async (tx, who) => {
    const now = await dbNow(tx);
    const [previous] = await tx.select().from(learningSessions).where(and(eq(learningSessions.userId, who.userId), inArray(learningSessions.learningSessionStatus, ["active", "interrupted"]))).for("update");
    if (previous?.learningConnectionExpiresAt && previous.learningConnectionExpiresAt > now && previous.learningSessionStatus === "active") throw new AppError("ALREADY_CONNECTED", 409);
    if (previous) {
      if ((previous.demoScenario === "voice") !== (demoScenario === "voice")) throw new AppError("LEARNING_MODE_CONFLICT", 409);
      const [previousMission] = await tx.select().from(learningSessionMissions).where(eq(learningSessionMissions.learningSessionId, previous.learningSessionId));
      if (!!previousMission !== !!missionRequest) throw new AppError("LEARNING_MODE_CONFLICT", 409);
      const learningSessionInterruptedAt = previous.learningSessionInterruptedAt ?? previous.learningConnectionExpiresAt ?? now;
      if (now.getTime() >= learningSessionInterruptedAt.getTime() + DAY) throw new AppError("SESSION_CLOSING", 409);
      const { missionProgress: storedProgress, ...confirmed } = await readConfirmed(previous), missionProgress = resumeMissionProgress(storedProgress);
      const discarded = await discardUnconfirmedSaves(previous);
      const conversationSnapshot: ConversationSnapshot = {
        ...confirmed, hasConversationGaps: confirmed.hasConversationGaps === true || discarded, ...(missionProgress ? { missionProgress } : {}),
      };
      const learningConnectionToken = token();
      await tx.update(learningSessions).set({ learningSessionStatus: "active", learningSessionInterruptedAt: null, learningConnectionTokenHash: digest(learningConnectionToken), learningConnectionExpiresAt: new Date(now.getTime() + 45_000) }).where(eq(learningSessions.learningSessionId, previous.learningSessionId));
      return { learningSessionId: previous.learningSessionId, learningConnectionToken, confirmedSaveSequenceNumber: previous.confirmedSaveSequenceNumber, demoScenario: previous.demoScenario, conversationSnapshot,
        mission: previousMission ? publicMissionFromRow(previousMission) : null };
    }
    if (!["correction", "conversation", "voice"].includes(demoScenario)) throw new AppError("INVALID_SCENARIO");
    const learningSessionId = randomUUID(), learningConnectionToken = token();
    // A new mission holds one count in this transaction; resuming above never holds another (DEC-096).
    if (mission && missionRequest) await holdMissionUsage(tx, who.userId, learningSessionId, now);
    const emptyConversationSnapshot: ConversationSnapshot = { turns: [], corrections: [], learningState: "conversation", hasConversationGaps: false };
    await tx.insert(learningSessions).values({ learningSessionId, userId: who.userId, learningSessionStartedAt: now, learningConnectionTokenHash: digest(learningConnectionToken), learningConnectionExpiresAt: new Date(now.getTime() + 45_000), demoScenario });
    let fixedMission: PublicMission | null = null;
    if (mission && missionRequest) {
      // Same records transaction as the session row: an open session never exists without its fixed mission.
      await tx.insert(learningSessionMissions).values({ learningSessionId, userId: who.userId, missionId: mission.definition.missionId, definitionVersion: mission.definition.definitionVersion,
        rubricVersion: mission.rubric.rubricVersion, missionMode: missionRequest.missionMode, languageLevel: missionRequest.languageLevel, missionTimeZone });
      fixedMission = toPublicMission(mission.definition, mission.rubric.rubricVersion, missionRequest);
    }
    await databases().transcripts.transaction(async temp => {
      await temp.insert(transcriptSessionStates).values({ learningSessionId, userId: who.userId, transcriptStorageCreatedAt: sql`clock_timestamp()` });
      await temp.insert(transcriptSaves).values({ learningSessionId, saveSequenceNumber: 0, snapshotHash: digest(JSON.stringify(encodeStoredConversationSnapshot(emptyConversationSnapshot))), conversationSnapshot: encodeStoredConversationSnapshot(emptyConversationSnapshot) });
    });
    return { learningSessionId, learningConnectionToken, confirmedSaveSequenceNumber: 0, demoScenario, conversationSnapshot: emptyConversationSnapshot, mission: fixedMission };
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
    if (conversationSnapshot.missionProgress) {
      // Progress only belongs to a mission session and may only name routes of its fixed definition.
      const [missionRow] = await tx.select().from(learningSessionMissions).where(eq(learningSessionMissions.learningSessionId, learningSessionId));
      const routes = new Set(missionRow ? findMissionDefinition(missionRow.missionId, missionRow.definitionVersion)?.routes.map(r => r.routeId) : []);
      if (!missionRow || [...missionProgressRouteIds(conversationSnapshot.missionProgress)].some(id => !routes.has(id))) throw new AppError("INVALID_RECORD");
    }
    if (saveSequenceNumber < row.confirmedSaveSequenceNumber || saveSequenceNumber > row.confirmedSaveSequenceNumber + 1) throw new AppError("SAVE_SEQUENCE_CONFLICT", 409);
    await databases().transcripts.transaction(async temp => {
      const [stored] = await temp.select().from(transcriptSessionStates).where(eq(transcriptSessionStates.learningSessionId, learningSessionId)).for("update");
      if (!stored || stored.sourceDeletedAt || (stored.transcriptDeleteDeadlineAt && stored.transcriptDeleteDeadlineAt <= now)) throw new AppError("SESSION_CLOSED", 409);
      const history = await temp.select().from(transcriptSaves).where(and(eq(transcriptSaves.learningSessionId, learningSessionId), sql`${transcriptSaves.saveSequenceNumber} <= ${row.confirmedSaveSequenceNumber}`));
      const known = new Map<string, string>(), knownEvents = new Map<string, string>();
      for (const saved of history) {
        const previousSnapshot = validateConversationSnapshot(saved.conversationSnapshot);
        for (const turn of previousSnapshot.turns) known.set(turn.turnId, JSON.stringify(turn));
        for (const event of previousSnapshot.missionProgress?.routeEvents ?? []) knownEvents.set(event.eventId, JSON.stringify(event));
      }
      if (conversationSnapshot.turns.some(turn => known.has(turn.turnId) && known.get(turn.turnId) !== JSON.stringify(turn))) throw new AppError("SAVE_SEQUENCE_CONFLICT", 409);
      // Confirmed route events are immutable, like turns; otherwise a later read of the sequence would fail.
      if (conversationSnapshot.missionProgress?.routeEvents.some(e => knownEvents.has(e.eventId) && knownEvents.get(e.eventId) !== JSON.stringify(e))) throw new AppError("SAVE_SEQUENCE_CONFLICT", 409);
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

/** Test value until the operational threshold is decided (PRD 4.2.2). */
export const MISSION_NO_PROGRESS_THRESHOLD = DEFAULT_NO_PROGRESS_THRESHOLD;
/**
 * Records a mission session's end reason and final route once, after saves can no longer change
 * (note phase or automatic close). The reason is derived from confirmed progress with the same
 * validator as the browser, never from a client claim: a verified route completion wins, then a
 * verified real-mode no-progress streak, otherwise `fallback`.
 */
export async function recordMissionEnd(tx: RecordsTransaction, row: LearningRow, fallback: "user_ended" | "resume_expired") {
  if (!row.learningSessionEndedAt) return;
  const [mission] = await tx.select().from(learningSessionMissions).where(eq(learningSessionMissions.learningSessionId, row.learningSessionId)).for("update");
  if (!mission || mission.missionEndReason) return;
  let snapshot: ConversationSnapshot | undefined;
  try { snapshot = row.confirmedSaveSequenceNumber > 0 ? await readConfirmed(row) : undefined; } catch { snapshot = undefined; } // Deleted or missing source: no verified progress.
  const order = new Map(snapshot?.turns.map((t, i) => [t.turnId, i]) ?? []);
  const routes = new Set(findMissionDefinition(mission.missionId, mission.definitionVersion)?.routes.map(r => r.routeId) ?? []);
  const finalRouteId = findCompletedRoute((snapshot?.missionProgress?.routeEvents ?? []).filter(e => routes.has(e.routeId)), id => order.get(id)) ?? null;
  const noProgress = snapshot?.missionProgress?.noProgress;
  const missionEndReason = finalRouteId ? "goal_completed"
    : mission.missionMode === "real" && noProgress && noProgress.count >= MISSION_NO_PROGRESS_THRESHOLD && noProgress.evidenceTurnIds.every(id => order.has(id)) ? "no_progress_failed" : fallback;
  await tx.update(learningSessionMissions).set({ missionEndReason, finalRouteId }).where(and(eq(learningSessionMissions.learningSessionId, row.learningSessionId), isNull(learningSessionMissions.missionEndReason)));
  // The evaluation is owed only when the learner said something (DEC-087: no-utterance sessions skip it like the note).
  const evaluationStatus = snapshot?.turns.some(t => t.role === "user") ? "pending" : "skipped";
  // The count held at start is used only when the learner actually spoke (DEC-096), the same condition that owes an evaluation.
  await settleMissionUsage(tx, row.learningSessionId, evaluationStatus === "pending", await dbNow(tx));
  await tx.insert(learningMissionResults).values({ learningSessionId: row.learningSessionId, userId: row.userId, evaluationStatus }).onConflictDoNothing();
}
/** The fixed mission when its evaluation is still owed and the source can still be read; otherwise undefined. */
export async function pendingMissionEvaluation(tx: RecordsTransaction, row: LearningRow, now: Date) {
  if (!row.learningSessionEndedAt || !row.transcriptDeleteDeadlineAt || row.transcriptDeleteDeadlineAt <= now) return;
  const [result] = await tx.select().from(learningMissionResults).where(eq(learningMissionResults.learningSessionId, row.learningSessionId));
  if (result?.evaluationStatus !== "pending") return;
  const [mission] = await tx.select().from(learningSessionMissions).where(eq(learningSessionMissions.learningSessionId, row.learningSessionId));
  return mission;
}
/** True while a mission evaluation is still owed; the source must not be deleted before it settles. */
async function missionEvaluationPending(tx: RecordsTransaction, learningSessionId: string) {
  const [result] = await tx.select({ status: learningMissionResults.evaluationStatus }).from(learningMissionResults).where(eq(learningMissionResults.learningSessionId, learningSessionId));
  return result?.status === "pending";
}
/** Deletes the temporary source only when the note and any mission evaluation have both settled (DEC-087). */
export async function deleteSettledSource(tx: RecordsTransaction, row: LearningRow) {
  if (settled(row.noteGenerationStatus) && !await missionEvaluationPending(tx, row.learningSessionId)) await deleteTranscriptSource(row.learningSessionId, transcriptDeletionReason(row.noteGenerationStatus));
}
/** Reads confirmed text and calls the evaluator. No lock or transaction may be held by the caller. Null means retry later. */
export async function evaluateMissionSession(row: LearningRow, mission: MissionRow, deps: NoteDeps = {}): Promise<EvaluationRun | null> {
  const definition = findMissionDefinition(mission.missionId, mission.definitionVersion), rubric = findMissionRubric(mission.missionId, mission.rubricVersion);
  if (!definition || !rubric) return null;
  try {
    const snapshot = await readConfirmed(row);
    return await evaluateMission(snapshot, { definition, rubric, missionMode: mission.missionMode as MissionMode, languageLevel: mission.languageLevel as LanguageLevel,
      missionEndReason: mission.missionEndReason, finalRouteId: mission.finalRouteId }, { generate: deps.evaluate ?? deps.generate ?? createGeminiExtractionGenerate(), signal: AbortSignal.timeout(160_000) });
  } catch { return null; }
}
/** Stores a validated evaluation once. The details expire with the note; the aggregate stays (DEC-088). */
export async function storeMissionEvaluation(tx: RecordsTransaction, row: LearningRow, run: EvaluationRun) {
  if (!row.learningSessionEndedAt || !row.transcriptDeleteDeadlineAt || !await missionEvaluationPending(tx, row.learningSessionId)) return;
  const now = await dbNow(tx);
  if (row.transcriptDeleteDeadlineAt <= now) return;
  // The achievement date is fixed here, from the end time and the zone fixed at start, and never recomputed (DEC-095).
  const [mission] = await tx.select({ missionId: learningSessionMissions.missionId, rubricVersion: learningSessionMissions.rubricVersion, missionEndReason: learningSessionMissions.missionEndReason, missionTimeZone: learningSessionMissions.missionTimeZone })
    .from(learningSessionMissions).where(eq(learningSessionMissions.learningSessionId, row.learningSessionId));
  const rubric = mission && findMissionRubric(mission.missionId, mission.rubricVersion);
  const achievementDate = mission && rubric ? achievementDateFor({ meetsThreshold: run.score.meetsThreshold, missionEndReason: mission.missionEndReason, learningSessionEndedAt: row.learningSessionEndedAt,
    missionTimeZone: mission.missionTimeZone, resolutionUnconfirmed: resolutionUnconfirmed(run.judgements, rubric.goalCriteria) }) : null;
  await tx.update(learningMissionResults).set({ evaluationStatus: "ready", areaScores: run.score.areas, totalEarnedHalf: run.score.totalEarnedHalf, totalMaxHalf: run.score.totalMaxHalf,
    meetsThreshold: run.score.meetsThreshold, evaluatedAt: now, achievementDate }).where(and(eq(learningMissionResults.learningSessionId, row.learningSessionId), eq(learningMissionResults.evaluationStatus, "pending")));
  await tx.insert(learningMissionResultDetails).values({ learningSessionId: row.learningSessionId, userId: row.userId, judgements: run.judgements,
    detailRetentionExpiresAt: new Date(row.learningSessionEndedAt.getTime() + NOTE_RETENTION_DAYS * DAY) }).onConflictDoNothing();
}

// Deliberately small synthetic summary; actual AI selection is still B-09/B-06 work.
function buildDemoNoteMarkdown(conversationSnapshot: ConversationSnapshot, learningSessionEndedAt: Date) {
  const userTurns = conversationSnapshot.turns.filter(t => t.role === "user");
  if (!userTurns.length) return null;
  const escaped = (text: string) => text.slice(0, 160).replace(/[&<>\\`*_[\]{}()#!|]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] ?? "\\" + c)).replace(/\r?\n/g, "\n> ");
  return `# ${formatKstDate(learningSessionEndedAt.toISOString())} 영어 학습 노트\n\n가짜 AI 저장 시험 · 실제 언어 평가 결과가 아닙니다.\n\n${conversationSnapshot.hasConversationGaps ? "일부 대화 기록이 누락됐습니다.\n\n" : ""}## 대화 근거 일부\n\n` + userTurns.slice(-3).map(t => `> ${escaped(t.text)}\n\n근거: ${t.turnId}`).join("\n\n") + "\n";
}
/** `evaluate` overrides the mission evaluation transport; both default to the note extraction model. */
export type NoteDeps = { generate?: ExtractionGenerate; evaluate?: ExtractionGenerate };
const NOTE_RETENTION_DAYS = 30;
const settled = (status: string) => ["ready", "empty", "expired"].includes(status);
/** True when a voice note still needs the model. The model call must happen outside any database transaction. */
export function needsVoiceExtraction(row: LearningRow, now: Date) {
  return row.demoScenario === "voice" && !!row.learningSessionEndedAt && !!row.transcriptDeleteDeadlineAt && !settled(row.noteGenerationStatus) && row.transcriptDeleteDeadlineAt > now;
}
/** Reads confirmed text and calls the model. No lock or transaction may be held by the caller. A total failure returns null. */
export async function extractVoiceNote(row: LearningRow, deps: NoteDeps = {}): Promise<ExtractionRun | null> {
  try {
    const snapshot = await readConfirmed(row);
    if (!snapshot.turns.some(t => t.role === "user")) return { contextItems: [], detailItems: [], failedChunks: 0, totalChunks: 0, oversizedChunks: 0, omittedChunks: 0, droppedItems: 0, calls: 0 };
    const run = await extractNote(snapshot, { generate: deps.generate ?? createGeminiExtractionGenerate(), signal: AbortSignal.timeout(NOTE_EXTRACTION_LIMITS.totalTimeoutMs + 5000) });
    // No fallback note: with no usable chunk the session stays pending for a later retry before the deadline.
    return run.totalChunks - run.failedChunks > 0 && (run.contextItems.length > 0 || run.detailItems.length > 0) ? run : null;
  } catch { return null; }
}
/**
 * Writes the note. For a voice session the caller passes the extraction made outside the transaction;
 * without it a voice note stays pending and nothing is stored.
 */
export async function finalizeLearningNote(tx: RecordsTransaction, row: LearningRow, extraction?: ExtractionRun | null) {
  if (!row.learningSessionEndedAt || !row.transcriptDeleteDeadlineAt) return;
  const now = await dbNow(tx);
  // An evaluation not settled by the source deadline is unavailable (DEC-089): no score, no achievement.
  if (row.transcriptDeleteDeadlineAt <= now) await tx.update(learningMissionResults).set({ evaluationStatus: "unavailable" })
    .where(and(eq(learningMissionResults.learningSessionId, row.learningSessionId), eq(learningMissionResults.evaluationStatus, "pending")));
  // The caller checks both durable results in a separate transaction before deleting the source.
  if (settled(row.noteGenerationStatus)) return;
  if (row.transcriptDeleteDeadlineAt <= now) {
    await deleteTranscriptSource(row.learningSessionId, "deadline_expired");
    await tx.update(learningSessions).set({ noteGenerationStatus: "expired", learningConnectionTokenHash: null }).where(eq(learningSessions.learningSessionId, row.learningSessionId));
    return;
  }
  if (row.demoScenario === "voice" && !extraction) return;
  const conversationSnapshot = await readConfirmed(row);
  const endedAt = row.learningSessionEndedAt.toISOString();
  const [missionRow] = await tx.select({ learningSessionId: learningSessionMissions.learningSessionId }).from(learningSessionMissions).where(eq(learningSessionMissions.learningSessionId, row.learningSessionId));
  const noteMarkdown = row.demoScenario === "voice"
    ? buildVoiceNoteMarkdown(conversationSnapshot, endedAt, extraction!.contextItems, { details: extraction!.detailItems, incomplete: extraction!.failedChunks > 0 || extraction!.omittedChunks > 0 || extraction!.droppedItems > 0 },
      { mission: !!missionRow })
    : buildDemoNoteMarkdown(conversationSnapshot, row.learningSessionEndedAt);
  if (noteMarkdown) await tx.insert(learningSessionNotes).values({ learningSessionId: row.learningSessionId, userId: row.userId, learningEndDateKst: formatKstDate(endedAt), noteMarkdown,
    noteRetentionExpiresAt: new Date(row.learningSessionEndedAt.getTime() + NOTE_RETENTION_DAYS * DAY) }).onConflictDoNothing();
  await tx.update(learningSessions).set({ noteGenerationStatus: noteMarkdown ? "ready" : "empty", learningConnectionTokenHash: null }).where(eq(learningSessions.learningSessionId, row.learningSessionId));
  // Commit durable note first. The worker deletes the source in a subsequent transaction.
}
export async function completeLearningNote(loginSessionToken: string | undefined, learningSessionId: string, deps: NoteDeps = {}) {
  // 1) Short transaction: record the mission end, settle what needs no model, or capture what does.
  const pending = await withIdentity(loginSessionToken, async (tx, who) => {
    const row = await requireOwnedLearningSession(tx, who, learningSessionId), now = await dbNow(tx);
    await recordMissionEnd(tx, row, "user_ended");
    const note = needsVoiceExtraction(row, now), mission = await pendingMissionEvaluation(tx, row, now);
    if (!note && !mission) { await finalizeLearningNote(tx, row); return null; }
    return { row, note, mission };
  });
  if (pending) {
    // 2) Model calls with no lock and no transaction held; the note and the evaluation are requested together (DEC-087).
    const [extraction, evaluation] = await Promise.all([
      pending.note ? extractVoiceNote(pending.row, deps) : Promise.resolve(undefined),
      pending.mission ? evaluateMissionSession(pending.row, pending.mission, deps) : Promise.resolve(undefined)]);
    // 3) Short transaction: the row is locked again; results made from an older save are discarded.
    await withIdentity(loginSessionToken, async (tx, who) => {
      const row = await requireOwnedLearningSession(tx, who, learningSessionId);
      if (row.confirmedSaveSequenceNumber !== pending.row.confirmedSaveSequenceNumber) return;
      if (evaluation) await storeMissionEvaluation(tx, row, evaluation);
      await finalizeLearningNote(tx, row, pending.note ? extraction : undefined);
    });
  }
  // 4) Whichever side settles last deletes the source, with both states re-read under the session lock.
  await withIdentity(loginSessionToken, async (tx, who) => {
    const row = await requireOwnedLearningSession(tx, who, learningSessionId);
    if (!settled(row.noteGenerationStatus) || await missionEvaluationPending(tx, row.learningSessionId)) throw new AppError("NOTE_PENDING", 503);
    await deleteSettledSource(tx, row);
  });
}
export async function listLearningRecords(loginSessionToken: string | undefined): Promise<LearningRecordsResponse> {
  return withIdentity(loginSessionToken, async (tx, who) => {
    const now = await dbNow(tx);
    const rows = await tx.select({ learningSessionId: learningSessions.learningSessionId, learningSessionStatus: learningSessions.learningSessionStatus, noteGenerationStatus: learningSessions.noteGenerationStatus,
      demoScenario: learningSessions.demoScenario, learningSessionStartedAt: learningSessions.learningSessionStartedAt, learningSessionEndedAt: learningSessions.learningSessionEndedAt,
      mission: { missionId: learningSessionMissions.missionId, definitionVersion: learningSessionMissions.definitionVersion, rubricVersion: learningSessionMissions.rubricVersion,
        missionMode: learningSessionMissions.missionMode, languageLevel: learningSessionMissions.languageLevel, missionEndReason: learningSessionMissions.missionEndReason, finalRouteId: learningSessionMissions.finalRouteId },
      missionResult: { evaluationStatus: learningMissionResults.evaluationStatus, areaScores: learningMissionResults.areaScores, totalEarnedHalf: learningMissionResults.totalEarnedHalf,
        totalMaxHalf: learningMissionResults.totalMaxHalf, meetsThreshold: learningMissionResults.meetsThreshold, achievementDate: learningMissionResults.achievementDate } })
      .from(learningSessions).leftJoin(learningSessionMissions, and(eq(learningSessionMissions.learningSessionId, learningSessions.learningSessionId), eq(learningSessionMissions.userId, who.userId)))
      .leftJoin(learningMissionResults, and(eq(learningMissionResults.learningSessionId, learningSessions.learningSessionId), eq(learningMissionResults.userId, who.userId)))
      .where(eq(learningSessions.userId, who.userId)).orderBy(desc(learningSessions.learningSessionStartedAt));
    // Expired detail rows are not shown even before the maintenance job deletes them.
    const details = await tx.select({ learningSessionId: learningMissionResultDetails.learningSessionId, judgements: learningMissionResultDetails.judgements }).from(learningMissionResultDetails)
      .where(and(eq(learningMissionResultDetails.userId, who.userId), sql`${learningMissionResultDetails.detailRetentionExpiresAt} > ${now}`));
    const judgementsBySession = new Map(details.map(d => [d.learningSessionId, d.judgements as Parameters<typeof describeJudgements>[2]]));
    // Raw half-point values only; display strings and rounding are made on screen (DEC-080).
    const sessions = rows.map(r => {
      const judgements = r.mission && judgementsBySession.get(r.learningSessionId);
      return { ...r, missionResult: r.missionResult ? { ...r.missionResult, areaScores: r.missionResult.areaScores as AreaScores | null,
        criteria: judgements && r.mission ? describeJudgements(r.mission.missionId, r.mission.rubricVersion, judgements) : null } : null,
        learningSessionStartedAt: r.learningSessionStartedAt.toISOString(), learningSessionEndedAt: r.learningSessionEndedAt?.toISOString() ?? null };
    });
    const saved = await tx.select().from(learningSessionNotes).where(and(eq(learningSessionNotes.userId, who.userId), sql`${learningSessionNotes.noteRetentionExpiresAt} > ${now}`))
      .orderBy(desc(learningSessionNotes.learningEndDateKst));
    // Several credited missions on one local date count once (PRD 4.5).
    const [days] = await tx.select({ count: sql<number>`count(distinct ${learningMissionResults.achievementDate})::int` }).from(learningMissionResults)
      .where(and(eq(learningMissionResults.userId, who.userId), isNotNull(learningMissionResults.achievementDate)));
    const excluded = await reviewExclusions(tx, who.userId);
    return { emailAddress: who.emailAddress, missions: listMissionCatalog(), missionAllowance: await missionAllowance(tx, who.userId), achievementDayCount: days?.count ?? 0, sessions,
      notes: saved.map(n => ({ learningSessionId: n.learningSessionId, learningEndDateKst: n.learningEndDateKst, noteMarkdown: n.noteMarkdown, excludedReviewItems: excluded.get(n.learningSessionId) ?? [] })) };
  });
}

/** Review items each of the user's notes has turned off, by learning session (DEC-098). */
async function reviewExclusions(tx: RecordsTransaction, userId: string) {
  const rows = await tx.select({ learningSessionId: learningNoteReviewExclusions.learningSessionId, reviewItemNumber: learningNoteReviewExclusions.reviewItemNumber })
    .from(learningNoteReviewExclusions).where(eq(learningNoteReviewExclusions.userId, userId)).orderBy(asc(learningNoteReviewExclusions.reviewItemNumber));
  const bySession = new Map<string, number[]>();
  for (const r of rows) bySession.set(r.learningSessionId, [...(bySession.get(r.learningSessionId) ?? []), r.reviewItemNumber]);
  return bySession;
}
/**
 * Turns one review item of the learner's own retained note on or off for later review (DEC-098).
 * The note text itself never changes; only items the note actually shows as `review-N` can be chosen.
 */
export async function setNoteReviewChoice(loginSessionToken: string | undefined, learningSessionId: string, reviewItemNumber: unknown, included: unknown) {
  if (!Number.isInteger(reviewItemNumber) || (reviewItemNumber as number) < 1 || typeof included !== "boolean" || !/^[0-9a-f-]{36}$/.test(learningSessionId)) throw new AppError("INVALID_REQUEST");
  const item = reviewItemNumber as number;
  return withIdentity(loginSessionToken, async (tx, who) => {
    const now = await dbNow(tx);
    const [note] = await tx.select().from(learningSessionNotes).where(and(eq(learningSessionNotes.learningSessionId, learningSessionId), eq(learningSessionNotes.userId, who.userId),
      sql`${learningSessionNotes.noteRetentionExpiresAt} > ${now}`)).for("update");
    if (!note) throw new AppError("NOT_FOUND", 404);
    if (!readNoteContext(note.noteMarkdown).some(i => i.kind === "review" && i.noteItemNumber === item)) throw new AppError("INVALID_REQUEST");
    if (included) await tx.delete(learningNoteReviewExclusions).where(and(eq(learningNoteReviewExclusions.learningSessionId, learningSessionId), eq(learningNoteReviewExclusions.reviewItemNumber, item)));
    else await tx.insert(learningNoteReviewExclusions).values({ learningSessionId, userId: who.userId, reviewItemNumber: item, excludedAt: now }).onConflictDoNothing();
    return { ok: true as const };
  });
}

export async function getVoiceLearningContext(loginSessionToken: string | undefined, learningSessionId: string, learningConnectionToken: string) {
  return withIdentity(loginSessionToken, async (tx, who) => {
    const row = await requireOwnedLearningSession(tx, who, learningSessionId), now = await dbNow(tx);
    requireLearningConnection(row, learningConnectionToken, now);
    if (row.demoScenario !== "voice") throw new AppError("LEARNING_MODE_CONFLICT", 409);
    const window = priorLearningWindow(now);
    const notes = await tx.select({ learningSessionId: learningSessionNotes.learningSessionId, learningEndDateKst: learningSessionNotes.learningEndDateKst, noteMarkdown: learningSessionNotes.noteMarkdown })
      .from(learningSessionNotes).innerJoin(learningSessions, eq(learningSessionNotes.learningSessionId, learningSessions.learningSessionId))
      .where(and(eq(learningSessionNotes.userId, who.userId), eq(learningSessions.userId, who.userId),
        eq(learningSessions.demoScenario, "voice"), eq(learningSessions.learningSessionStatus, "ended"), eq(learningSessions.noteGenerationStatus, "ready"),
        gte(learningSessionNotes.learningEndDateKst, window.fromDateKst), lte(learningSessionNotes.learningEndDateKst, window.toDateKst),
        sql`${learningSessionNotes.learningSessionId} <> ${learningSessionId}`, sql`${learningSessionNotes.noteRetentionExpiresAt} > ${now}`));
    // Difficulty uses the latest retained valid observation independently of the review window.
    const difficultyNotes = await tx.select({ learningEndDateKst: learningSessionNotes.learningEndDateKst, noteMarkdown: learningSessionNotes.noteMarkdown })
      .from(learningSessionNotes).innerJoin(learningSessions, eq(learningSessionNotes.learningSessionId, learningSessions.learningSessionId))
      .where(and(eq(learningSessionNotes.userId, who.userId), eq(learningSessions.userId, who.userId),
        eq(learningSessions.demoScenario, "voice"), eq(learningSessions.learningSessionStatus, "ended"), eq(learningSessions.noteGenerationStatus, "ready"),
        lte(learningSessionNotes.learningEndDateKst, window.toDateKst),
        sql`${learningSessionNotes.learningSessionId} <> ${learningSessionId}`, sql`${learningSessionNotes.noteRetentionExpiresAt} > ${now}`));
    // Fixed mission for the server-built realtime instruction; partner knowledge never leaves the server.
    const [missionRow] = await tx.select().from(learningSessionMissions).where(eq(learningSessionMissions.learningSessionId, learningSessionId));
    const definition = missionRow ? findMissionDefinition(missionRow.missionId, missionRow.definitionVersion) : undefined;
    if (missionRow && !definition) throw new AppError("MISSION_UNAVAILABLE", 409);
    const mission = missionRow && definition ? { definition, missionMode: missionRow.missionMode as MissionMode, languageLevel: missionRow.languageLevel as LanguageLevel } : undefined;
    const excluded = await reviewExclusions(tx, who.userId);
    const withChoices = notes.map(n => ({ ...n, excludedReviewItems: excluded.get(n.learningSessionId) ?? [] }));
    return { userId: who.userId, priorLearningContext: selectPriorLearningContext(withChoices, difficultyNotes), ...(mission ? { mission } : {}) };
  });
}
