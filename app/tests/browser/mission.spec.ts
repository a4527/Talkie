import { expect, test, type Page } from "@playwright/test";

const catalog = [{ missionId: "cafe-wrong-order", title: "잘못 나온 카페 주문 해결", situation: "카페에서 따뜻한 디카페인 라테를 주문했는데 차가운 일반 라테가 나왔습니다.",
  learnerRole: "음료를 받은 손님", partnerRole: "카페 카운터 직원", goals: ["주문과 다른 점을 직원에게 알리기", "원하는 처리를 요청하기", "직원과 최종 처리에 합의하기"],
  routes: [{ routeId: "remake", label: "재제조" }, { routeId: "refund", label: "환불" }] }];
const empty = { turns: [], corrections: [], learningState: "conversation", hasConversationGaps: false };

async function fakeMicrophone(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => {
      const context = new AudioContext();
      return context.createMediaStreamDestination().stream;
    } });
  });
}

test("mission selection fixes mode and level in the start request and shows the mission while live (fake provider)", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const starts: unknown[] = [];
  let setupTools: string[] = [];
  await page.route("**/api/learn", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { emailAddress: "learner@example.test", missions: catalog, notes: [], sessions: [] } });
    const data = route.request().postDataJSON();
    if (data.action === "start") {
      starts.push(data);
      return route.fulfill({ json: { learningSessionId: "synthetic-mission", learningConnectionToken: "synthetic-connection", confirmedSaveSequenceNumber: 0, demoScenario: "voice", conversationSnapshot: empty,
        mission: { ...catalog[0], definitionVersion: 1, rubricVersion: 1, missionMode: data.mission.missionMode, languageLevel: data.mission.languageLevel, routeIds: ["remake", "refund"] } } });
    }
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/voice/token", route => route.fulfill({ json: { voiceConnectionToken: "auth_tokens/synthetic", testDurationSeconds: 180, missionMode: "real" } }));
  await page.routeWebSocket(/generativelanguage\.googleapis\.com/, socket => {
    socket.onMessage(message => {
      const data = JSON.parse(String(message));
      if (data.setup) { setupTools = data.setup.tools.flatMap((t: { functionDeclarations: { name: string }[] }) => t.functionDeclarations.map(f => f.name)); socket.send(JSON.stringify({ setupComplete: {} })); }
    });
  });
  await fakeMicrophone(page);
  await page.goto("/talk");
  await expect(page.getByRole("radio", { name: /카페 미션/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("heading", { name: "잘못 나온 카페 주문 해결" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "미션 모드" }).getByRole("radio", { name: /연습/ })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "실전" }).click();
  await page.getByRole("radio", { name: "A2" }).click();
  await expect(page.getByText("익숙한 일상 상황에서", { exact: false })).toBeVisible();
  const start = page.getByRole("button", { name: /미션 시작/ });
  await expect(start).toBeDisabled();
  await page.getByRole("checkbox").check(); await start.click();
  await expect(page.getByText("대화 중", { exact: true })).toBeVisible();
  expect(starts).toEqual([{ action: "start", mission: { missionId: "cafe-wrong-order", missionMode: "real", languageLevel: "A2" } }]);
  expect(setupTools).toEqual(["report_mission_state"]);
  const brief = page.getByRole("region", { name: "미션 정보" });
  await expect(brief).toContainText("실전"); await expect(brief).toContainText("직원과 최종 처리에 합의하기");
  await expect(page.getByRole("region", { name: "오늘의 표현" })).toHaveCount(0);
  await page.getByRole("button", { name: "잠시 멈추기", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("an open mission resumes with its stored mode and level", async ({ page }) => {
  const starts: unknown[] = [];
  await page.route("**/api/learn", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { emailAddress: "learner@example.test", missions: catalog, notes: [], sessions: [{ learningSessionId: "synthetic-mission",
      learningSessionStatus: "interrupted", noteGenerationStatus: "idle", demoScenario: "voice", learningSessionStartedAt: "2026-11-15T01:00:00.000Z", learningSessionEndedAt: null,
      mission: { missionId: "cafe-wrong-order", definitionVersion: 1, rubricVersion: 1, missionMode: "practice", languageLevel: "C", missionEndReason: null, finalRouteId: null }, missionResult: null }] } });
    starts.push(route.request().postDataJSON());
    await route.fulfill({ status: 500, json: { error: "SERVICE_UNAVAILABLE" } });
  });
  await fakeMicrophone(page);
  await page.goto("/talk");
  await expect(page.getByRole("heading", { name: /멈춘 미션을 이어가요/ })).toBeVisible();
  await expect(page.getByText("연습 · C (고급)로 시작한 미션이에요", { exact: false })).toBeVisible();
  await expect(page.getByRole("radio", { name: /자유 음성 대화/ })).toBeDisabled();
  await expect(page.getByRole("radio", { name: "실전" })).toHaveCount(0);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /이어서 하기/ }).click();
  await expect.poll(() => starts.length).toBe(1);
  expect(starts[0]).toEqual({ action: "start", mission: { missionId: "cafe-wrong-order", missionMode: "practice", languageLevel: "C" } });
});

test("the result page separates outcome, score, exclusions and criterion evidence", async ({ page }) => {
  const area = (earnedHalf: number, maxHalf: number) => ({ earnedHalf, maxHalf });
  await page.route("**/api/learn", route => route.fulfill({ json: { emailAddress: "learner@example.test", missions: catalog, notes: [], sessions: [{ learningSessionId: "synthetic-mission",
    learningSessionStatus: "ended", noteGenerationStatus: "ready", demoScenario: "voice", learningSessionStartedAt: "2026-11-15T01:00:00.000Z", learningSessionEndedAt: "2026-11-15T01:05:00.000Z",
    mission: { missionId: "cafe-wrong-order", definitionVersion: 1, rubricVersion: 1, missionMode: "real", languageLevel: "B1", missionEndReason: "goal_completed", finalRouteId: "refund" },
    // 67/84: goal 50/50 (10 excluded), grammar 5/10, vocabulary 4/10, organization 4/7 (3 excluded), interaction 4/7 (3 excluded) → 79.8%, below 80%.
    missionResult: { evaluationStatus: "ready", areaScores: { goal: area(100, 100), grammar: area(10, 20), vocabulary: area(8, 20), organization: area(8, 14), interaction: area(8, 14) },
      totalEarnedHalf: 134, totalMaxHalf: 168, meetsThreshold: false,
      criteria: [{ criterionId: "final_agreement", area: "goal", label: "최종 처리에 합의", points: 20, verdict: "met", reason: "환불 제안을 수락했고 직원이 확정했다.", evidence: ["Yes, a refund please."], counterEvidence: [] },
        { criterionId: "grammar_level_stability", area: "grammar", label: "선택 수준에서의 안정성", points: 3, verdict: "partial", reason: "시제가 흔들렸다.", evidence: ["I order hot one."], counterEvidence: ["I ordered a decaf."] }] } }] } }));
  await page.goto("/results/synthetic-mission");
  const result = page.getByRole("region", { name: "미션 결과" });
  await expect(result).toContainText("미션 완료 · 환불");
  await expect(result).toContainText("도움 없는 실전 결과");
  await expect(result.locator(".score-total")).toHaveText("67 / 84점");
  await expect(result).toContainText("79.8%");
  await expect(result).toContainText("달성 기준 80% 미만");
  await expect(result).toContainText("판정 불가 항목 16점을 제외한 84점 만점");
  await expect(result.getByRole("row", { name: /말의 구성/ })).toContainText("4 / 7");
  await expect(result.getByRole("row", { name: /말의 구성/ })).toContainText("3점");
  await expect(result.getByText("Yes, a refund please.")).toBeVisible();
  await result.getByText("문법 항목별 근거").click();
  await expect(result.getByText("부분 충족")).toBeVisible();
  await expect(result.getByText("I ordered a decaf.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
