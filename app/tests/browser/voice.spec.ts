import { expect, test } from "@playwright/test";

test("voice test requires acknowledgement and releases the microphone after ending (fake provider)", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  let issued = 0;
  await page.route("**/api/voice/token", async route => {
    issued++;
    await route.fulfill({ json: { voiceConnectionToken: "auth_tokens/synthetic", testDurationSeconds: 180 } });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => {
      const context = new AudioContext();
      const stream = context.createMediaStreamDestination().stream;
      for (const track of stream.getTracks()) {
        const original = track.stop.bind(track);
        track.stop = () => { original(); void context.close(); (window as any).micStopped = true; };
      }
      return stream;
    } });
  });
  await page.routeWebSocket(/generativelanguage\.googleapis\.com/, socket => {
    socket.onMessage(message => {
      const data = JSON.parse(String(message));
      if (data.setup) {
        socket.send(JSON.stringify({ setupComplete: {} }));
        socket.send(JSON.stringify({ serverContent: { inputTranscription: { text: "A fictional cafe." },
          outputTranscription: { text: "What would you order?" }, modelTurn: { parts: [
            { inlineData: { mimeType: "audio/pcm;rate=24000", data: "AAA=" } },
          ] }, turnComplete: true } }));
      }
    });
  });
  await page.goto("/voice");
  const start = page.getByRole("button", { name: "음성 시험 시작" });
  await expect(start).toBeDisabled(); expect(issued).toBe(0);
  await page.getByRole("checkbox").check(); await start.click();
  await expect(page.getByText("What would you order?", { exact: true })).toBeVisible();
  await expect(page.getByText("Talkie · 재생 완료", { exact: true })).toBeVisible();
  expect(issued).toBe(1);
  await page.getByRole("button", { name: "시험 종료", exact: true }).click();
  await expect(start).toBeEnabled();
  expect(await page.evaluate(() => (window as any).micStopped)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("microphone denial never provisions a provider credential", async ({ page }) => {
  let issued = 0;
  await page.route("**/api/voice/token", async route => { issued++; await route.abort(); });
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => { throw new DOMException("denied", "NotAllowedError"); } });
  });
  await page.goto("/voice"); await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "음성 시험 시작" }).click();
  await expect(page.getByRole("status")).toContainText("마이크 권한");
  await expect(page.getByRole("button", { name: "음성 시험 시작" })).toBeEnabled();
  expect(issued).toBe(0);
});
