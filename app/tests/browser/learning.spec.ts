import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function start(page: Page, scenario = "correction") {
  await page.goto("/");
  await page.getByLabel("학습 시나리오").selectOption(scenario);
  await page.getByRole("button", { name: "대화 시작" }).click();
  await expect(page.getByRole("button", { name: "보내기" })).toBeDisabled();
  await expect(page.getByLabel("내 답변", { exact: true })).toBeEnabled();
}
async function send(page: Page, text: string, next: "내 답변" | "다시 답변하기") {
  await page.getByRole("textbox").fill(text);
  await page.getByRole("textbox").press("Enter");
  await expect(page.getByLabel(next, { exact: true })).toBeEnabled();
}

test("keyboard learning flow, retries, note preview and actual Markdown download", async ({ page }, testInfo) => {
  const exceptions: string[] = [];
  page.on("pageerror", e => exceptions.push(e.message));
  await start(page);
  await page.getByRole("textbox").fill("   ");
  await expect(page.getByRole("button", { name: "보내기" })).toBeDisabled();
  await send(page, "I go to a cafe yesterday.", "다시 답변하기");
  await expect(page.getByText("I went to a café yesterday.", { exact: true })).toBeVisible();
  await send(page, "First attempt", "다시 답변하기");
  await expect(page.getByText("최근 재시도: 실패 (고정 시나리오)")).toBeVisible();
  await send(page, "I went to a café yesterday.", "내 답변");
  await expect(page.getByText("최근 재시도: 성공 (고정 시나리오)")).toBeVisible();
  await page.getByRole("button", { name: "대화 종료", exact: true }).click();
  const downloadButton = page.getByRole("button", { name: "Markdown 다운로드" });
  await expect(downloadButton).toBeVisible();
  await page.getByText("노트 내용 보기").click();
  await expect(page.locator("pre")).toContainText("I go to a cafe yesterday.");
  const event = page.waitForEvent("download");
  await downloadButton.click();
  const download = await event;
  expect(download.suggestedFilename()).toMatch(/^\d{4}-\d{2}-\d{2}\.md$/);
  expect(await readFile((await download.path())!, "utf8")).toContain("시나리오 성공");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(exceptions).toEqual([]);
  await page.screenshot({ path: `/tmp/talkie-${testInfo.project.name}-note.png`, fullPage: true });
});

test("response failure and resume preserve the correction and pending input", async ({ page }) => {
  await start(page);
  await send(page, "Yesterday story", "다시 답변하기");
  await page.getByText("데모 시나리오 확인", { exact: true }).click();
  await page.getByLabel("다음 응답 실패", { exact: true }).check();
  await page.getByRole("textbox").fill("Pending retry");
  await page.getByRole("button", { name: "보내기" }).click();
  await expect(page.getByRole("button", { name: "이어서 하기" })).toBeVisible();
  await expect(page.getByRole("log")).toContainText("응답 확인 대기");
  await page.getByRole("button", { name: "이어서 하기" }).click();
  await expect(page.getByLabel("다시 답변하기")).toBeEnabled();
  await expect(page.getByRole("log").getByText("Pending retry", { exact: true })).toHaveCount(1);
});

test("note failure retries only the note; no invented corrections", async ({ page }) => {
  await start(page, "conversation");
  await send(page, "yes", "내 답변");
  await page.getByRole("button", { name: "잠시 멈추기" }).click();
  await page.getByRole("button", { name: "이어서 하기" }).click();
  await expect(page.getByLabel("내 답변", { exact: true })).toBeEnabled();
  await page.getByText("데모 시나리오 확인", { exact: true }).click();
  await page.getByLabel("다음 노트 생성 실패", { exact: true }).check();
  await page.getByRole("button", { name: "대화 종료", exact: true }).click();
  await page.getByRole("button", { name: "노트만 다시 만들기" }).click();
  await expect(page.getByRole("button", { name: "Markdown 다운로드" })).toBeVisible();
  await expect(page.getByText("확인된 교정이 없습니다.", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
});

test("ending while waiting ignores late input; an empty session has no note", async ({ page }) => {
  await start(page, "conversation");
  await page.getByText("데모 시나리오 확인", { exact: true }).click();
  await page.getByLabel("느린 응답 (3.5초)").check();
  await page.getByRole("textbox").fill("Never confirmed");
  await page.getByRole("button", { name: "보내기" }).click();
  await page.getByRole("button", { name: "대화 종료", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("확인된 내 답변이 없어");
  await expect(page.getByRole("button", { name: "Markdown 다운로드" })).toHaveCount(0);
  await expect.poll(async () => page.getByRole("log").textContent(), { timeout: 5000 }).not.toContain("Never confirmed");
  await page.waitForTimeout(3600);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("log")).not.toContainText("Never confirmed");
});

test("mobile/desktop layout, keyboard start and in-memory reset", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/talkie-${testInfo.project.name}-welcome.png`, fullPage: true });
  await page.getByRole("button", { name: "대화 시작" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox")).toBeEnabled();
  await expect(page.getByRole("textbox")).toBeFocused();
  await page.reload();
  await expect(page.getByRole("button", { name: "대화 시작" })).toBeVisible();
  await expect(page.getByRole("log")).toHaveCount(0);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
});
