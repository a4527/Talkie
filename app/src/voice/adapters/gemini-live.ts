import type { VoiceListener, VoicePort } from "../port";
import { createGeminiLiveSetup } from "../gemini-live-setup";

export type GeminiLiveCredential = { voiceConnectionToken: string };
const endpoint = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";

/** Direct browser transport. A cascade or remote-server adapter can implement VoicePort separately. */
export class GeminiLiveAdapter implements VoicePort {
  private socket?: WebSocket;
  private ready = false;
  private stopped = false;
  private outputTurnId = "";
  private inputTurnId = "";
  private lastOutputTurnId = "";
  private pending?: { resolve: () => void; reject: (error: Error) => void };
  private timer?: ReturnType<typeof setTimeout>;
  private queue = Promise.resolve();
  constructor(private credential: GeminiLiveCredential, private emit: VoiceListener,
    private createSocket: (url: string) => WebSocket = url => new WebSocket(url)) {}

  connect(): Promise<void> {
    if (this.socket || this.stopped) return Promise.reject(new Error("VOICE_CONNECTION_STATE"));
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.timer = setTimeout(() => this.fail("timeout"), 15_000);
      try {
        const socket = this.createSocket(`${endpoint}?access_token=${encodeURIComponent(this.credential.voiceConnectionToken)}`);
        this.credential = { voiceConnectionToken: "" };
        this.socket = socket;
        socket.onopen = () => { if (!this.stopped) socket.send(JSON.stringify({ setup: createGeminiLiveSetup() })); };
        socket.onmessage = event => {
          // Blob decoding is asynchronous; serialize it so interruption cannot overtake earlier audio.
          this.queue = this.queue.then(async () => {
            if (this.stopped) return;
            const text = typeof event.data === "string" ? event.data : await event.data.text();
            if (text.length > 1024 * 1024) throw new Error("VOICE_MESSAGE_TOO_LARGE");
            if (!this.stopped) this.receive(JSON.parse(text));
          }).catch(() => { this.fail("protocol"); });
        };
        socket.onerror = () => this.fail("connection");
        socket.onclose = () => this.close(); // Never surface provider reasons or raw payloads.
      } catch { this.fail("connection"); }
    });
  }
  private fail(code: "connection" | "protocol" | "timeout") {
    if (this.stopped) return;
    this.emit({ type: "error", code });
    this.close();
  }
  private receive(message: Record<string, any>) {
    if (message.error) { this.fail("connection"); return; }
    if (message.setupComplete && !this.ready) {
      this.ready = true;
      clearTimeout(this.timer);
      this.pending?.resolve(); this.pending = undefined;
      this.emit({ type: "connected" });
    }
    if (!this.ready) return;
    const content = message.serverContent;
    if (!content) return;
    if (content.interrupted) {
      if (this.outputTurnId || this.lastOutputTurnId) this.emit({ type: "interrupted", turnId: this.outputTurnId || this.lastOutputTurnId });
      this.lastOutputTurnId = "";
      this.outputTurnId = ""; this.inputTurnId = "";
      return;
    }
    if (typeof content.inputTranscription?.text === "string" && content.inputTranscription.text) {
      this.inputTurnId ||= crypto.randomUUID();
      this.emit({ type: "transcript", role: "user", turnId: this.inputTurnId, text: content.inputTranscription.text });
    }
    if (typeof content.outputTranscription?.text === "string" && content.outputTranscription.text) {
      this.outputTurnId ||= crypto.randomUUID();
      this.emit({ type: "transcript", role: "assistant", turnId: this.outputTurnId, text: content.outputTranscription.text });
    }
    for (const part of content.modelTurn?.parts ?? []) {
      if (!part.inlineData) continue;
      if (!part.inlineData.mimeType?.startsWith("audio/pcm")) throw new Error("VOICE_AUDIO_FORMAT");
      const binary = atob(part.inlineData.data);
      this.outputTurnId ||= crypto.randomUUID();
      const sampleRateHz = Number(/rate=(\d+)/.exec(part.inlineData.mimeType)?.[1] ?? 24000);
      if (sampleRateHz !== 24000 || binary.length % 2) throw new Error("VOICE_AUDIO_FORMAT");
      this.emit({ type: "audio", turnId: this.outputTurnId, pcm: Uint8Array.from(binary, c => c.charCodeAt(0)), sampleRateHz });
    }
    if (content.turnComplete) {
      if (this.outputTurnId) {
        this.lastOutputTurnId = this.outputTurnId;
        this.emit({ type: "response-complete", turnId: this.outputTurnId });
      }
      this.outputTurnId = ""; this.inputTurnId = "";
    }
  }
  sendAudio(pcm: Uint8Array, sampleRateHz: number) {
    if (!this.ready || this.stopped || !this.socket) return;
    if (this.socket.bufferedAmount > 128 * 1024) { this.fail("connection"); return; }
    let binary = "";
    for (const byte of pcm) binary += String.fromCharCode(byte);
    this.socket.send(JSON.stringify({ realtimeInput: { audio: { data: btoa(binary), mimeType: `audio/pcm;rate=${sampleRateHz}` } } }));
  }
  close() {
    if (this.stopped) return;
    this.stopped = true; this.ready = false;
    clearTimeout(this.timer);
    this.pending?.reject(new Error("VOICE_CONNECTION_CLOSED")); this.pending = undefined;
    this.socket?.close(); this.socket = undefined;
    this.credential = { voiceConnectionToken: "" };
    this.emit({ type: "closed" });
  }
}
