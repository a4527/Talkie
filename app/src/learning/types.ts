export type LearningState = "conversation" | "retry";
export type Phase = "ready" | "waiting" | LearningState | "paused" | "ended";

export interface Turn {
  id: string;
  requestId: string;
  role: "user" | "assistant";
  text: string;
}

export interface Correction {
  id: string;
  sourceTurnId: string;
  deliveredTurnId: string;
  replacement: string;
  explanation: string;
  attempts: { turnId: string; outcome: "success" | "failure" }[];
}

export interface Reply {
  text: string;
  learning: LearningState;
  correction?: { replacement: string; explanation: string };
  retryOutcome?: "success" | "failure";
}

export interface Request {
  sessionId: string;
  requestId: string;
  text?: string;
  learning: LearningState;
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
  date: string;
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
export interface Provider {
  respond(request: Request): Promise<Reply>;
  createNote(request: NoteRequest): Promise<Note>;
}

export interface Metric {
  requestId: string;
  event: "transition" | "response" | "note";
  from: Phase;
  to: Phase;
  result: "ok" | "failed" | "ignored";
  elapsedMs: number;
}

export interface Session {
  sessionId: string;
  phase: Phase;
  learning: LearningState;
  turns: readonly Turn[];
  corrections: readonly Correction[];
  pending?: Request;
  lastConfirmedTurnId?: string;
  endedAt?: string;
  noteStatus: "idle" | "loading" | "ready" | "failed" | "empty";
  note?: Note;
  message: string;
  metrics: readonly Metric[];
}
