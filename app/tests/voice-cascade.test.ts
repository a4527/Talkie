import { afterEach, expect, it, vi } from "vitest";
import { CascadeAdapter } from "../src/voice/adapters/cascade";
import { createVoicePort } from "../src/voice/create-port";
import { VoiceLearningRecords } from "../src/voice/learning";
import { VoiceLearningStore } from "../src/client/learning";
import type { VoiceEvent } from "../src/voice/port";
import type { CascadeProviders, CascadeRequest, RecognitionEvent } from "../src/voice/cascade/providers";

const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function fixture(options = {}) {
  let receive!: (event: RecognitionEvent) => void;
  const events: VoiceEvent[] = [], requests: CascadeRequest[] = [], signals: AbortSignal[] = [];
  const records = new VoiceLearningRecords();
  const providers: CascadeProviders = {
    stt: { connect: vi.fn(async emit => { receive = emit; }), sendAudio: vi.fn(), close: vi.fn() },
    llm: { respond: vi.fn(async (request, signal) => {
      requests.push(request); signals.push(signal);
      return { text: "Say: I went home.", learningResult: { original: request.context.turns.at(-1)!.text, learningState: "retry", replacement: "I went home." } };
    }) },
    tts: { synthesize: vi.fn(async function* () { yield { pcm: new Uint8Array(320), sampleRateHz: 16000 }; }) },
  };
  const port = new CascadeAdapter(providers, event => { events.push(event); records.apply(event); }, { learning: true, ...options });
  const start = (id: string) => receive({ type: "speech-start", utteranceId: id });
  const final = (id: string, text = "I go home yesterday.") => receive({ type: "final", utteranceId: id, text });
  const utterance = (id: string, text?: string) => { start(id); final(id, text); };
  const played = (turnId: string) => { port.acknowledgePlayback(turnId); records.apply({ type: "played", turnId }); };
  return { port, providers, events, records, requests, signals, start, final, utterance, played, receive: (event: RecognitionEvent) => receive(event) };
}
afterEach(() => vi.useRealTimers());

it("connects, transcribes, judges, synthesizes and only commits correction after playback", async () => {
  const f = fixture(); await f.port.connect(); f.port.sendAudio(new Uint8Array(320), 16000); f.utterance("a"); await tick();
  expect(f.providers.stt.sendAudio).toHaveBeenCalledTimes(1);
  expect(f.events.map(e => e.type)).toEqual(["connected", "transcript", "input-complete", "transcript", "learning-result", "audio", "response-complete"]);
  expect(f.records.getSnapshot().turns.map(t => t.role)).toEqual(["user"]);
  expect(f.records.getSnapshot().corrections).toEqual([]);
  const output = f.events.find(e => e.type === "response-complete")!;
  f.played(output.turnId); f.played(output.turnId);
  expect(f.records.getSnapshot().turns).toHaveLength(2);
  expect(f.records.getSnapshot().corrections).toHaveLength(1);
  expect(f.records.getSnapshot().learningState).toBe("retry");
  f.utterance("b", "I went home."); await tick();
  expect(f.requests[1].context.turns).toHaveLength(3);
  expect(f.requests[1].context.learningState).toBe("retry");
  f.port.close();
});

it("cancels completed generation awaiting playback and excludes its correction from next context", async () => {
  const f = fixture(); await f.port.connect(); f.utterance("a"); await tick();
  const turn = f.events.find(e => e.type === "response-complete")!;
  f.start("b"); f.played(turn.turnId); f.final("b"); await tick();
  expect(f.events).toContainEqual({ type: "interrupted", turnId: turn.turnId });
  expect(f.requests[1].context.turns.map(t => t.role)).toEqual(["user", "user"]);
  expect(f.requests[1].context.corrections).toEqual([]);
  expect(f.requests[1].context.learningState).toBe("conversation");
  expect(f.records.getSnapshot().turns).toHaveLength(2);
  f.port.close();
});

it("aborts superseded LLM and ignores late completion or rejection, while new input proceeds", async () => {
  for (const reject of [false, true]) {
    const f = fixture(); const late = deferred<{ text: string }>(); let signal!: AbortSignal;
    vi.mocked(f.providers.llm.respond).mockImplementationOnce((_request, s) => { signal = s; return late.promise; });
    await f.port.connect(); f.utterance("a"); await tick(); f.utterance("b"); await tick();
    expect(signal.aborted).toBe(true);
    const count = f.events.length;
    if (reject) late.reject(new Error("SECRET UPSTREAM PAYLOAD")); else late.resolve({ text: "stale" });
    await tick(); expect(f.events).toHaveLength(count);
    expect(f.events.filter(e => e.type === "response-complete")).toHaveLength(1);
    f.port.close();
  }
});

it("ignores late streamed audio after interruption and never emits completion for it", async () => {
  const f = fixture(); const late = deferred<void>(); let signal!: AbortSignal;
  vi.mocked(f.providers.tts.synthesize).mockImplementationOnce(async function* (_text, s) {
    signal = s; yield { pcm: new Uint8Array(320), sampleRateHz: 16000 };
    await late.promise; yield { pcm: new Uint8Array(320), sampleRateHz: 16000 };
  });
  await f.port.connect(); f.utterance("a"); await tick(); f.start("b");
  expect(signal.aborted).toBe(true); const count = f.events.length;
  late.resolve(); await tick(); expect(f.events).toHaveLength(count);
  expect(f.events.some(e => e.type === "response-complete")).toBe(false);
  f.port.close();
});

it("deduplicates finals, ignores superseded speech IDs and does not invent turns for silence", async () => {
  const f = fixture(); await f.port.connect(); f.start("a"); f.start("b"); f.final("a"); f.final("b", " ");
  f.utterance("c"); f.final("c"); f.utterance("c"); await tick();
  expect(f.providers.llm.respond).toHaveBeenCalledTimes(1);
  expect(f.records.getSnapshot().turns).toHaveLength(1); f.port.close();
});

it("does not roll back a played correction when a later response is cancelled; resume preserves evidence", async () => {
  const f = fixture(); await f.port.connect(); f.utterance("a"); await tick();
  f.played(f.events.find(e => e.type === "response-complete")!.turnId);
  f.utterance("b", "I went home."); await tick(); f.port.close();
  const saved = structuredClone(f.records.getSnapshot());
  expect(saved.learningState).toBe("retry"); expect(saved.corrections).toHaveLength(1);
  const next = fixture(); await next.port.connect(saved); next.utterance("c", "Can we talk about food?"); await tick();
  expect(next.requests[0].context.learningState).toBe("retry");
  expect(next.requests[0].context.turns).toHaveLength(4);
  expect(next.requests[0].context.corrections).toEqual(saved.corrections);
  next.port.close();
});

it("saves actual retry success once through the common store, retrying the same body after lost response", async () => {
  const f = fixture(); await f.port.connect(); f.utterance("a"); await tick();
  f.played(f.events.find(e => e.type === "response-complete")!.turnId);
  vi.mocked(f.providers.llm.respond).mockResolvedValueOnce({ text: "Good. Tea or coffee?", learningResult: { original: "I went home.", learningState: "conversation", retryOutcome: "success" } });
  f.utterance("b", "I went home."); await tick();
  const turn = f.events.filter(e => e.type === "response-complete").at(-1)!;
  expect(f.records.getSnapshot().learningState).toBe("retry");
  f.played(turn.turnId);
  const snapshot = f.records.getSnapshot();
  expect(snapshot.learningState).toBe("conversation"); expect(snapshot.corrections[0].attempts).toHaveLength(1);
  const calls: Record<string, unknown>[] = []; let lost = true;
  const store = new VoiceLearningStore({ learningSessionId: "synthetic", learningConnectionToken: "synthetic", confirmedSaveSequenceNumber: 0,
    conversationSnapshot: { turns: [], corrections: [], learningState: "conversation" } }, async data => {
    calls.push(data); if (data.action === "save" && lost) { lost = false; throw new Error("lost response"); } return {};
  });
  await expect(store.sync(snapshot)).rejects.toThrow("lost response");
  await Promise.all([store.sync(snapshot), store.sync(snapshot)]);
  const saves = calls.filter(c => c.action === "save"); expect(saves).toHaveLength(2); expect(saves[0]).toEqual(saves[1]);
  expect(saves[1].conversationSnapshot).toEqual(snapshot); f.port.close();
});

it.each(["wrong-original", "unspoken-replacement"])("does not accept learning evidence: %s", async mode => {
  const f = fixture();
  vi.mocked(f.providers.llm.respond).mockResolvedValue({ text: "Please try again.", learningResult: { original: mode === "wrong-original" ? "invented" : "I go home yesterday.", replacement: "I went home.", learningState: "retry" } });
  await f.port.connect(); f.utterance("a"); await tick(); f.played(f.events.find(e => e.type === "response-complete")!.turnId);
  expect(f.records.getSnapshot().corrections).toEqual([]); expect(f.records.getSnapshot().learningState).toBe("conversation"); f.port.close();
});

it.each(["llm", "tts-empty", "tts-error", "pcm-invalid", "result-invalid"])("fails closed without unplayed evidence or raw provider errors: %s", async mode => {
  const f = fixture();
  if (mode === "llm") vi.mocked(f.providers.llm.respond).mockRejectedValue(new Error("SECRET UPSTREAM PAYLOAD"));
  if (mode === "result-invalid") vi.mocked(f.providers.llm.respond).mockResolvedValue({ text: "hello", learningResult: { original: "" } });
  if (mode.startsWith("tts")) vi.mocked(f.providers.tts.synthesize).mockImplementation(async function* () { if (mode === "tts-error") throw new Error("SECRET"); });
  if (mode === "pcm-invalid") vi.mocked(f.providers.tts.synthesize).mockImplementation(async function* () { yield { pcm: new Uint8Array(3), sampleRateHz: 16000 }; });
  await f.port.connect(); f.utterance("a"); await tick();
  expect(f.events.at(-1)).toEqual({ type: "closed" }); expect(f.events.filter(e => e.type === "error")).toEqual([{ type: "error", code: "protocol" }]);
  expect(f.records.getSnapshot().turns.map(t => t.role)).toEqual(["user"]);
  const count = f.events.length; f.utterance("late"); f.port.close(); await tick(); expect(f.events).toHaveLength(count);
});

it("times out a stalled connection and ignores transport completion after close", async () => {
  vi.useFakeTimers(); const f = fixture({ connectTimeoutMs: 20 }); const late = deferred<void>();
  vi.mocked(f.providers.stt.connect).mockReturnValue(late.promise);
  const connection = f.port.connect(); const failure = expect(connection).rejects.toThrow("VOICE_CONNECTION_CLOSED");
  await vi.advanceTimersByTimeAsync(20); await failure;
  expect(f.events).toEqual([{ type: "error", code: "timeout" }, { type: "closed" }]);
  late.resolve(); await tick(); expect(f.events).toHaveLength(2); expect(f.providers.stt.close).toHaveBeenCalledTimes(1);
});

it("times out generation or missing playback acknowledgement and aborts before closing", async () => {
  vi.useFakeTimers();
  for (const stall of [false, true]) {
    const f = fixture({ responseTimeoutMs: 20 });
    if (stall) vi.mocked(f.providers.llm.respond).mockImplementation(() => new Promise(() => {}));
    await f.port.connect(); f.utterance("a"); await tick(); await vi.advanceTimersByTimeAsync(20);
    expect(f.events.at(-1)).toEqual({ type: "closed" });
    expect(f.events).toContainEqual({ type: "error", code: "timeout" });
    expect(f.records.getSnapshot().turns).toHaveLength(1);
  }
});

it("close during connection settles immediately, prevents reconnect and never leaks errors", async () => {
  const f = fixture(); vi.mocked(f.providers.stt.connect).mockImplementation(() => new Promise(() => {}));
  const connection = f.port.connect(); f.port.close();
  await expect(connection).rejects.toThrow("VOICE_CONNECTION_CLOSED");
  await expect(f.port.connect()).rejects.toThrow("VOICE_CONNECTION_STATE");
  expect(f.events).toEqual([{ type: "closed" }]);
});

it("factory accepts cascade without a token, ignores early/wrong acknowledgements and bounds resume context", async () => {
  const f = fixture(); const events: VoiceEvent[] = [];
  const port = createVoicePort({ provider: "cascade", providers: f.providers, learning: true }, event => { events.push(event); if (event.type === "audio") port.acknowledgePlayback?.(event.turnId); });
  const context = { turns: Array.from({ length: 30 }, (_, i) => ({ turnId: String(i), requestId: String(i), role: "user" as const, text: "a".repeat(2000) })), corrections: [], learningState: "conversation" as const };
  await port.connect(context); f.utterance("a"); await tick(); port.acknowledgePlayback?.("wrong");
  expect(f.requests[0].context.turns.length).toBeLessThanOrEqual(20);
  expect(f.requests[0].context.turns.reduce((n, t) => n + new TextEncoder().encode(t.text).length, 0)).toBeLessThanOrEqual(20480);
  expect(events.some(e => e.type === "response-complete")).toBe(true); port.close();
});
