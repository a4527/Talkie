import { expect, it, vi } from "vitest";
import { SonioxRecognizer } from "../src/voice/cascade/soniox";
it("uses temporary websocket credential, configures PCM once and normalizes final transcription", async () => {
  vi.stubGlobal("WebSocket", { OPEN: 1 });
  const socket = { readyState: 1, bufferedAmount: 0, send: vi.fn(), close: vi.fn(), onopen: null as null | (() => void), onmessage: null as null | ((e: { data: string }) => void), onerror: null, onclose: null };
  const create = vi.fn(() => socket as unknown as WebSocket); const events: unknown[] = [];
  const recognizer = new SonioxRecognizer("temporary-test-key", create); const abort = new AbortController();
  const pending = recognizer.connect(e => events.push(e), abort.signal); socket.onopen!(); await pending;
  expect(create).toHaveBeenCalledWith("wss://stt-rt.soniox.com/transcribe-websocket", ["soniox-api-key", "temporary-test-key"]);
  recognizer.sendAudio(new Uint8Array(4), 16000); recognizer.sendAudio(new Uint8Array(4), 16000);
  expect(socket.send).toHaveBeenCalledTimes(3);
  expect(JSON.parse(socket.send.mock.calls[0][0] as string)).toMatchObject({ model: "stt-rt-v5", sample_rate: 16000, enable_endpoint_detection: true });
  socket.onmessage!({ data: JSON.stringify({ tokens: [{ text: "hello", is_final: true }, { text: "<end>", is_final: true }] }) });
  expect(events).toMatchObject([{ type: "speech-start" }, { type: "final", text: "hello" }]);
  expect(() => recognizer.sendAudio(new Uint8Array(4), 48000)).toThrow(); abort.abort(); expect(socket.close).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});
