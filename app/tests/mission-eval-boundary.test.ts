import { describe, expect, it } from "vitest";
import { BOUNDARY_EVAL_CASES, HOLDOUT2_EVAL_CASES, HOLDOUT3_EVAL_CASES, HOLDOUT_EVAL_CASES, MISSION_EVAL_CASES } from "../src/mission/eval-cases";
import { buildEvaluationInput, parseEvaluation, scoreEvaluation, type CriterionJudgement } from "../src/mission/evaluation";
import { currentMission } from "../src/mission/definitions";

const mission = currentMission("cafe-wrong-order")!;
const judge = (c: (typeof BOUNDARY_EVAL_CASES)[number]): CriterionJudgement[] => {
  const firstUser = c.snapshot.turns.find(t => t.role === "user")!;
  return Object.entries(c.expected).map(([criterionId, verdict]) => ({ criterionId, verdict, reason: "r",
    evidence: verdict === "met" || verdict === "partial" ? [{ turnId: firstUser.turnId, text: firstUser.text.slice(0, 20) }] : [], counterEvidence: [] }));
};

describe("mission evaluation boundary cases (B-01~B-06)", () => {
  it("cover every rubric criterion and pass the production parser", () => {
    for (const c of BOUNDARY_EVAL_CASES) {
      expect(Object.keys(c.expected).sort()).toEqual([...mission.rubric.goalCriteria, ...mission.rubric.languageCriteria].map(x => x.criterionId).sort());
      expect(parseEvaluation({ judgements: judge(c) }, c.snapshot, mission.rubric), c.id).not.toBeNull();
      for (const id of c.boundary) expect(c.expected[id], `${c.id} ${id}`).toBeDefined();
    }
  });
  it("candidate verdicts give the fixed totals, all within 76~84 and on the intended side of 80%", () => {
    const scores = BOUNDARY_EVAL_CASES.map(c => scoreEvaluation(judge(c), mission.rubric));
    expect(scores.map(s => ({ earned: s.totalEarnedHalf, max: s.totalMaxHalf }))).toEqual(BOUNDARY_EVAL_CASES.map(c => c.expectedHalf));
    expect(scores.map(s => s.totalEarnedHalf / 2)).toEqual([80, 79.5, 80, 82, 76.5, 83.5]);
    expect(scores.map(s => s.meetsThreshold)).toEqual([true, false, true, true, false, true]);
  });
  it("79.5/100 is below the threshold although it is the closest rate under 80 without exclusions", () => {
    const b02 = scoreEvaluation(judge(BOUNDARY_EVAL_CASES[1]), mission.rubric);
    expect(b02.meetsThreshold).toBe(false);
    expect(scoreEvaluation(judge(BOUNDARY_EVAL_CASES[0]), mission.rubric).meetsThreshold).toBe(true);
  });
  it("have no conversation gaps, keep tutor lines out of learner turns, and use ids unseen in other sets", () => {
    for (const c of BOUNDARY_EVAL_CASES) {
      const input = JSON.parse(buildEvaluationInput(c.snapshot, { ...mission, missionMode: c.missionMode, languageLevel: c.languageLevel, missionEndReason: c.missionEndReason, finalRouteId: c.finalRouteId }));
      expect(input.hasConversationGaps, c.id).toBe(false);
      expect(c.snapshot.turns.filter(t => t.role === "user").every(t => !t.text.startsWith("Use ")), c.id).toBe(true);
    }
    const others = new Set([...MISSION_EVAL_CASES, ...HOLDOUT_EVAL_CASES, ...HOLDOUT2_EVAL_CASES, ...HOLDOUT3_EVAL_CASES].map(c => c.id));
    expect(BOUNDARY_EVAL_CASES.map(c => c.id).filter(id => others.has(id))).toEqual([]);
  });
});
