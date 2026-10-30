import type { RecognitionEvent } from "./providers";

/** Convert Soniox token revisions into one final utterance. Partial tokens never become evidence. */
export class SonioxEvents {
  private id?: string;
  private finalText = "";
  constructor(private emit: (event: RecognitionEvent) => void, private makeId = () => crypto.randomUUID()) {}
  receive(message: unknown) {
    if (!message || typeof message !== "object") throw new Error("INVALID_STT_MESSAGE");
    const response = message as { error_code?: unknown; tokens?: unknown };
    if (response.error_code) { this.emit({ type: "error", ...(response.error_code === 402 ? { code: "billing" as const } : {}) }); return; }
    if (!Array.isArray(response.tokens)) throw new Error("INVALID_STT_MESSAGE");
    for (const item of response.tokens) {
      if (!item || typeof item.text !== "string" || typeof item.is_final !== "boolean") throw new Error("INVALID_STT_TOKEN");
      if (item.text === "<end>") {
        if (!item.is_final) throw new Error("INVALID_STT_ENDPOINT");
        if (this.id) this.emit({ type: "final", utteranceId: this.id, text: this.finalText });
        this.id = undefined; this.finalText = ""; continue;
      }
      if (!item.text) continue;
      if (!this.id) { this.id = this.makeId(); this.emit({ type: "speech-start", utteranceId: this.id }); }
      if (item.is_final) {
        this.finalText += item.text;
        if (this.finalText.length > 6000) throw new Error("STT_TEXT_TOO_LONG");
      }
    }
  }
  clear() { this.id = undefined; this.finalText = ""; }
}
