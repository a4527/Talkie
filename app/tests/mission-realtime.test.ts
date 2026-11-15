import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
vi.mock("../src/server/learning", () => ({ getVoiceLearningContext: vi.fn() }));
vi.mock("../src/server/auth", () => ({ withIdentity: vi.fn() }));
vi.mock("../src/server/voice-token", () => ({ issueVoiceToken: vi.fn() }));
import { findCompletedRoute, parseMissionStateReport, MissionTracker, type MissionStateReport } from "../src/mission/realtime";
import { validateMissionProgress } from "../src/mission/progress";
import { currentMission } from "../src/mission/definitions";
import { createMissionInstruction } from "../src/mission/prompt";
import { VoiceLearningRecords } from "../src/voice/learning";
import { GeminiLiveAdapter } from "../src/voice/adapters/gemini-live";
import { createGeminiLiveSetup } from "../src/voice/gemini-live-setup";
import { cascadeText } from "../src/server/voice-cascade";
import { getVoiceLearningContext } from "../src/server/learning";
import { issueVoiceToken } from "../src/server/voice-token";
import { POST as tokenPost } from "../src/app/api/voice/token/route";
import type { VoiceEvent } from "../src/voice/port";
import type { MissionRouteEvent } from "../src/mission/progress";

const routes = { routeIds: ["remake", "refund"] };
const { definition } = currentMission("cafe-wrong-order")!;
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

/** One exchange: a confirmed learner turn, then a staff reply carrying the report, played unless interrupted. */
function exchange(records: VoiceLearningRecords, n: number, report?: MissionStateReport, options: { interrupted?: boolean; userText?: string } = {}) {
  records.apply({ type: "transcript", role: "user", turnId: `u${n}`, text: options.userText ?? `learner ${n}` });
  records.apply({ type: "input-complete", turnId: `u${n}` });
  if (report) records.apply({ type: "mission-report", turnId: `a${n}`, inputTurnId: `u${n}`, report });
  records.apply({ type: "transcript", role: "assistant", turnId: `a${n}`, text: `staff ${n}` });
  records.apply({ type: "response-complete", turnId: `a${n}`, inputTurnId: `u${n}` });
  records.apply({ type: options.interrupted ? "interrupted" : "played", turnId: `a${n}` });
}
const staffOpening = (records: VoiceLearningRecords) => {
  records.apply({ type: "transcript", role: "assistant", turnId: "a0", text: "Hi, how can I help?" });
  records.apply({ type: "response-complete", turnId: "a0" }); records.apply({ type: "played", turnId: "a0" });
};
const ev = (kind: MissionStateReport["routeEvents"][number]["kind"], routeId = "remake") => ({ kind, routeId });

describe("mission state report parser", () => {
  it("accepts only the exact structure", () => {
    expect(parseMissionStateReport({})).toEqual({ routeEvents: [] });
    expect(parseMissionStateReport({ routeEvents: [ev("proposed")], progress: "no_progress" })).toEqual({ routeEvents: [ev("proposed")], progress: "no_progress" });
    for (const bad of [null, [], "x", { routeEvents: "proposed" }, { routeEvents: [ev("proposed"), ev("proposed", "refund")] }, { routeEvents: [{ kind: "done", routeId: "remake" }] },
      { routeEvents: [{ kind: "proposed", routeId: "Remake Now" }] }, { progress: "stuck" }, { routeEvents: Array(5).fill(0).map((_, i) => ev(["proposed", "user_accepted", "staff_confirmed", "route_changed", "proposed"][i] as never)) }]) {
      expect(parseMissionStateReport(bad)).toBeUndefined();
    }
  });
});

describe("route completion", () => {
  const e = (kind: MissionRouteEvent["kind"], turn: string, routeId = "remake"): MissionRouteEvent => ({ eventId: `${kind}-${turn}`, kind, routeId, evidenceTurnId: turn });
  const order = (id: string) => Number(id.slice(1));
  it("requires proposal < acceptance < confirmation on the same route", () => {
    expect(findCompletedRoute([e("proposed", "t1"), e("user_accepted", "t2"), e("staff_confirmed", "t3")], order)).toBe("remake");
    expect(findCompletedRoute([e("user_accepted", "t1"), e("proposed", "t2"), e("staff_confirmed", "t3")], order)).toBeUndefined();
    expect(findCompletedRoute([e("proposed", "t1"), e("staff_confirmed", "t3")], order)).toBeUndefined();
    expect(findCompletedRoute([e("proposed", "t1"), e("user_accepted", "t2", "refund"), e("staff_confirmed", "t3")], order)).toBeUndefined();
    expect(findCompletedRoute([e("proposed", "t1"), e("user_accepted", "t2"), e("staff_confirmed", "t3")], id => id === "t1" ? undefined : order(id))).toBeUndefined();
  });
  it("rejects a switch to another route between acceptance and confirmation, and accepts the new route", () => {
    expect(findCompletedRoute([e("proposed", "t1"), e("user_accepted", "t2"), e("route_changed", "t4", "refund"), e("staff_confirmed", "t5")], order)).toBeUndefined();
    expect(findCompletedRoute([e("proposed", "t1"), e("user_accepted", "t2"), e("route_changed", "t4", "refund"), e("proposed", "t5", "refund"),
      e("user_accepted", "t6", "refund"), e("staff_confirmed", "t7", "refund")], order)).toBe("refund");
  });
});

describe("mission validator in confirmed voice records", () => {
  it("completes a route only from played staff turns and stores server-valid progress", () => {
    const records = new VoiceLearningRecords(undefined, { missionMode: "practice", ...routes });
    staffOpening(records);
    exchange(records, 1, { routeEvents: [ev("proposed")] });
    exchange(records, 2, { routeEvents: [ev("user_accepted"), ev("staff_confirmed")] }, { interrupted: true }); // Never heard: dropped.
    expect(records.getMissionOutcome()).toBeUndefined();
    exchange(records, 3, { routeEvents: [ev("user_accepted"), ev("staff_confirmed"), ev("proposed", "unknown-route")] });
    expect(records.getMissionOutcome()).toEqual({ reason: "goal_completed", routeId: "remake" });
    const snapshot = records.getSnapshot();
    expect(snapshot.missionProgress?.routeEvents).toEqual([
      { eventId: "proposed-a1", kind: "proposed", routeId: "remake", evidenceTurnId: "a1" },
      { eventId: "user_accepted-u3", kind: "user_accepted", routeId: "remake", evidenceTurnId: "u3" },
      { eventId: "staff_confirmed-a3", kind: "staff_confirmed", routeId: "remake", evidenceTurnId: "a3" }]);
    expect(validateMissionProgress(JSON.parse(JSON.stringify(snapshot.missionProgress)), snapshot.turns)).toEqual(snapshot.missionProgress);
    // Later reports cannot reopen or change a completed mission.
    exchange(records, 4, { routeEvents: [ev("route_changed", "refund")] });
    expect(records.getSnapshot().missionProgress?.routeEvents).toHaveLength(3);
  });
  it("ignores reports and stores no progress outside a mission session", () => {
    const records = new VoiceLearningRecords();
    exchange(records, 1, { routeEvents: [ev("proposed")] });
    expect(records.getSnapshot()).not.toHaveProperty("missionProgress");
  });
  it("fails real mode after consecutive answered no-progress turns, and resets on progress, exclusions and missing reports", () => {
    const records = new VoiceLearningRecords(undefined, { missionMode: "real", ...routes, noProgressThreshold: 3 });
    staffOpening(records);
    exchange(records, 1, { routeEvents: [], progress: "no_progress" });
    exchange(records, 2, { routeEvents: [], progress: "no_progress" });
    exchange(records, 3, { routeEvents: [], progress: "progress" });
    expect(records.getSnapshot().missionProgress).toBeUndefined();
    exchange(records, 4, { routeEvents: [], progress: "no_progress" });
    exchange(records, 5, { routeEvents: [], progress: "no_progress" });
    exchange(records, 6, { routeEvents: [], progress: "excluded" });
    exchange(records, 7, { routeEvents: [], progress: "no_progress" });
    exchange(records, 8, undefined);
    expect(records.getMissionOutcome()).toBeUndefined();
    exchange(records, 9, { routeEvents: [], progress: "no_progress" });
    exchange(records, 10, { routeEvents: [], progress: "no_progress" }, { interrupted: true }); // Unplayed reply: no count.
    expect(records.getSnapshot().missionProgress?.noProgress).toEqual({ count: 1, evidenceTurnIds: ["u9"] });
    // The next learner turn answered no played staff turn, so it is not a chance to respond and breaks the streak.
    exchange(records, 11, { routeEvents: [], progress: "no_progress" });
    expect(records.getSnapshot().missionProgress).toBeUndefined();
    for (const n of [12, 13]) exchange(records, n, { routeEvents: [], progress: "no_progress" });
    expect(records.getMissionOutcome()).toBeUndefined();
    exchange(records, 14, { routeEvents: [], progress: "no_progress" });
    expect(records.getMissionOutcome()).toEqual({ reason: "no_progress_failed" });
    expect(records.getSnapshot().missionProgress?.noProgress.evidenceTurnIds).toEqual(["u12", "u13", "u14"]);
  });
  it("counts a candidate only when the learner had a played staff turn to answer", () => {
    const records = new VoiceLearningRecords(undefined, { missionMode: "real", ...routes, noProgressThreshold: 1 });
    exchange(records, 1, { routeEvents: [], progress: "no_progress" }); // First turn: nothing was asked yet.
    expect(records.getMissionOutcome()).toBeUndefined();
    exchange(records, 2, { routeEvents: [], progress: "no_progress" });
    expect(records.getMissionOutcome()).toEqual({ reason: "no_progress_failed" });
  });
  it("prefers completion over failure and ignores progress signals in practice", () => {
    const real = new VoiceLearningRecords(undefined, { missionMode: "real", ...routes, noProgressThreshold: 2 });
    staffOpening(real);
    exchange(real, 1, { routeEvents: [ev("proposed")], progress: "no_progress" });
    exchange(real, 2, { routeEvents: [ev("user_accepted"), ev("staff_confirmed")], progress: "no_progress" });
    expect(real.getMissionOutcome()).toEqual({ reason: "goal_completed", routeId: "remake" });
    const practice = new VoiceLearningRecords(undefined, { missionMode: "practice", ...routes, noProgressThreshold: 1 });
    staffOpening(practice);
    exchange(practice, 1, { routeEvents: [], progress: "no_progress" });
    expect(practice.getMissionOutcome()).toBeUndefined(); expect(practice.getSnapshot().missionProgress).toBeUndefined();
  });
  it("ignores correction results in real mode", () => {
    const records = new VoiceLearningRecords(undefined, { missionMode: "real", ...routes });
    records.apply({ type: "transcript", role: "user", turnId: "u1", text: "I go yesterday." }); records.apply({ type: "input-complete", turnId: "u1" });
    records.apply({ type: "learning-result", turnId: "a1", inputTurnId: "u1", result: { original: "I go yesterday.", learningState: "retry", replacement: "I went yesterday.", explanation: "x" } });
    records.apply({ type: "transcript", role: "assistant", turnId: "a1", text: "I went yesterday." });
    records.apply({ type: "response-complete", turnId: "a1", inputTurnId: "u1" }); records.apply({ type: "played", turnId: "a1" });
    expect(records.getSnapshot().corrections).toEqual([]); expect(records.getSnapshot().learningState).toBe("conversation");
  });
  it("keeps completion across the storage window and a resume, while the snapshot only names windowed evidence", () => {
    const records = new VoiceLearningRecords(undefined, { missionMode: "practice", ...routes });
    staffOpening(records);
    exchange(records, 1, { routeEvents: [ev("proposed")] });
    exchange(records, 2, { routeEvents: [ev("user_accepted")] });
    // Push the proposal out of the 128 KiB window with long confirmed turns.
    for (let n = 3; n < 30; n++) exchange(records, n, { routeEvents: [] }, { userText: "x".repeat(5000) });
    const windowed = records.getSnapshot();
    expect(windowed.turns.some(t => t.turnId === "a1")).toBe(false);
    expect(windowed.missionProgress).toBeUndefined();
    exchange(records, 30, { routeEvents: [ev("staff_confirmed")] });
    expect(records.getMissionOutcome()).toEqual({ reason: "goal_completed", routeId: "remake" });
    expect(records.getSnapshot().missionProgress?.routeEvents.map(e => e.eventId)).toEqual(["staff_confirmed-a30"]);
    // A resume receives the server's merged full history and still sees the completed route.
    const full = { turns: [{ turnId: "u2", requestId: "u2", role: "user" as const, text: "ok" }, { turnId: "a1", requestId: "a1", role: "assistant" as const, text: "offer" }].reverse()
      .concat([{ turnId: "a30", requestId: "u30", role: "assistant" as const, text: "done" }]), corrections: [], learningState: "conversation" as const,
      missionProgress: { routeEvents: [
        { eventId: "proposed-a1", kind: "proposed" as const, routeId: "remake", evidenceTurnId: "a1" },
        { eventId: "user_accepted-u2", kind: "user_accepted" as const, routeId: "remake", evidenceTurnId: "u2" },
        { eventId: "staff_confirmed-a30", kind: "staff_confirmed" as const, routeId: "remake", evidenceTurnId: "a30" }], noProgress: { count: 0, evidenceTurnIds: [] } } };
    expect(new VoiceLearningRecords(full, { missionMode: "practice", ...routes }).getMissionOutcome()).toEqual({ reason: "goal_completed", routeId: "remake" });
    expect(new MissionTracker({ missionMode: "practice", ...routes }, { turns: full.turns.slice(1), progress: full.missionProgress }).getOutcome()).toBeUndefined();
  });
});

describe("mission realtime providers", () => {
  class Socket {
    onopen?: () => void; onmessage?: (event: { data: string }) => void; onclose?: () => void; onerror?: () => void;
    bufferedAmount = 0; sent: any[] = [];
    send(value: string) { this.sent.push(JSON.parse(value)); }
    close() {}
    message(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); }
  }
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  it("builds mission setups without partner knowledge in the browser and with mode-specific tools", () => {
    const browser = createGeminiLiveSetup(true, { missionMode: "real" });
    expect(browser).not.toHaveProperty("systemInstruction");
    expect(browser.tools![0].functionDeclarations.map(t => t.name)).toEqual(["report_mission_state"]);
    const practice = createGeminiLiveSetup(true, { missionMode: "practice", instruction: "server" });
    expect(practice.tools![0].functionDeclarations.map(t => t.name)).toEqual(["record_learning_result", "report_mission_state"]);
    expect(practice.systemInstruction).toEqual({ parts: [{ text: "server" }] });
    expect(JSON.stringify(createGeminiLiveSetup(true, { missionMode: "practice" }))).not.toContain(definition.partner.knowsAtStart[0]);
  });
  it("keeps the role knowledge boundary and mode rules in the server instruction", () => {
    const real = createMissionInstruction(definition, "real", "A2"), practice = createMissionInstruction(definition, "practice", "C");
    for (const fact of [...definition.partner.knowsAtStart, ...definition.partner.learnsOnlyFromLearner, ...definition.routes.map(r => r.fixedConditions)]) expect(real).toContain(fact);
    expect(real).toContain("## 실전 모드"); expect(real).toContain("`no_progress`"); expect(real).not.toContain("record_learning_result");
    expect(practice).toContain("record_learning_result"); expect(practice).not.toContain("`no_progress`");
  });
  it("emits mission reports from Gemini tool calls and ignores corrections in real mode", async () => {
    const socket = new Socket(), events: VoiceEvent[] = [];
    const adapter = new GeminiLiveAdapter({ voiceConnectionToken: "auth_tokens/synthetic", learning: true, missionMode: "real" }, e => events.push(e), () => socket as unknown as WebSocket);
    const ready = adapter.connect(); socket.onopen?.();
    expect(socket.sent[0].setup).toEqual(createGeminiLiveSetup(true, { missionMode: "real" }));
    socket.message({ setupComplete: {} }); await ready;
    socket.message({ serverContent: { inputTranscription: { text: "Yes, please." } } }); await flush();
    socket.message({ toolCall: { functionCalls: [
      { id: "c1", name: "report_mission_state", args: { routeEvents: [{ kind: "user_accepted", routeId: "remake" }], progress: "progress" } },
      { id: "c2", name: "record_learning_result", args: { original: "Yes, please.", learningState: "conversation" } },
      { id: "c3", name: "report_mission_state", args: { routeEvents: "bad" } }] } }); await flush();
    const reports = events.filter(e => e.type === "mission-report");
    expect(reports).toHaveLength(1);
    expect(events.some(e => e.type === "learning-result")).toBe(false);
    expect(socket.sent.filter(m => m.toolResponse).map(m => m.toolResponse.functionResponses[0].response.accepted)).toEqual([true, false, false]);
    adapter.close();
  });
  it("uses the mission instruction on the cascade server and returns a parsed report", async () => {
    vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000"); vi.stubEnv("TALKIE_VOICE_CASCADE_TEST", "enabled"); vi.stubEnv("SONIOX_API_KEY", "s"); vi.stubEnv("GOOGLE_API_KEY", "g");
    const body = { text: "Sure, I'll remake it.", learningResult: { original: "Yes", learningState: "conversation" }, missionReport: { routeEvents: [{ kind: "staff_confirmed", routeId: "remake" }] } };
    const request = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] }));
    const snapshot = { turns: [{ turnId: "u", requestId: "u", role: "user" as const, text: "Yes" }], corrections: [], learningState: "conversation" as const };
    const result = await cascadeText(snapshot, undefined, true, new AbortController().signal, request, undefined, { definition, missionMode: "real", languageLevel: "B1" });
    expect(result).toEqual({ text: body.text, learningResult: undefined, missionReport: { routeEvents: [{ kind: "staff_confirmed", routeId: "remake" }] } });
    const sent = JSON.parse(request.mock.calls[0][1]!.body as string);
    expect(sent.systemInstruction.parts[0].text).toContain(definition.partner.knowsAtStart[0]);
    request.mockImplementationOnce(async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ ...body, missionReport: { progress: "x" } }) }] } }] }));
    expect(await cascadeText(snapshot, undefined, true, new AbortController().signal, request, undefined, { definition, missionMode: "practice", languageLevel: "B1" }))
      .toEqual({ text: body.text, learningResult: { original: "Yes", learningState: "conversation", replacement: undefined, explanation: undefined, retryOutcome: undefined } });
  });
  it("locks the mission instruction into the token and returns only the mode to the browser", async () => {
    vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
    vi.mocked(getVoiceLearningContext).mockResolvedValue({ userId: "synthetic-user", priorLearningContext: { reviewExpressions: [] }, mission: { definition, missionMode: "practice", languageLevel: "A2" } });
    vi.mocked(issueVoiceToken).mockResolvedValue({ voiceConnectionToken: "auth_tokens/synthetic", testDurationSeconds: 180 });
    const response = await tokenPost(new NextRequest("http://127.0.0.1:3000/api/voice/token", { method: "POST",
      headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "Content-Type": "application/json", cookie: "talkie_session=synthetic-session" },
      body: JSON.stringify({ testOnly: true, learningSessionId: "s", learningConnectionToken: "c" }) }));
    const json = await response.json();
    expect(json).toEqual({ voiceConnectionToken: "auth_tokens/synthetic", testDurationSeconds: 180, priorLearningContext: { reviewExpressions: [] }, missionMode: "practice" });
    const [, , learning, mission] = vi.mocked(issueVoiceToken).mock.calls[0];
    expect(learning).toBe(true);
    expect(mission).toEqual({ missionMode: "practice", instruction: createMissionInstruction(definition, "practice", "A2") });
  });
});

describe("mission ending", () => {
  it("previews a real-mode no-progress ending before the reply is spoken, and only then", () => {
    const records = new VoiceLearningRecords(undefined, { missionMode: "real", ...routes, noProgressThreshold: 3 });
    staffOpening(records);
    exchange(records, 1, { routeEvents: [], progress: "no_progress" });
    exchange(records, 2, { routeEvents: [], progress: "no_progress" });
    const np = { routeEvents: [], progress: "no_progress" as const };
    // The learner turn may not be confirmed yet when the provider asks (Gemini confirms input at turn completion).
    expect(records.previewMissionEnding("u3", np)).toBe("no_progress_failed");
    expect(records.previewMissionEnding("u3", { routeEvents: [], progress: "progress" })).toBeUndefined();
    expect(records.previewMissionEnding("u3", { routeEvents: [ev("route_changed", "refund")], progress: "no_progress" })).toBeUndefined();
    expect(records.previewMissionEnding("u2", np)).toBeUndefined(); // Already counted.
    exchange(records, 3, np);
    expect(records.getMissionOutcome()).toEqual({ reason: "no_progress_failed" });
    expect(records.previewMissionEnding("u4", np)).toBeUndefined();
    const practice = new VoiceLearningRecords(undefined, { missionMode: "practice", ...routes, noProgressThreshold: 1 });
    staffOpening(practice);
    expect(practice.previewMissionEnding("u1", np)).toBeUndefined();
  });
  it("does not preview failure when the same reply completes the route", () => {
    const records = new VoiceLearningRecords(undefined, { missionMode: "real", ...routes, noProgressThreshold: 1 });
    staffOpening(records);
    exchange(records, 1, { routeEvents: [ev("proposed")], progress: "progress" });
    records.apply({ type: "transcript", role: "user", turnId: "u2", text: "Yes" }); records.apply({ type: "input-complete", turnId: "u2" });
    // Acceptance is learner-side progress, so no ending; a confirmation completing an earlier acceptance also wins.
    expect(records.previewMissionEnding("u2", { routeEvents: [ev("user_accepted"), ev("staff_confirmed")], progress: "no_progress" })).toBeUndefined();
    records.apply({ type: "mission-report", turnId: "a2", inputTurnId: "u2", report: { routeEvents: [ev("user_accepted")], progress: "progress" } });
    records.apply({ type: "transcript", role: "assistant", turnId: "a2", text: "About five minutes, okay?" });
    records.apply({ type: "response-complete", turnId: "a2", inputTurnId: "u2" }); records.apply({ type: "played", turnId: "a2" });
    expect(records.previewMissionEnding("u3", { routeEvents: [], progress: "no_progress" })).toBe("no_progress_failed");
    expect(records.previewMissionEnding("u3", { routeEvents: [ev("staff_confirmed")], progress: "no_progress" })).toBeUndefined();
  });
  it("tells Gemini to close in role when the reply ends the mission", async () => {
    class Socket { onopen?: () => void; onmessage?: (e: { data: string }) => void; onclose?: () => void; onerror?: () => void; bufferedAmount = 0; sent: any[] = [];
      send(v: string) { this.sent.push(JSON.parse(v)); } close() {} message(d: unknown) { this.onmessage?.({ data: JSON.stringify(d) }); } }
    const socket = new Socket(), advisor = vi.fn(() => "no_progress_failed" as const);
    const adapter = new GeminiLiveAdapter({ voiceConnectionToken: "auth_tokens/synthetic", learning: true, missionMode: "real" }, () => {}, () => socket as unknown as WebSocket, advisor);
    const ready = adapter.connect(); socket.message({ setupComplete: {} }); await ready;
    socket.message({ serverContent: { inputTranscription: { text: "Uh, okay." } } }); await new Promise(r => setTimeout(r, 0));
    socket.message({ toolCall: { functionCalls: [{ id: "c1", name: "report_mission_state", args: { routeEvents: [], progress: "no_progress" } }] } }); await new Promise(r => setTimeout(r, 0));
    const response = socket.sent.find(m => m.toolResponse).toolResponse.functionResponses[0].response;
    expect(response).toMatchObject({ accepted: true, missionEnding: "no_progress_failed" });
    expect(response.instruction).toContain("closing line");
    expect(advisor).toHaveBeenCalledWith(expect.any(String), { routeEvents: [], progress: "no_progress" });
    adapter.close();
  });
  it("asks the cascade server for a closing line only when the reply ends the mission", async () => {
    vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000"); vi.stubEnv("TALKIE_VOICE_CASCADE_TEST", "enabled"); vi.stubEnv("SONIOX_API_KEY", "s"); vi.stubEnv("GOOGLE_API_KEY", "g");
    const request = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ text: "No problem, come back any time.", missionReport: { progress: "progress" } }) }] } }] }));
    const snapshot = { turns: [{ turnId: "u", requestId: "u", role: "user" as const, text: "Uh" }], corrections: [], learningState: "conversation" as const };
    expect(await cascadeText(snapshot, undefined, true, new AbortController().signal, request, undefined, { definition, missionMode: "real", languageLevel: "B1" }, "no_progress"))
      .toEqual({ text: "No problem, come back any time.", learningResult: undefined });
    expect(JSON.parse(JSON.parse(request.mock.calls[0][1]!.body as string).contents[0].parts[0].text).instruction).toContain("closing line");
    await expect(cascadeText(snapshot, undefined, true, new AbortController().signal, request, undefined, { definition, missionMode: "practice", languageLevel: "B1" }, "no_progress")).rejects.toThrow("INVALID_REQUEST");
  });
});
