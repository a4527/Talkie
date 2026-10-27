import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { GeminiLiveAdapter } from "../src/voice/adapters/gemini-live";
import { updateVoiceTranscriptTurns } from "../src/voice/transcript";
import { issueVoiceToken } from "../src/server/voice-token";
import { createGeminiLiveSetup } from "../src/voice/gemini-live-setup";
import type { VoiceEvent } from "../src/voice/port";

class Socket {
  onopen?: () => void; onmessage?: (event: { data: string }) => void;
  onclose?: () => void; onerror?: () => void;
  bufferedAmount = 0; sent: any[] = []; closed = false;
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { this.closed = true; }
  message(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); }
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture() {
  const socket = new Socket(), events: VoiceEvent[] = [];
  const factory = vi.fn((_url: string) => socket as unknown as WebSocket);
  const adapter = new GeminiLiveAdapter({ voiceConnectionToken: "auth_tokens/synthetic" }, event => events.push(event), factory);
  return { adapter, socket, events, factory };
}
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
describe("provider-neutral voice boundary", () => {
  it("waits for setup acknowledgement before sending mic audio and uses a constrained ephemeral connection", async () => {
    const { adapter, socket, factory, events } = fixture();
    const ready = adapter.connect(); socket.onopen?.();
    expect(factory.mock.calls[0][0]).toContain("BidiGenerateContentConstrained?access_token=auth_tokens%2F");
    expect(socket.sent).toEqual([{ setup: createGeminiLiveSetup() }]);
    adapter.sendAudio(new Uint8Array([0, 0]), 48000);
    expect(socket.sent).toHaveLength(1);
    socket.message({ setupComplete: {} }); await ready;
    adapter.sendAudio(new Uint8Array([0, 0]), 48000);
    expect(socket.sent[1]).toEqual({ realtimeInput: { audio: { data: "AAA=", mimeType: "audio/pcm;rate=48000" } } });
    expect(events).toEqual([{ type: "connected" }]); adapter.close();
  });
  it("maps every audio part, keeps response completion separate from playback, and handles a playback-time interruption", async () => {
    const { adapter, socket, events } = fixture();
    const ready = adapter.connect(); socket.message({ setupComplete: {} }); await ready;
    socket.message({ serverContent: { outputTranscription: { text: "Hello" }, modelTurn: { parts: [
      { inlineData: { mimeType: "audio/pcm;rate=24000", data: "AAA=" } },
      { inlineData: { mimeType: "audio/pcm;rate=24000", data: "AQA=" } },
    ] }, turnComplete: true } }); await flush();
    const transcript = events.find(event => event.type === "transcript")!;
    expect(events.filter(event => event.type === "audio")).toHaveLength(2);
    const records = updateVoiceTranscriptTurns([], transcript);
    const complete = events.find(event => event.type === "response-complete")!;
    expect(updateVoiceTranscriptTurns(records, complete)[0].delivery).toBe("unconfirmed");
    socket.message({ serverContent: { interrupted: true } }); await flush();
    const interrupted = events.find(event => event.type === "interrupted")!;
    const stopped = updateVoiceTranscriptTurns(records, interrupted);
    expect(stopped[0].delivery).toBe("interrupted");
    expect(updateVoiceTranscriptTurns(stopped, { type: "played", turnId: records[0].turnId })[0].delivery).toBe("interrupted");
    adapter.close();
  });
  it("drops late content and audio after close", async () => {
    const { adapter, socket, events } = fixture();
    const ready = adapter.connect(); socket.message({ setupComplete: {} }); await ready;
    adapter.close(); socket.message({ serverContent: { outputTranscription: { text: "late" } } });
    adapter.sendAudio(new Uint8Array([0, 0]), 48000); await flush();
    expect(events.map(event => event.type)).toEqual(["connected", "closed"]);
    expect(socket.sent).toHaveLength(0); expect(socket.closed).toBe(true);
  });
  it("bounds microphone backpressure and hides provider error bodies", async () => {
    const { adapter, socket, events } = fixture();
    const ready = adapter.connect(); socket.message({ setupComplete: {} }); await ready;
    socket.bufferedAmount = 200_000; adapter.sendAudio(new Uint8Array([0, 0]), 48000);
    socket.message({ error: { message: "private provider content" } }); await flush();
    expect(events.map(event => event.type)).toEqual(["connected", "error", "closed"]);
    expect(JSON.stringify(events)).not.toContain("private");
  });
  it("rejects a pending connection on cancellation", async () => {
    const { adapter } = fixture(); const ready = adapter.connect();
    adapter.close(); await expect(ready).rejects.toThrow("VOICE_CONNECTION_CLOSED");
  });
  it("closes a connection that never acknowledges setup", async () => {
    vi.useFakeTimers(); const { adapter, events } = fixture();
    const result = expect(adapter.connect()).rejects.toThrow("VOICE_CONNECTION_CLOSED");
    await vi.advanceTimersByTimeAsync(15_000); await result;
    expect(events).toContainEqual({ type: "error", code: "timeout" });
  });
});
describe("local credential broker", () => {
  function enable() {
    vi.stubEnv("TALKIE_VOICE_TEST", "gemini-free"); vi.stubEnv("GEMINI_FREE_TIER_CONFIRMED", "true");
    vi.stubEnv("GOOGLE_API_KEY", "synthetic-key"); vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
  }
  it("makes no external request without explicit free-tier configuration", async () => {
    vi.stubEnv("TALKIE_VOICE_TEST", "disabled"); const request = vi.fn();
    await expect(issueVoiceToken("disabled", request)).rejects.toThrow("VOICE_TEST_DISABLED"); expect(request).not.toHaveBeenCalled();
  });
  it("locks model and setup, limits lifetime and uses, and throttles duplicate issuance", async () => {
    enable(); const request = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json({ name: "auth_tokens/synthetic" }));
    expect(await issueVoiceToken("enabled", request)).toEqual({ voiceConnectionToken: "auth_tokens/synthetic", testDurationSeconds: 180 });
    const payload = JSON.parse(request.mock.calls[0][1]!.body as string);
    expect(payload.bidiGenerateContentSetup).toEqual(createGeminiLiveSetup()); expect(payload.uses).toBe(1);
    expect(Date.parse(payload.expireTime) - Date.parse(payload.newSessionExpireTime)).toBe(180_000);
    await expect(issueVoiceToken("enabled", request)).rejects.toThrow("VOICE_TEST_WAIT"); expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not leak upstream errors and keeps uncertain requests reserved", async () => {
    enable(); const request = vi.fn(async () => new Response("private upstream body", { status: 429 }));
    await expect(issueVoiceToken("upstream-error", request)).rejects.toThrow("VOICE_TOKEN_UNAVAILABLE");
    await expect(issueVoiceToken("upstream-error", request)).rejects.toThrow("VOICE_TEST_WAIT");
  });
});
