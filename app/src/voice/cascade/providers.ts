import type { ConversationSnapshot } from "../../learning/types";
import type { PriorLearningContext } from "../prior-learning";

/** Normalized STT events. IDs are unique per connection; final text is a whole utterance. */
export type RecognitionEvent =
  | { type: "speech-start"; utteranceId: string }
  | { type: "final"; utteranceId: string; text: string }
  | { type: "error"; code?: "billing" };
export interface SpeechRecognizer {
  connect(emit: (event: RecognitionEvent) => void, signal: AbortSignal): Promise<void>;
  sendAudio(pcm: Uint8Array, sampleRateHz: number): void;
  close(): void;
}
export type CascadeRequest = {
  instruction: string;
  context: ConversationSnapshot;
  priorLearningContext?: PriorLearningContext;
};
export interface TextResponder {
  // Stateless: every request contains only app-confirmed history. No hidden provider conversation.
  respond(request: CascadeRequest, signal: AbortSignal): Promise<{ text: string; learningResult?: unknown }>;
}
export type SpeechChunk = { pcm: Uint8Array; sampleRateHz: number };
export interface SpeechSynthesizer {
  synthesize(text: string, signal: AbortSignal): AsyncIterable<SpeechChunk>;
}
/** Inject transports, never permanent credentials. Network-backed implementations belong on the server. */
export type CascadeProviders = { stt: SpeechRecognizer; llm: TextResponder; tts: SpeechSynthesizer };
