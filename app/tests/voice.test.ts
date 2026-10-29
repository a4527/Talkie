import { readNoteContext, type NoteContextItem } from "../src/voice/note-context";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { GeminiLiveAdapter } from "../src/voice/adapters/gemini-live";
import { updateVoiceTranscriptTurns } from "../src/voice/transcript";
import { issueVoiceToken } from "../src/server/voice-token";
import { priorLearningWindow, selectPriorLearningContext, PRIOR_LEARNING_MAX_BYTES } from "../src/voice/prior-learning";
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

// Integration events use the same evidence boundaries for fake and actual transports.
import { VoiceLearningRecords } from "../src/voice/learning";
import { VoiceLearningStore } from "../src/client/learning";
import { buildVoiceNoteMarkdown } from "../src/voice/note";
const empty = () => ({ turns: [], corrections: [], learningState: "conversation" as const });
function conversation(records: VoiceLearningRecords, suffix = "1", interrupted = false) {
  records.apply({ type: "transcript", role: "user", turnId: `u${suffix}`, text: "I go yesterday." });
  records.apply({ type: "learning-result", turnId: `a${suffix}`, inputTurnId: `u${suffix}`, result: { original: "I go yesterday.", learningState: "retry", replacement: "I went yesterday.", explanation: "과거형" } });
  records.apply({ type: "transcript", role: "assistant", turnId: `a${suffix}`, text: "Try: I went yesterday." });
  records.apply({ type: "input-complete", turnId: `u${suffix}` });
  records.apply({ type: "response-complete", turnId: `a${suffix}` });
  records.apply({ type: interrupted ? "interrupted" : "played", turnId: `a${suffix}` });
}
describe("confirmed voice learning and storage", () => {
  it("commits only complete input and played output, then restores correction and retry state", () => {
    const records = new VoiceLearningRecords();
    records.apply({ type: "transcript", role: "user", turnId: "partial", text: "unfinished" });
    expect(records.getSnapshot().turns).toHaveLength(0);
    conversation(records);
    const snapshot = records.getSnapshot();
    expect(snapshot.turns.map(t => t.turnId)).toEqual(["u1", "a1"]);
    expect(snapshot.learningState).toBe("retry"); expect(snapshot.corrections).toHaveLength(1);
    const restored = new VoiceLearningRecords(snapshot);
    restored.apply({ type: "transcript", role: "user", turnId: "u2", text: "I went yesterday." });
    restored.apply({ type: "input-complete", turnId: "u2" });
    restored.apply({ type: "learning-result", turnId: "a2", inputTurnId: "u2", result: { original: "I went yesterday.", learningState: "conversation", retryOutcome: "success" } });
    restored.apply({ type: "transcript", role: "assistant", turnId: "a2", text: "Good. What happened next?" });
    restored.apply({ type: "response-complete", turnId: "a2" });
    expect(restored.getSnapshot().learningState).toBe("retry");
    restored.apply({ type: "played", turnId: "a2" });
    expect(restored.getSnapshot().learningState).toBe("conversation");
    expect(restored.getSnapshot().corrections[0].attempts).toEqual([{ turnId: "u2", outcome: "success" }]);
  });
  it("excludes interrupted and late output, cancels tool metadata, and never invents a correction", () => {
    const records = new VoiceLearningRecords(); conversation(records, "1", true);
    records.apply({ type: "played", turnId: "a1" });
    records.apply({ type: "transcript", role: "assistant", turnId: "a1", text: "late" });
    records.apply({ type: "response-complete", turnId: "a1" });
    expect(records.getSnapshot().turns.map(t => t.turnId)).toEqual(["u1"]);
    expect(records.getSnapshot().corrections).toEqual([]);
    records.apply({ type: "learning-result", turnId: "a2", inputTurnId: "u1", result: { original: "different input", learningState: "retry", replacement: "invented" } });
    records.apply({ type: "transcript", role: "assistant", turnId: "a2", text: "invented" });
    records.apply({ type: "response-complete", turnId: "a2" }); records.apply({ type: "played", turnId: "a2" });
    expect(records.getSnapshot().corrections).toEqual([]);
    expect(records.getSnapshot().learningState).toBe("conversation");
    records.apply({ type: "learning-result", turnId: "a3", inputTurnId: "u1", result: { original: "I go yesterday.", learningState: "retry", replacement: "I went yesterday." } });
    records.apply({ type: "learning-cancelled", turnId: "a3" });
    records.apply({ type: "transcript", role: "assistant", turnId: "a3", text: "I went yesterday." });
    records.apply({ type: "response-complete", turnId: "a3" }); records.apply({ type: "played", turnId: "a3" });
    expect(records.getSnapshot().corrections).toEqual([]);
    const markdown = buildVoiceNoteMarkdown(records.getSnapshot(), "2026-10-29T15:01:00Z")!;
    expect(markdown).toContain("2026-10-30"); expect(markdown).not.toContain("invented");
    expect(buildVoiceNoteMarkdown(empty(), "2026-10-29T15:01:00Z")).toBeNull();
  });
  it("replays the identical pending save after response loss before saving newer content and ending", async () => {
    const records = new VoiceLearningRecords(); conversation(records);
    let failed = false;
    const calls: Record<string, unknown>[] = [];
    const request = async (data: Record<string, unknown>) => {
      calls.push(data);
      if (data.action === "save" && !failed) { failed = true; throw new Error("network"); }
      return { ok: true };
    };
    const store = new VoiceLearningStore({ learningSessionId: "synthetic", learningConnectionToken: "synthetic", confirmedSaveSequenceNumber: 0, conversationSnapshot: empty() }, request);
    await expect(store.sync(records.getSnapshot())).rejects.toThrow("network");
    const older = calls[0]; conversation(records, "2");
    await store.sync(records.getSnapshot(), "end");
    expect(calls.map(c => c.action)).toEqual(["save", "end", "save", "save", "note"]);
    expect(calls[2]).toEqual(older);
    expect(calls[3].saveSequenceNumber).toBe(2);
  });
  it("maps provider learning tools to the upcoming output and sends matching tool responses", async () => {
    const { adapter, socket, events } = fixture(); const ready = adapter.connect(); socket.message({ setupComplete: {} }); await ready;
    socket.message({ serverContent: { inputTranscription: { text: "I go yesterday." } } });
    socket.message({ toolCall: { functionCalls: [{ id: "tool-1", name: "record_learning_result", args: { original: "I go yesterday.", learningState: "retry", replacement: "I went yesterday." } }] } });
    socket.message({ serverContent: { outputTranscription: { text: "I went yesterday." }, turnComplete: true } }); await flush();
    const result = events.find(e => e.type === "learning-result")!;
    const output = events.find(e => e.type === "transcript" && e.role === "assistant")!;
    expect("turnId" in result && "turnId" in output && result.turnId === output.turnId).toBe(true);
    expect(events.some(e => e.type === "input-complete")).toBe(true);
    expect(socket.sent.at(-1)).toEqual({ toolResponse: { functionResponses: [{ id: "tool-1", name: "record_learning_result", response: { accepted: true } }] } });
    adapter.close();
  });
  it("keeps learning evidence across a tool-only completion until the spoken answer completes", async () => {
    const { adapter, socket, events } = fixture();
    const ready = adapter.connect(); socket.message({ setupComplete: {} }); await ready;
    const records = new VoiceLearningRecords();
    socket.message({ serverContent: { inputTranscription: { text: "I go yesterday." } } });
    socket.message({ toolCall: { functionCalls: [{ id: "tool-1", name: "record_learning_result", args: { original: "I go yesterday.", learningState: "retry", replacement: "I went yesterday." } }] } });
    socket.message({ serverContent: { turnComplete: true } }); await flush();
    expect(events.filter(e => e.type === "response-complete")).toHaveLength(0);
    socket.message({ serverContent: { outputTranscription: { text: "Try: I went yesterday." }, modelTurn: { parts: [
      { inlineData: { mimeType: "audio/pcm;rate=24000", data: "AAA=" } },
    ] }, turnComplete: true } }); await flush();
    for (const event of events) records.apply(event);
    const complete = events.find(e => e.type === "response-complete")!;
    expect(complete.type).toBe("response-complete");
    if (complete.type === "response-complete") records.apply({ type: "played", turnId: complete.turnId });
    expect(records.getSnapshot().corrections).toHaveLength(1);
    expect(records.getSnapshot().learningState).toBe("retry");
    adapter.close();
  });
  it("discards pending tool evidence when speech is interrupted before any answer arrives", async () => {
    const { adapter, socket, events } = fixture();
    const ready = adapter.connect(); socket.message({ setupComplete: {} }); await ready;
    const records = new VoiceLearningRecords();
    socket.message({ serverContent: { inputTranscription: { text: "I go yesterday." } } });
    socket.message({ toolCall: { functionCalls: [{ id: "tool-1", name: "record_learning_result", args: { original: "I go yesterday.", learningState: "retry", replacement: "I went yesterday." } }] } });
    socket.message({ serverContent: { turnComplete: true } });
    socket.message({ serverContent: { interrupted: true } });
    socket.message({ serverContent: { inputTranscription: { text: "New subject." } } });
    socket.message({ serverContent: { outputTranscription: { text: "I went yesterday." }, turnComplete: true } }); await flush();
    for (const event of events) {
      records.apply(event);
      if (event.type === "response-complete") records.apply({ type: "played", turnId: event.turnId });
    }
    const result = events.find(e => e.type === "learning-result")!;
    const interrupted = events.find(e => e.type === "interrupted")!;
    expect("turnId" in result && "turnId" in interrupted && result.turnId === interrupted.turnId).toBe(true);
    expect(events.filter(e => e.type === "response-complete")).toHaveLength(1);
    expect(records.getSnapshot().corrections).toHaveLength(0);
    expect(records.getSnapshot().learningState).toBe("conversation");
    adapter.close();
  });
});


describe("previous learning evidence", () => {
  it("uses six calendar months in Korea, including month-end, leap-year and UTC date boundaries", () => {
    expect(priorLearningWindow(new Date("2026-10-29T00:00:00Z"))).toEqual({ fromDateKst: "2026-04-29", toDateKst: "2026-10-29" });
    expect(priorLearningWindow(new Date("2026-08-31T00:00:00Z"))).toEqual({ fromDateKst: "2026-02-28", toDateKst: "2026-08-31" });
    expect(priorLearningWindow(new Date("2024-08-31T00:00:00Z"))).toEqual({ fromDateKst: "2024-02-29", toDateKst: "2024-08-31" });
    expect(priorLearningWindow(new Date("2026-10-28T15:00:00Z"))).toEqual({ fromDateKst: "2026-04-29", toDateKst: "2026-10-29" });
    expect(priorLearningWindow(new Date("2026-01-31T00:00:00Z"))).toEqual({ fromDateKst: "2025-07-31", toDateKst: "2026-01-31" });
  });
  const snapshot = (expression: string) => ({ learningState: "conversation" as const,
    turns: [{ turnId: "u1", requestId: "r1", role: "user" as const, text: "a synthetic attempt" },
      { turnId: "a1", requestId: "r1", role: "assistant" as const, text: expression }],
    corrections: [{ correctionId: "c1", sourceTurnId: "u1", deliveredTurnId: "a1", replacement: expression, explanation: "synthetic explanation", attempts: [] }],
  });
  const note = (expression: string, date: string) => ({ learningEndDateKst: date, noteMarkdown: buildVoiceNoteMarkdown(snapshot(expression), date + "T00:00:00Z")! });
  it("examines older notes, deduplicates repeated expressions and preserves literal quoted text", () => {
    const escaped = "I'd choose <tea> & coffee, \`please\`.";
    const selected = selectPriorLearningContext([note("Recent.", "2026-10-29"), note("Repeated.", "2026-10-01"),
      note("Repeated.", "2026-10-28"), note(escaped, "2026-10-02"), note("Older.", "2026-10-03")]);
    expect(selected.reviewExpressions).toEqual([
      { expression: escaped, observations: ["추천"] }, { expression: "Older.", observations: ["추천"] },
    ]);
    expect(selectPriorLearningContext([note("Repeated.", "2026-10-01"), note("Repeated.", "2026-10-28")]).reviewExpressions).toHaveLength(1);
  });
  it("omits unknown formats, empty evidence and oversized expressions without inventing or truncating them", () => {
    const selected = selectPriorLearningContext([{ learningEndDateKst: "2026-10-01", noteMarkdown: "## 다음 복습\n\n> invented" },
      note("한".repeat(500), "2026-10-02"), note("Short.", "2026-10-03")]);
    expect(selected.reviewExpressions.map(e => e.expression)).toEqual(["Short."]);
    expect(new TextEncoder().encode(JSON.stringify(selected)).length).toBeLessThanOrEqual(PRIOR_LEARNING_MAX_BYTES);
    expect(selectPriorLearningContext([])).toEqual({ reviewExpressions: [] });
  });
  it("sends prior evidence separately from the current conversation without fabricating turns or a retry state", async () => {
    const { adapter, socket } = fixture();
    const prior = selectPriorLearningContext([note("I went yesterday.", "2026-10-01")]);
    const ready = adapter.connect({ turns: [], corrections: [], learningState: "conversation" }, prior);
    socket.message({ setupComplete: {} }); await ready;
    expect(socket.sent).toHaveLength(2);
    const first = socket.sent[0].clientContent;
    expect(first.turnComplete).toBe(false);
    expect(first.turns[0].parts[0].text).toContain("not current conversation or a pending retry");
    expect(first.turns[0].parts[0].text).toContain("I went yesterday.");
    expect(first.turns[0].parts[0].text).not.toContain("synthetic attempt");
    expect(socket.sent[1].clientContent.turns[0].parts[0].text).toContain('"learningState":"conversation"');
    adapter.close();
  });
});


describe("versioned learning notes", () => {
  const snapshot = { learningState: "conversation" as const, corrections: [], turns: [
    { turnId: "u1", requestId: "r1", role: "user" as const, text: "I want coffee." },
    { turnId: "a1", requestId: "r1", role: "assistant" as const, text: "Could I have a coffee, please?" },
  ] };
  const evidence = [{ turnId: "u1", role: "user" as const, text: "I want coffee." }];
  const build = (items: NoteContextItem[]) => buildVoiceNoteMarkdown(snapshot, "2026-10-29T15:01:00Z", items)!;
  it("round-trips all three contexts with literal text and durable short evidence", () => {
    const literal = "Cafe <tea> & \`coffee\`\n### 복습 표현\n[근거](#detail-99)";
    const note = build([{ kind: "topic", summary: literal, evidence },
      { kind: "difficulty", summary: "Needed help with a polite request.", evidence },
      { kind: "review", summary: "coffee", observations: ["자발적 사용"], lastPracticedDateKst: "2026-10-29", evidence }]);
    expect(readNoteContext(note).map(i => i.summary)).toEqual([literal, "Needed help with a polite request.", "coffee"]);
    expect(readNoteContext(note)[2].lastPracticedDateKst).toBe("2026-10-29");
    expect(note).toContain("# 2026-10-30 영어 학습 노트");
    expect(note).toContain("> I want coffee.");
  });
  it("removes invalid evidence and dependent context without dropping independent items", () => {
    const note = build([{ kind: "topic", summary: "Cafe", evidence },
      { kind: "review", summary: "Invented", evidence: [{ ...evidence[0], text: "never said" }] },
      { kind: "review", summary: "Recommended only", observations: ["추천"], lastPracticedDateKst: "2026-10-29", evidence }]);
    expect(readNoteContext(note).map(i => i.summary)).toEqual(["Cafe"]);
    expect(note).toContain("일부 학습 내용");
    expect(note).not.toContain("Invented");
    expect(note).not.toContain("Recommended only");
  });
  it("ignores unsupported, duplicate, broken, or forged context structures without legacy fallback", () => {
    const note = build([{ kind: "review", summary: "coffee", observations: ["추천"], evidence }]);
    expect(readNoteContext(note.replace("talkie-learning-note-v1", "talkie-learning-note-v2"))).toEqual([]);
    expect(readNoteContext(note.replace('<a id="detail-1"></a>', ""))).toEqual([]);
    expect(readNoteContext(note + '\n<a id="detail-1"></a>')).toEqual([]);
    expect(readNoteContext(note + "\n### 복습 표현\n")).toHaveLength(1); // A lower heading cannot become top context.
    expect(readNoteContext(note.replace("### 주제", "### 주제\n\n### 주제"))).toEqual([]);
    expect(selectPriorLearningContext([{ learningEndDateKst: "2026-10-30", noteMarkdown: note.replace("talkie-learning-note-v1", "talkie-learning-note-v2") + "\n## 다음 복습\n\n> invented" }])).toEqual({ reviewExpressions: [] });
  });
  it("keeps topic and review windows separate from latest valid retained difficulty", () => {
    const recent = { learningEndDateKst: "2026-10-30", noteMarkdown: build([{ kind: "topic", summary: "Cafe", evidence }]) };
    const old = { learningEndDateKst: "2026-01-01", noteMarkdown: build([{ kind: "difficulty", summary: "Needs short questions.", evidence }]) };
    const conflicting = { ...old, noteMarkdown: build([{ kind: "difficulty", summary: "Answered an open question unaided.", evidence }]) };
    const result = selectPriorLearningContext([recent], [old, conflicting]);
    expect(result.topics).toEqual([{ summary: "Cafe", observedDateKst: "2026-10-30" }]);
    expect(result.difficulty).toHaveLength(2);
    expect(result.reviewExpressions).toEqual([]);
  });
  it("preserves a confirmed practice date across later recommendation-only notes", () => {
    const practiced = { learningEndDateKst: "2026-10-29", noteMarkdown: build([{ kind: "review", summary: "coffee", observations: ["자발적 사용"], lastPracticedDateKst: "2026-10-29", evidence }]) };
    const recommended = { learningEndDateKst: "2026-10-30", noteMarkdown: build([{ kind: "review", summary: "coffee", observations: ["추천"], evidence }]) };
    for (const order of [[practiced, recommended], [recommended, practiced]]) {
      expect(selectPriorLearningContext(order).reviewExpressions[0].lastPracticedDateKst).toBe("2026-10-29");
    }
  });
  it("sends topic and difficulty context even when there is no review expression", async () => {
    const { adapter, socket } = fixture();
    const ready = adapter.connect(undefined, { reviewExpressions: [], topics: [{ summary: "Cafe", observedDateKst: "2026-10-29" }], difficulty: [{ summary: "Short questions helped.", observedDateKst: "2026-01-01" }] });
    socket.message({ setupComplete: {} }); await ready;
    expect(socket.sent[0].clientContent.turns[0].parts[0].text).toContain("Short questions helped.");
    expect(socket.sent[0].clientContent.turnComplete).toBe(false);
    adapter.close();
  });
  it("retains the explicit legacy evidence-note reader", () => {
    const legacy = "비공개 음성 통합 시험 · 저장된 발화와 재생 완료된 AI 교정으로 구성했습니다.\n## 다음 복습\n\n> Legacy expression.";
    expect(selectPriorLearningContext([{ learningEndDateKst: "2026-10-01", noteMarkdown: legacy }]).reviewExpressions[0].expression).toBe("Legacy expression.");
  });
});
