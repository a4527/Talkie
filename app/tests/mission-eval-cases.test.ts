import { describe, expect, it } from "vitest";
import { HOLDOUT2_EVAL_CASES, HOLDOUT3_EVAL_CASES, HOLDOUT_EVAL_CASES, MISSION_EVAL_CASES as TUNING_CASES, compareWithCase } from "../src/mission/eval-cases";
const MISSION_EVAL_CASES = [...TUNING_CASES, ...HOLDOUT_EVAL_CASES, ...HOLDOUT2_EVAL_CASES, ...HOLDOUT3_EVAL_CASES];
import { buildEvaluationInput, parseEvaluation, scoreEvaluation, type CriterionJudgement } from "../src/mission/evaluation";
import { currentMission } from "../src/mission/definitions";

const mission = currentMission("cafe-wrong-order")!;
const judge = (c: (typeof MISSION_EVAL_CASES)[number]): CriterionJudgement[] => {
  const firstUser = c.snapshot.turns.find(t => t.role === "user")!;
  return Object.entries(c.expected).map(([criterionId, verdict]) => ({ criterionId, verdict, reason: "r",
    evidence: verdict === "met" || verdict === "partial" ? [{ turnId: firstUser.turnId, text: firstUser.text.slice(0, 20) }] : [], counterEvidence: [] }));
};

describe("mission evaluation synthetic cases", () => {
  it("cover every rubric criterion with valid verdicts and pass the production parser", () => {
    for (const c of MISSION_EVAL_CASES) {
      expect(Object.keys(c.expected).sort()).toEqual([...mission.rubric.goalCriteria, ...mission.rubric.languageCriteria].map(x => x.criterionId).sort());
      expect(parseEvaluation({ judgements: judge(c) }, c.snapshot, mission.rubric), c.id).not.toBeNull();
      for (const id of c.boundary) expect(c.expected[id], `${c.id} ${id}`).toBeDefined();
    }
  });
  it("candidate verdicts reproduce the documented score summary", () => {
    for (const c of MISSION_EVAL_CASES.filter(x => x.expectedHalf)) {
      const s = scoreEvaluation(judge(c), mission.rubric);
      expect({ earned: s.totalEarnedHalf, max: s.totalMaxHalf }, c.id).toEqual(c.expectedHalf);
    }
  });
  it("tutor lines are assistant turns, never learner evidence, and gaps are flagged only for U-01", () => {
    for (const c of MISSION_EVAL_CASES) {
      const input = JSON.parse(buildEvaluationInput(c.snapshot, { ...mission, missionMode: c.missionMode, languageLevel: c.languageLevel, missionEndReason: c.missionEndReason, finalRouteId: c.finalRouteId }));
      expect(input.hasConversationGaps).toBe(["U-01", "H-05", "N-04", "V-01", "V-05"].includes(c.id));
      expect(c.snapshot.turns.filter(t => t.role === "user").every(t => !t.text.startsWith("Use ") && !t.text.startsWith("Try once"))).toBe(true);
    }
    const r02 = MISSION_EVAL_CASES.find(c => c.id === "R-02")!;
    expect(parseEvaluation({ judgements: judge(r02).map(j => j.criterionId === "grammar_meaning_relations" ? { ...j, evidence: [{ turnId: "R-02-3", text: "Use" }] } : j) }, r02.snapshot, mission.rubric)).toBeNull();
  });
  it("holdout ids are distinct from the tuning set", () => {
    const tuning = new Set(TUNING_CASES.map(c => c.id));
    expect(new Set(MISSION_EVAL_CASES.map(c => c.id)).size).toBe(MISSION_EVAL_CASES.length);
    expect(HOLDOUT2_EVAL_CASES.map(c => c.expectedHalf?.earned)).toEqual([200, 160, 200, 180, 200, 120]);
    expect(HOLDOUT3_EVAL_CASES.map(c => c.expectedHalf)).toEqual([{ earned: 174, max: 180 }, { earned: 200, max: 200 }, { earned: 93, max: 200 }, { earned: 197, max: 200 }, { earned: 200, max: 200 }]);
    expect(HOLDOUT_EVAL_CASES.map(c => c.id).filter(id => tuning.has(id))).toEqual([]);
    expect(HOLDOUT_EVAL_CASES.map(c => c.expectedHalf)).toEqual([{ earned: 167, max: 200 }, { earned: 147, max: 200 }, { earned: 170, max: 200 }, { earned: 200, max: 200 }, { earned: 114, max: 114 }, { earned: 194, max: 200 }, { earned: 164, max: 200 }, { earned: 200, max: 200 }]);
  });
  it("comparison separates boundary mismatches", () => {
    const p01 = MISSION_EVAL_CASES.find(c => c.id === "P-01")!;
    const j = judge(p01).map(x => x.criterionId === "organization_reason_contrast_condition" ? { ...x, verdict: "partial" as const } : x.criterionId === "final_agreement" ? { ...x, verdict: "unmet" as const, evidence: [] } : x);
    const result = compareWithCase(p01, j);
    expect(result.agreed).toBe(16);
    expect(result.mismatches.map(m => [m.criterionId, m.boundary])).toEqual([["final_agreement", false], ["organization_reason_contrast_condition", true]]);
  });
});
