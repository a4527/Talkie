import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
vi.mock("../src/server/auth", () => ({ withIdentity: vi.fn(), digest: (s: string) => s }));
vi.mock("../src/server/learning", () => ({ startLearning: vi.fn(), saveLearning: vi.fn(), listLearningRecords: vi.fn(), endLearning: vi.fn(), completeLearningNote: vi.fn(), updateLearningHeartbeat: vi.fn() }));
import { currentMission, findMissionDefinition, findMissionRubric, listStartableMissions, parseMissionStartRequest, toPublicMission, validateMission, type MissionRubric } from "../src/mission/definitions";
import { startLearning } from "../src/server/learning";
import { resumeMissionProgress, validateMissionProgress } from "../src/mission/progress";
import type { Turn } from "../src/learning/types";
import { POST as learnPost } from "../src/app/api/learn/route";

describe("mission registry", () => {
  it("has a valid cafe mission with the approved points", () => {
    const mission = currentMission("cafe-wrong-order")!;
    expect(mission).toBeDefined();
    expect(validateMission(mission.definition, mission.rubric)).toEqual([]);
    expect(mission.rubric.goalCriteria.map(c => [c.criterionId, c.points])).toEqual([
      ["temperature_mismatch", 5], ["caffeine_mismatch", 5], ["resolution_request", 10],
      ["final_temperature_resolved", 10], ["final_caffeine_resolved", 10], ["final_agreement", 20]]);
    expect(mission.rubric.languageCriteria.map(c => c.points)).toEqual([4, 3, 3, 4, 3, 3, 4, 3, 3, 4, 3, 3]);
    expect(mission.definition.routes.map(r => r.routeId)).toEqual(["remake", "refund"]);
    expect(listStartableMissions()).toEqual(["cafe-wrong-order"]);
  });
  it("finds stored versions and rejects unknown ones", () => {
    expect(findMissionDefinition("cafe-wrong-order", 1)?.definitionVersion).toBe(1);
    expect(findMissionRubric("cafe-wrong-order", 1)?.rubricVersion).toBe(1);
    expect(findMissionDefinition("cafe-wrong-order", 2)).toBeUndefined();
    expect(currentMission("unknown")).toBeUndefined();
  });
  it("reports rubrics that break the fixed totals or ids", () => {
    const { definition, rubric } = currentMission("cafe-wrong-order")!;
    const broken: MissionRubric = { ...rubric, goalCriteria: rubric.goalCriteria.map((c, i) => i === 0 ? { ...c, points: 6 } : c),
      languageCriteria: [...rubric.languageCriteria.slice(0, 11), { ...rubric.languageCriteria[0] }] };
    expect(validateMission(definition, broken)).toEqual(expect.arrayContaining(["goal points must total 60", "duplicate criterion id", "interaction must have 3 criteria totalling 10"]));
    expect(validateMission({ ...definition, routes: [] }, rubric)).toContain("no routes");
  });
  it("parses only exact start requests", () => {
    expect(parseMissionStartRequest({ missionId: "cafe-wrong-order", missionMode: "practice", languageLevel: "C" })).toEqual({ missionId: "cafe-wrong-order", missionMode: "practice", languageLevel: "C" });
    for (const bad of [null, [], "cafe", { missionId: "cafe-wrong-order", missionMode: "test", languageLevel: "B1" }, { missionId: "cafe-wrong-order", missionMode: "real", languageLevel: "C1" },
      { missionId: "Cafe Wrong", missionMode: "real", languageLevel: "B1" }, { missionId: "cafe-wrong-order", missionMode: "real", languageLevel: "B1", rubricVersion: 9 }]) {
      expect(parseMissionStartRequest(bad)).toBeUndefined();
    }
  });
  it("keeps partner knowledge, routes and rubric out of the public view", () => {
    const { definition, rubric } = currentMission("cafe-wrong-order")!;
    const view = toPublicMission(definition, rubric.rubricVersion, { missionMode: "real", languageLevel: "A2" });
    expect(Object.keys(view).sort()).toEqual(["definitionVersion", "goals", "languageLevel", "learnerRole", "missionId", "missionMode", "partnerRole", "rubricVersion", "situation", "title"]);
    const text = JSON.stringify(view);
    for (const hidden of [...definition.partner.knowsAtStart, ...definition.partner.rules, ...definition.routes.map(r => r.fixedConditions), ...rubric.goalCriteria.map(c => c.evidence)]) expect(text).not.toContain(hidden);
  });
});

describe("mission start route", () => {
  const request = (body: unknown) => new NextRequest("http://127.0.0.1:3000/api/learn", { method: "POST",
    headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "Content-Type": "application/json", cookie: "talkie_session=synthetic-login" }, body: JSON.stringify(body) });
  afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
  it("forwards a parsed mission as a voice start", async () => {
    vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
    vi.mocked(startLearning).mockResolvedValue({ learningSessionId: "s", learningConnectionToken: "c", confirmedSaveSequenceNumber: 0, demoScenario: "voice",
      conversationSnapshot: { turns: [], corrections: [], learningState: "conversation", hasConversationGaps: false }, mission: null });
    const mission = { missionId: "cafe-wrong-order", missionMode: "real", languageLevel: "B1" };
    expect((await learnPost(request({ action: "start", mission }))).status).toBe(200);
    expect(startLearning).toHaveBeenCalledWith("synthetic-login", "voice", mission);
  });
  it("rejects a scenario with a mission and malformed missions without starting", async () => {
    vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
    for (const body of [{ action: "start", scenario: "voice", mission: { missionId: "cafe-wrong-order", missionMode: "real", languageLevel: "B1" } },
      { action: "start", mission: { missionId: "cafe-wrong-order", missionMode: "real" } }, { action: "start", mission: null }]) {
      const response = await learnPost(request(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "INVALID_REQUEST" });
    }
    expect(startLearning).not.toHaveBeenCalled();
  });
});

describe("mission progress", () => {
  const turns: Turn[] = [{ turnId: "u1", requestId: "u1", role: "user", text: "I ordered a hot decaf." }, { turnId: "a1", requestId: "u1", role: "assistant", text: "I can remake it or refund it." },
    { turnId: "u2", requestId: "u2", role: "user", text: "A remake, please." }, { turnId: "a2", requestId: "u2", role: "assistant", text: "Sure, a hot decaf latte in five minutes." }];
  const event = (eventId: string, kind: string, evidenceTurnId: string, routeId = "remake") => ({ eventId, kind, routeId, evidenceTurnId });
  const none = { count: 0, evidenceTurnIds: [] };
  it("accepts route events with role-checked evidence and drops empty progress", () => {
    const progress = validateMissionProgress({ routeEvents: [event("e1", "proposed", "a1"), event("e2", "user_accepted", "u2"), event("e3", "staff_confirmed", "a2")], noProgress: none }, turns);
    expect(progress?.routeEvents.map(e => e.kind)).toEqual(["proposed", "user_accepted", "staff_confirmed"]);
    expect(validateMissionProgress(undefined, turns)).toBeUndefined();
    expect(validateMissionProgress({ routeEvents: [], noProgress: none }, turns)).toBeUndefined();
  });
  it("rejects wrong roles, unknown turns, duplicates, bad kinds and inconsistent no-progress evidence", () => {
    const bad = [
      { routeEvents: [event("e1", "user_accepted", "a1")], noProgress: none },
      { routeEvents: [event("e1", "staff_confirmed", "u2")], noProgress: none },
      { routeEvents: [event("e1", "proposed", "missing")], noProgress: none },
      { routeEvents: [event("e1", "proposed", "a1"), event("e1", "proposed", "a2")], noProgress: none },
      { routeEvents: [event("e1", "approved", "a1")], noProgress: none },
      { routeEvents: [event("e1", "proposed", "a1", "Remake!")], noProgress: none },
      { routeEvents: [], noProgress: { count: 2, evidenceTurnIds: ["u1"] } },
      { routeEvents: [], noProgress: { count: 1, evidenceTurnIds: ["missing"] } },
      { routeEvents: [], noProgress: { count: -1, evidenceTurnIds: [] } },
      { routeEvents: [] },
      [],
    ];
    for (const input of bad) expect(() => validateMissionProgress(input, turns), JSON.stringify(input)).toThrow("INVALID_MISSION_PROGRESS");
  });
  it("keeps route events and restarts the no-progress streak on resume", () => {
    const progress = validateMissionProgress({ routeEvents: [event("e1", "proposed", "a1")], noProgress: { count: 2, evidenceTurnIds: ["u1", "u2"] } }, turns);
    expect(resumeMissionProgress(progress)).toEqual({ routeEvents: progress!.routeEvents, noProgress: none });
    expect(resumeMissionProgress(validateMissionProgress({ routeEvents: [], noProgress: { count: 1, evidenceTurnIds: ["u1"] } }, turns))).toBeUndefined();
  });
});
