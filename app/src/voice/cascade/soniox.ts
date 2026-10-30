import type { RecognitionEvent, SpeechRecognizer } from "./providers";
import { SonioxEvents } from "./soniox-events";

/** Browser transport requires a server-minted temporary key. */
export class SonioxRecognizer implements SpeechRecognizer {
  private socket?: WebSocket;
  private stopped = false;
  private rate?: number;
  private decoder?: SonioxEvents;
  constructor(private key: string, private createSocket: (url: string, protocols: string[]) => WebSocket = (url, protocols) => new WebSocket(url, protocols)) {}
  connect(emit: (event: RecognitionEvent) => void, signal: AbortSignal): Promise<void> {
    if (this.socket || this.stopped || signal.aborted) return Promise.reject(new Error("STT_STATE"));
    this.decoder = new SonioxEvents(emit);
    return new Promise((resolve, reject) => {
      let connected = false;
      const socket = this.createSocket("wss://stt-rt.soniox.com/transcribe-websocket", ["soniox-api-key", this.key]);
      this.key = ""; this.socket = socket;
      signal.addEventListener("abort", () => { this.close(); if (!connected) reject(new Error("STT_CLOSED")); }, { once: true });
      socket.onopen = () => { if (!this.stopped) { connected = true; resolve(); } };
      socket.onmessage = event => {
        if (this.stopped) return;
        try { if (typeof event.data !== "string" || event.data.length > 256 * 1024) throw new Error(); this.decoder?.receive(JSON.parse(event.data)); }
        catch { emit({ type: "error" }); this.close(); }
      };
      const failed = () => { if (!this.stopped) { if (!connected) reject(new Error("STT_CONNECTION")); else emit({ type: "error" }); this.close(); } };
      socket.onerror = failed; socket.onclose = failed;
    });
  }
  sendAudio(pcm: Uint8Array, sampleRateHz: number) {
    const socket = this.socket;
    if (!socket || this.stopped || socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 128 * 1024) throw new Error("STT_BACKLOG");
    if (this.rate === undefined) {
      this.rate = sampleRateHz;
      socket.send(JSON.stringify({ model: "stt-rt-v5", audio_format: "pcm_s16le", sample_rate: sampleRateHz, num_channels: 1, language_hints: ["en", "ko"], enable_endpoint_detection: true }));
    }
    if (this.rate !== sampleRateHz) throw new Error("STT_RATE_CHANGED");
    socket.send(new Uint8Array(pcm));
  }
  close() { if (this.stopped) return; this.stopped = true; this.key = ""; this.decoder?.clear(); this.socket?.close(); this.socket = undefined; }
}
