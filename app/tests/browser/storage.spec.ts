import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

test.skip(process.env.TALKIE_STORAGE_E2E !== "1", "Requires isolated PostgreSQL databases and a local Mailpit instance.");
test.beforeAll(() => {
  if (process.env.TALKIE_STORAGE_E2E !== "1") return;
  for (const key of ["DATABASE_URL", "TRANSCRIPT_DATABASE_URL"]) {
    expect(new URL(process.env[key] ?? "").pathname, `${key} must name a disposable test database`).toMatch(/^\/talkie_test_/);
  }
});

async function latestLink(request: APIRequestContext, email: string, subject = "Talkie 로그인 확인") {
  const mailOrigin = process.env.MAILPIT_TEST_ORIGIN ?? "http://127.0.0.1:18025";
  let messageId = "";
  await expect.poll(async () => {
    const messages = await (await request.get(`${mailOrigin}/api/v1/messages`)).json();
    messageId = messages.messages.find((m: { To: { Address: string }[]; Subject: string }) => m.Subject === subject && m.To.some(t => t.Address === email))?.ID ?? "";
    return Boolean(messageId);
  }).toBe(true);
  const message = await (await request.get(`${mailOrigin}/api/v1/message/${messageId}`)).json();
  return (message.Text as string).match(/http[^\s]+\/account\/confirm#[A-Za-z0-9_-]+/)![0];
}

async function startText(page: Page, button: "대화 시작" | "이어서 하기") {
  await page.goto("/talk");
  if (button === "대화 시작") await page.getByRole("radio", { name: /텍스트 연습/ }).click();
  await page.getByRole("button", { name: button }).click();
}

async function login(page: Page, request: APIRequestContext, email: string) {
  await page.goto("/login");
  await page.getByLabel("이메일 주소").fill(email);
  await page.getByRole("button", { name: "로그인 메일 요청" }).click();
  await expect(page.getByRole("status")).toContainText("인증 요청을 접수");
  const link = await latestLink(request, email);
  await page.goto(link);
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "확인하고 계속" }).click();
  await expect(page.getByRole("status")).toContainText("로그인했습니다");
  return link;
}

test("email preview is harmless, confirmed login persists, saved learning and notes survive a browser reload", async ({ page, request, context }) => {
  const email = `browser-${randomUUID()}@example.test`;
  const origin = "http://127.0.0.1:3100";
  await page.goto("/login");
  await page.getByLabel("이메일 주소").fill(email);
  await page.getByRole("button", { name: "로그인 메일 요청" }).click();
  await expect(page.getByRole("status")).toContainText("인증 요청을 접수");
  const link = await latestLink(request, email);
  // A scanner can fetch the link without consuming it or authenticating the browser.
  expect((await request.get(link)).ok()).toBe(true);
  expect((await request.get("/api/account")).status()).toBe(401);
  const denied = await request.post("/api/account", { headers: { Origin: "https://outside.example" }, data: { action: "confirm", authLinkToken: new URL(link).hash.slice(1) } });
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
  await startText(page, "대화 시작");
  await expect(page.getByLabel("내 답변", { exact: true })).toBeEnabled();
  await page.getByRole("textbox").fill("A synthetic browser learning answer.");
  await page.getByRole("button", { name: "보내기" }).click();
  await expect(page.getByLabel("다시 답변하기", { exact: true })).toBeEnabled();
  await expect(page.getByRole("status").filter({ hasText: "저장 완료" })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await page.getByRole("button", { name: "이어서 하기" }).click();
  await expect(page.getByRole("log")).toContainText("A synthetic browser learning answer.");
  await page.getByRole("button", { name: "대화 종료", exact: true }).click();
  await expect(page.getByRole("heading", { name: /오늘의 대화를 마쳤어요/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /Markdown 다운로드/ })).toBeVisible({ timeout: 15_000 });
  await page.goto("/notes");
  await page.locator(".note-row").first().click();
  await expect(page.getByRole("button", { name: /Markdown 다운로드/ })).toBeVisible();
  await page.goto("/account");
  await expect(page.getByText(`${email} 계정으로 로그인했습니다.`)).toBeVisible();
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page.getByRole("status")).toContainText("로그아웃했습니다");
  expect((await request.get("/api/learn")).status()).toBe(401);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
});

test("another account cannot read saved learning, and account deletion blocks the former session", async ({ browser, request }) => {
  test.setTimeout(90_000);
  const first = await browser.newContext(), second = await browser.newContext();
  try {
    const owner = await first.newPage(), stranger = await second.newPage();
    const ownerEmail = `owner-${randomUUID()}@example.test`;
    const strangerEmail = `stranger-${randomUUID()}@example.test`;
    await login(owner, request, ownerEmail);
    await startText(owner, "대화 시작");
    await expect(owner.getByRole("textbox")).toBeEnabled();
    const marker = `fictional-${randomUUID()}`;
    await owner.getByRole("textbox").fill(marker);
    await owner.getByRole("button", { name: "보내기" }).click();
    await expect(owner.getByRole("status").filter({ hasText: "저장 완료" })).toBeVisible({ timeout: 10_000 });
    await owner.getByRole("button", { name: "대화 종료", exact: true }).click();
    await expect(owner.getByRole("heading", { name: /오늘의 대화를 마쳤어요/ })).toBeVisible({ timeout: 15_000 });
    await login(stranger, request, strangerEmail);
    const ownRecords = await (await owner.request.get("/api/learn")).json();
    const otherRecords = await (await stranger.request.get("/api/learn")).json();
    expect(JSON.stringify(ownRecords)).toContain(marker);
    expect(JSON.stringify(otherRecords)).not.toContain(marker);
    expect(otherRecords.sessions).toHaveLength(0);
    expect(otherRecords.notes).toHaveLength(0);
    const formerCookies = await first.cookies();
    await owner.goto("/account");
    await owner.getByText("회원 탈퇴", { exact: true }).click();
    await owner.getByRole("button", { name: "탈퇴 확인 메일 요청" }).click();
    await expect(owner.getByRole("status")).toContainText(/인증 요청을 접수|마지막 요청 후 30초/);
    if (await owner.getByRole("status").filter({ hasText: "30초" }).isVisible()) {
      await owner.waitForTimeout(31_000);
      await owner.getByRole("button", { name: "탈퇴 확인 메일 요청" }).click();
    }
    await expect(owner.getByRole("status")).toContainText("인증 요청을 접수");
    const deletionLink = await latestLink(request, ownerEmail, "Talkie 탈퇴 본인 확인");
    await owner.goto(deletionLink);
    await owner.getByRole("button", { name: "확인하고 계속" }).click();
    await owner.goto("/account");
    await owner.getByText("회원 탈퇴", { exact: true }).click();
    await owner.getByRole("button", { name: "회원 탈퇴 확정" }).click();
    await expect(owner.getByRole("status")).toContainText("계정 접근은 차단");
    expect((await owner.request.get("/api/learn")).status()).toBe(401);
    const replay = await browser.newContext();
    try {
      await replay.addCookies(formerCookies);
      expect((await replay.request.get("http://127.0.0.1:3100/api/learn")).status()).toBe(401);
    } finally { await replay.close(); }
  } finally { await first.close(); await second.close(); }
});
