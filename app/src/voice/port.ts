/** App-owned contract: provider payloads, credentials and browser devices stay outside learning code. */
export type VoiceEvent =
  | { type: "connected" }
  | { type: "transcript"; role: "user" | "assistant"; turnId: string; text: string }
  | { type: "audio"; turnId: string; pcm: Uint8Array; sampleRateHz: number }
  | { type: "response-complete"; turnId: string }
  | { type: "interrupted"; turnId: string }
  | { type: "closed" }
  | { type: "error"; code: "connection" | "protocol" | "timeout" };

export interface VoicePort {
  connect(): Promise<void>;
  sendAudio(pcm: Uint8Array, sampleRateHz: number): void;
  close(): void;
}
export type VoiceListener = (event: VoiceEvent) => void;
