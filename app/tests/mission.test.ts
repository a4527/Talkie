import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
vi.mock("../src/server/auth", () => ({ withIdentity: vi.fn(), digest: (s: string) => s }));
vi.mock("../src/server/learning", () => ({ startLearning: vi.fn(), saveLearning: vi.fn(), listLearningRecords: vi.fn(), endLearning: vi.fn(), completeLearningNote: vi.fn(), updateLearningHeartbeat: vi.fn() }));
import { currentMission, findMissionDefinition, findMissionRubric, listStartableMissions, parseMissionStartRequest, toPublicMission, validateMission, type MissionRubric } from "../src/mission/definitions";
import { startLearning } from "../src/server/learning";
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
