import { expect, test } from "@playwright/test";
import { buildVoiceNoteMarkdown } from "../../src/voice/note";

// Synthetic notes in the app's own format; no real learner text.
const note = (id: string, date: string, expression: string) => ({ learningSessionId: id, learningEndDateKst: date,
  noteMarkdown: buildVoiceNoteMarkdown({ learningState: "conversation", turns: [
    { turnId: `${id}-t1`, requestId: "r1", role: "user", text: "I want coffee." },
    { turnId: `${id}-t2`, requestId: "r1", role: "assistant", text: expression }],
  corrections: [{ correctionId: "c1", sourceTurnId: `${id}-t1`, deliveredTurnId: `${id}-t2`, replacement: expression, explanation: "polite request", attempts: [] }] },
  `${date}T03:00:00Z`)! });

test("notes can be found by date or text, and expressions link back to every day they appear", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const notes = [note("s1", "2026-11-03", "Could I get a refund?"), note("s2", "2026-11-01", "could I get a refund"),
    note("s3", "2026-11-02", "Can I pay by card?")];
  await page.route("**/api/learn", route => route.fulfill({ json: { emailAddress: "learner@example.test", missions: [], missionAllowance: { limit: 10, remaining: 3 },
    achievementDayCount: 0, notes, sessions: [] } }));
  await page.goto("/notes");
  const days = page.locator(".note-list > li");
  await expect(days).toHaveCount(3);
  const search = page.getByRole("searchbox", { name: "노트 검색" });
  await search.fill("11-02");
  await expect(days).toHaveCount(1);
  await search.fill("pay by CARD");
  await expect(days).toHaveText(/11월 2일/);
  await search.fill("latte");
  await expect(page.getByRole("status")).toContainText("맞는 노트가 없어요");

  await page.getByRole("button", { name: /^표현/ }).click();
  await expect(page.getByRole("button", { name: /^표현/ })).toHaveAttribute("aria-pressed", "true");
  const search2 = page.getByRole("searchbox", { name: "표현 검색" });
  await expect(search2).toHaveValue("");
  const rows = page.getByRole("list", { name: "노트의 주요 표현" }).getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await search2.fill("refund");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Could I get a refund?");
  await expect(rows.first()).toContainText("복습 표현");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await rows.first().getByRole("link", { name: "11월 1일 (일) 노트 열기" }).click();
  await expect(page).toHaveURL(/\/notes\/2026-11-01$/);
  await expect(page.getByRole("article", { name: "대화 1의 노트" })).toContainText("could I get a refund");
  expect(errors).toEqual([]);
});

test("a note list without expressions says so instead of inventing any", async ({ page }) => {
  await page.route("**/api/learn", route => route.fulfill({ json: { emailAddress: "learner@example.test", missions: [], missionAllowance: { limit: 10, remaining: 3 },
    achievementDayCount: 0, sessions: [], notes: [{ learningSessionId: "legacy", learningEndDateKst: "2026-10-29", noteMarkdown: "# 2026-10-29 영어 학습 노트\n\n## 대화 근거 일부\n\n> hello\n" }] } }));
  await page.goto("/notes");
  await page.getByRole("button", { name: /^표현/ }).click();
  await expect(page.getByRole("status")).toContainText("노트에 정리된 표현이 아직 없어요.");
});

test("a review item can be turned off and on from the note page; the note text stays", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const fixture = note("s1", "2026-11-03", "Could I get a refund?");
  let excluded: number[] = [];
  const posts: unknown[] = [];
  await page.route("**/api/learn", async route => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON(); posts.push(body);
      excluded = body.included ? excluded.filter(n => n !== body.reviewItem) : [...excluded, body.reviewItem];
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { emailAddress: "learner@example.test", missions: [], missionAllowance: { limit: 10, remaining: 3 }, achievementDayCount: 0, sessions: [],
      notes: [{ ...fixture, excludedReviewItems: excluded }] } });
  });
  await page.goto("/notes/2026-11-03");
  const toggle = page.getByRole("checkbox", { name: /다음 복습에 포함/ });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator(".review-toggle")).toContainText("제외됨");
  expect(posts).toEqual([{ action: "review", learningSessionId: "s1", reviewItem: 1, included: false }]);
  // The note itself still shows the expression; only the expression list drops it.
  await expect(page.getByRole("article", { name: "대화 1의 노트" })).toContainText("Could I get a refund?");
  await page.goto("/notes");
  await page.getByRole("button", { name: /^표현/ }).click();
  await expect(page.getByRole("status")).toContainText("노트에 정리된 표현이 아직 없어요.");
  await page.goto("/notes/2026-11-03");
  await page.getByRole("checkbox", { name: /다음 복습에 포함/ }).check();
  expect(posts.at(-1)).toEqual({ action: "review", learningSessionId: "s1", reviewItem: 1, included: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
