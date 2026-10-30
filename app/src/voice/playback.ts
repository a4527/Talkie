import type { VoiceEvent } from "./port";

export interface VoiceAudioOutput {
  play(pcm: Uint8Array, sampleRateHz: number): void;
  drained(): Promise<boolean>;
  interrupt(): void;
}
/** Shared output-device bridge. Late drain promises cannot confirm cancelled or closed output. */
export class VoicePlayback {
  private generation = 0;
  private stopped = false;
  private audible = new Set<string>();
  constructor(private audio: VoiceAudioOutput, private played: (turnId: string) => void) {}
  handle(event: VoiceEvent) {
    if (this.stopped) return;
    if (event.type === "audio") {
      this.audio.play(event.pcm, event.sampleRateHz); this.audible.add(event.turnId);
    }
    if (event.type === "interrupted") {
      this.generation++; this.audible.clear(); this.audio.interrupt();
    }
    if (event.type === "response-complete" && this.audible.delete(event.turnId)) {
      const generation = this.generation;
      void this.audio.drained().then(played => {
        if (played && !this.stopped && this.generation === generation) this.played(event.turnId);
      }).catch(() => { /* Failed drain is never confirmation. */ });
    }
    if (event.type === "closed" || event.type === "error") this.close();
  }
  close() { if (this.stopped) return; this.stopped = true; this.generation++; this.audible.clear(); this.audio.interrupt(); }
}
