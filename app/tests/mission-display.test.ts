import { describe, expect, it } from "vitest";
import { endReasonLabel, excludedPoints, formatPoints, formatRate } from "../src/mission/display";
import { describeJudgements, listMissionCatalog } from "../src/mission/definitions";

describe("mission score display (DEC-080)", () => {
  it("keeps half points and drops an unnecessary .0", () => {
    expect([formatPoints(0), formatPoints(1), formatPoints(134), formatPoints(187)]).toEqual(["0", "0.5", "67", "93.5"]);
  });
  it("rounds the rate half up at the second decimal without changing the 80% decision", () => {
    expect(formatRate(134, 168)).toBe("79.8%"); // 67/84 = 79.7619%
    expect(formatRate(144, 180)).toBe("80.0%"); // 72/90 exactly 80%
    expect(formatRate(1599, 2000)).toBe("80.0%"); // 79.95% shows as 80.0% but is below the threshold
    expect(formatRate(1999, 2000)).toBe("100.0%"); // 99.95% rounds up
    expect(formatRate(1, 3)).toBe("33.3%");
    expect(formatRate(0, 200)).toBe("0.0%");
    expect(formatRate(0, 0)).toBeNull();
  });
  it("shows excluded points per area", () => {
    expect(excludedPoints("goal", 100)).toBe("10");
    expect(excludedPoints("grammar", 14)).toBe("3");
    expect(excludedPoints("interaction", 20)).toBe("0");
  });
  it("labels end reasons with the final route", () => {
    expect(endReasonLabel("goal_completed", "환불")).toBe("미션 완료 · 환불");
    expect(endReasonLabel(null)).toBe("결과 정리 중");
  });
});

describe("browser-facing mission data", () => {
  it("lists startable missions without partner knowledge or rubric evidence", () => {
    const catalog = listMissionCatalog();
    expect(catalog.map(m => m.missionId)).toEqual(["cafe-wrong-order"]);
    expect(catalog[0].routes).toEqual([{ routeId: "remake", label: "재제조" }, { routeId: "refund", label: "환불" }]);
    const text = JSON.stringify(catalog);
    for (const secret of ["knowsAtStart", "different staff member", "No extra charge", "evidence"]) expect(text).not.toContain(secret);
  });
  it("attaches fixed labels in rubric order and drops unknown criteria", () => {
    const stored = [
      { criterionId: "unknown", verdict: "met" as const, reason: "x", evidence: [], counterEvidence: [] },
      { criterionId: "interaction_responsive_reply", verdict: "undeterminable" as const, reason: "근거 부족", evidence: [], counterEvidence: [] },
      { criterionId: "final_agreement", verdict: "met" as const, reason: "합의", evidence: [{ turnId: "u3", text: "Yes, please." }], counterEvidence: [{ turnId: "u1", text: "no" }] },
    ];
    expect(describeJudgements("cafe-wrong-order", 1, stored)).toEqual([
      { criterionId: "final_agreement", area: "goal", label: "최종 처리에 합의", points: 20, verdict: "met", reason: "합의", evidence: ["Yes, please."], counterEvidence: ["no"] },
      { criterionId: "interaction_responsive_reply", area: "interaction", label: "상대 말에 맞는 응답", points: 4, verdict: "undeterminable", reason: "근거 부족", evidence: [], counterEvidence: [] },
    ]);
    expect(describeJudgements("cafe-wrong-order", 99, stored)).toEqual([]);
  });
});
