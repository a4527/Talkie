import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test.skip(process.env.TALKIE_STORAGE_E2E !== "1", "Requires isolated PostgreSQL databases and a local Mailpit instance.");

test("email preview is harmless, confirmed login persists, saved learning and notes survive a browser reload", async ({ page, request, context }) => {
  const email = `browser-${randomUUID()}@example.test`;
  const origin = "http://127.0.0.1:3100";
  const mailOrigin = process.env.MAILPIT_TEST_ORIGIN ?? "http://127.0.0.1:18025";
  await page.goto("/account");
  await page.getByLabel("이메일 주소").fill(email);
  await page.getByRole("button", { name: "로그인 메일 요청" }).click();
  await expect(page.getByRole("status")).toContainText("인증 요청을 접수");
  let messageId = "";
  await expect.poll(async () => {
    const messages = await (await request.get(`${mailOrigin}/api/v1/messages`)).json();
    messageId = messages.messages.find((m: { To: { Address: string }[] }) => m.To.some(t => t.Address === email))?.ID ?? "";
    return Boolean(messageId);
  }).toBe(true);
  const message = await (await request.get(`${mailOrigin}/api/v1/message/${messageId}`)).json();
  const link = (message.Text as string).match(/http[^\s]+\/account\/confirm#[A-Za-z0-9_-]+/)![0];
  // A scanner can fetch the link without consuming it or authenticating the browser.
  expect((await request.get(link)).ok()).toBe(true);
  expect((await request.get("/api/account")).status()).toBe(401);
  const denied = await request.post("/api/account", { headers: { Origin: "https://outside.example" }, data: { action: "confirm", token: new URL(link).hash.slice(1) } });
  expect(denied.status()).toBe(403);
  await page.goto(link);
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  expect(page.url()).toBe(`${origin}/account/confirm`);
  await page.getByRole("button", { name: "확인하고 계속" }).click();
  await expect(page.getByRole("status")).toContainText("로그인했습니다");
  const cookie = (await context.cookies()).find(c => c.name === "talkie_session")!;
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe("Lax");
  expect(cookie.expires).toBeGreaterThan(Date.now() / 1000 + 29 * 86400);
  await page.goto("/learn");
  await page.getByRole("button", { name: "학습 시작·이어서 하기" }).click();
  await expect(page.getByLabel("내 답변", { exact: true })).toBeEnabled();
  await page.getByRole("textbox").fill("A synthetic browser learning answer.");
  await page.getByRole("button", { name: "보내기" }).click();
  await expect(page.getByLabel("다시 답변하기", { exact: true })).toBeEnabled();
  await expect(page.getByRole("status").filter({ hasText: "저장 완료" })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await page.getByRole("button", { name: "학습 시작·이어서 하기" }).click();
  await expect(page.getByRole("log")).toContainText("A synthetic browser learning answer.");
  await page.getByRole("button", { name: "대화 종료", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "저장과 노트 정리를 마쳤습니다" })).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByRole("button", { name: /노트 다운로드/ })).toBeVisible();
  await page.goto("/account");
  await expect(page.getByText(`${email} 계정으로 로그인했습니다.`)).toBeVisible();
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page.getByRole("status")).toContainText("로그아웃했습니다");
  expect((await request.get("/api/learning")).status()).toBe(401);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
});
