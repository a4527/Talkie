import type { PriorLearningContext } from "./prior-learning";
import type { VoiceLearningResult } from "./learning";
import type { ConversationSnapshot } from "../learning/types";
/** App-owned contract: provider payloads, credentials and browser devices stay outside learning code. */
export type VoiceEvent =
  | { type: "connected" }
  | { type: "transcript"; role: "user" | "assistant"; turnId: string; text: string }
  | { type: "audio"; turnId: string; pcm: Uint8Array; sampleRateHz: number }
  | { type: "learning-cancelled"; turnId: string }
  | { type: "input-complete"; turnId: string }
  | { type: "learning-result"; turnId: string; inputTurnId: string; result: VoiceLearningResult }
  | { type: "response-complete"; turnId: string; inputTurnId?: string }
  | { type: "interrupted"; turnId: string }
  | { type: "closed" }
  | { type: "error"; code: "connection" | "protocol" | "timeout" | "billing" };

export interface VoicePort {
  connect(context?: ConversationSnapshot, priorLearningContext?: PriorLearningContext): Promise<void>;
  sendAudio(pcm: Uint8Array, sampleRateHz: number): void;
  /** Output-device acknowledgement, never a generation-complete signal. */
  acknowledgePlayback?(turnId: string): void;
  close(): void;
}
export type VoiceListener = (event: VoiceEvent) => void;
