import { expect, it, vi } from "vitest";
import { VoicePlayback } from "../src/voice/playback";
import { CascadeAdapter } from "../src/voice/adapters/cascade";
import { VoiceLearningRecords } from "../src/voice/learning";
import type { RecognitionEvent } from "../src/voice/cascade/providers";

it.each(["interrupted", "closed", "error"] as const)("ignores a stale successful drain after %s", async type => {
  let resolve!: (value: boolean) => void;
  const audio = { play: vi.fn(), interrupt: vi.fn(), drained: () => new Promise<boolean>(r => { resolve = r; }) };
  const played = vi.fn(), playback = new VoicePlayback(audio, played);
  playback.handle({ type: "audio", turnId: "a", pcm: new Uint8Array(2), sampleRateHz: 16000 });
  playback.handle({ type: "response-complete", turnId: "a" });
  playback.handle(type === "error" ? { type, code: "connection" } : type === "closed" ? { type } : { type, turnId: "a" });
  resolve(true); await Promise.resolve(); expect(played).not.toHaveBeenCalled(); expect(audio.interrupt).toHaveBeenCalledTimes(1);
});
it("does not confirm missing, failed or duplicate audio completion", async () => {
  const played = vi.fn(), drained = vi.fn(async () => false);
  const playback = new VoicePlayback({ play: vi.fn(), interrupt: vi.fn(), drained }, played);
  playback.handle({ type: "response-complete", turnId: "missing" });
  playback.handle({ type: "audio", turnId: "a", pcm: new Uint8Array(2), sampleRateHz: 16000 });
  playback.handle({ type: "response-complete", turnId: "a" });
  playback.handle({ type: "response-complete", turnId: "a" });
  await Promise.resolve(); expect(drained).toHaveBeenCalledTimes(1); expect(played).not.toHaveBeenCalled(); playback.close();
});
it("drives the same adapter/records acknowledgement path as the screen with a synthetic output device", async () => {
  let receive!: (event: RecognitionEvent) => void, finish!: (value: boolean) => void;
  const records = new VoiceLearningRecords();
  const playback = new VoicePlayback({ play: vi.fn(), interrupt: vi.fn(), drained: () => new Promise<boolean>(r => { finish = r; }) }, turnId => {
    port.acknowledgePlayback(turnId); records.apply({ type: "played", turnId });
  });
  const port = new CascadeAdapter({
    stt: { connect: async emit => { receive = emit; }, sendAudio: () => {}, close: () => {} },
    llm: { respond: async () => ({ text: "Say: I went home.", learningResult: { original: "I go home.", replacement: "I went home.", learningState: "retry" } }) },
    tts: { synthesize: async function* () { yield { pcm: new Uint8Array(320), sampleRateHz: 16000 }; } },
  }, event => { records.apply(event); playback.handle(event); }, { learning: true });
  await port.connect(); receive({ type: "speech-start", utteranceId: "one" }); receive({ type: "final", utteranceId: "one", text: "I go home." });
  for (let i = 0; i < 12; i++) await Promise.resolve();
  expect(records.getSnapshot().turns).toHaveLength(1); expect(records.getSnapshot().corrections).toHaveLength(0);
  finish(true); await Promise.resolve();
  expect(records.getSnapshot().turns).toHaveLength(2); expect(records.getSnapshot().corrections).toHaveLength(1);
  port.close();
});
