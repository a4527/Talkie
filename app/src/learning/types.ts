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

export type ConversationSnapshot = Pick<LearningSessionState, "turns" | "corrections" | "learningState"> & { hasConversationGaps?: boolean };

// Browser-safe response fields; no credentials, database rows or server imports.
export interface LearningRecordsResponse {
  emailAddress: string;
  notes: { learningEndDateKst: string; noteMarkdown: string }[];
  sessions: { learningSessionId: string; learningSessionStatus: string; noteGenerationStatus: string }[];
}
