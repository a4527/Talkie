import type { MissionProgress } from "../mission/progress";
import type { ScoreArea } from "../mission/constants";

export type LearningState = "conversation" | "retry";
export type LearningPhase = "ready" | "waiting" | LearningState | "paused" | "ended";

export interface Turn {
  turnId: string;
  requestId: string;
  role: "user" | "assistant";
  text: string;
}

export interface Correction {
  correctionId: string;
  sourceTurnId: string;
  deliveredTurnId: string;
  replacement: string;
  explanation: string;
  attempts: { turnId: string; outcome: "success" | "failure" }[];
}

export interface LearningReply {
  text: string;
  learningState: LearningState;
  correction?: { replacement: string; explanation: string };
  retryOutcome?: "success" | "failure";
}

export interface LearningRequest {
  learningSessionId: string;
  requestId: string;
  text?: string;
  learningState: LearningState;
  turns: readonly Turn[];
  corrections: readonly Correction[];
}

export interface NoteItem {
  sourceTurnId: string;
  original: string;
  deliveredTurnId: string;
  replacement: string;
  explanation: string;
  attempts: Correction["attempts"];
}

export interface Note {
  learningEndDateKst: string;
  evidence: { turnId: string; text: string }[];
  items: NoteItem[];
}

export interface NoteRequest {
  requestId: string;
  endedAt: string;
  turns: readonly Turn[];
  corrections: readonly Correction[];
}

// Text prototype contract. Streaming/cancellation/playback events are still needed for voice.
export interface LearningProvider {
  respond(request: LearningRequest): Promise<LearningReply>;
  createNote(request: NoteRequest): Promise<Note>;
}

export interface LearningMetric {
  requestId: string;
  event: "transition" | "response" | "note";
  from: LearningPhase;
  to: LearningPhase;
  result: "ok" | "failed" | "ignored";
  elapsedMs: number;
}

export type ClientNoteGenerationStatus = "idle" | "loading" | "ready" | "failed" | "empty";

export interface LearningSessionState {
  hasConversationGaps?: boolean;
  learningSessionId: string;
  phase: LearningPhase;
  learningState: LearningState;
  turns: readonly Turn[];
  corrections: readonly Correction[];
  pending?: LearningRequest;
  lastConfirmedTurnId?: string;
  endedAt?: string;
  noteGenerationStatus: ClientNoteGenerationStatus;
  note?: Note;
  statusMessage: string;
  metrics: readonly LearningMetric[];
}

export type ConversationSnapshot = Pick<LearningSessionState, "turns" | "corrections" | "learningState"> & { hasConversationGaps?: boolean;
  /** Mission sessions only; omitted when empty so legacy snapshots keep their bytes and hash. */
  missionProgress?: MissionProgress };

// Browser-safe response fields; no credentials, database rows or server imports.
export interface MissionCatalogEntry { missionId: string; title: string; situation: string; learnerRole: string; partnerRole: string; goals: string[]; routes: { routeId: string; label: string }[] }
/** One rubric criterion with its stored verdict; labels/points come from the fixed rubric version. */
export interface MissionCriterionResult { criterionId: string; area: ScoreArea; label: string; points: number; verdict: "met" | "partial" | "unmet" | "undeterminable"; reason: string; evidence: string[]; counterEvidence: string[] }
export interface LearningRecordsResponse {
  emailAddress: string;
  /** Startable missions for the selection screen (no partner knowledge or rubric evidence). */
  missions: MissionCatalogEntry[];
  /** Mission count for new starts: held and confirmed starts are used (DEC-096). `limit` is a local test value. */
  missionAllowance: { limit: number; remaining: number };
  /** Distinct local dates credited by confirmed missions at or above 80% (PRD 4.5, DEC-095). */
  achievementDayCount: number;
  notes: { learningSessionId: string; learningEndDateKst: string; noteMarkdown: string }[];
  sessions: { learningSessionId: string; learningSessionStatus: string; noteGenerationStatus: string; demoScenario: string; learningSessionStartedAt: string; learningSessionEndedAt: string | null;
    /** Null for legacy free-conversation sessions. */
    mission: { missionId: string; definitionVersion: number; rubricVersion: number; missionMode: string; languageLevel: string; missionEndReason: string | null; finalRouteId: string | null } | null;
    /** Null until a mission session ends. Scores are half-point integers; `meetsThreshold` is null when nothing was evaluable. */
    missionResult: { evaluationStatus: string; areaScores: Record<"goal" | "grammar" | "vocabulary" | "organization" | "interaction", { earnedHalf: number; maxHalf: number }> | null;
      totalEarnedHalf: number | null; totalMaxHalf: number | null; meetsThreshold: boolean | null;
      /** Local YYYY-MM-DD this mission credited as an achievement day; null when it did not count. */
      achievementDate: string | null;
      /** Per-criterion verdicts while the detail row is kept (expires with the note); null otherwise. */
      criteria: MissionCriterionResult[] | null } | null }[];
}
