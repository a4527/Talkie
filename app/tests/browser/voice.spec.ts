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

test("stored voice resumes confirmed correction state and finishes a note (fake provider)", async ({ page }) => {
  let snapshot: any = { turns: [], corrections: [], learningState: "conversation", hasConversationGaps: false };
  let sequence = 0, connections = 0, paused = false, ended = false;
  const priorMessages: string[] = [];
  await page.route("**/api/learn", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { emailAddress: "learner@example.test", sessions: [], notes: [{ learningEndDateKst: "2026-10-29", noteMarkdown: "Saved voice note: I went yesterday." }] } });
    const data = route.request().postDataJSON();
    if (data.action === "start") return route.fulfill({ json: { learningSessionId: "synthetic-session", learningConnectionToken: "synthetic-connection", conversationSnapshot: snapshot, confirmedSaveSequenceNumber: sequence } });
    if (data.action === "save") { snapshot = data.conversationSnapshot; sequence = data.saveSequenceNumber; }
    if (data.action === "pause") paused = true;
    if (data.action === "end") ended = true;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/voice/token", async route => {
    expect(route.request().postDataJSON().learningSessionId).toBe("synthetic-session");
    await route.fulfill({ json: { voiceConnectionToken: "auth_tokens/synthetic", testDurationSeconds: 180, priorLearningContext: { reviewExpressions: [{ expression: "Could I have some tea?", lastPracticedDateKst: "2026-10-28" }] } } });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => {
      const context = new AudioContext(), stream = context.createMediaStreamDestination().stream;
      for (const track of stream.getTracks()) { const stop = track.stop.bind(track); track.stop = () => { stop(); void context.close(); }; }
      return stream;
    } });
  });
  await page.routeWebSocket(/generativelanguage\.googleapis\.com/, socket => {
    const index = ++connections;
    socket.onMessage(message => {
      const data = JSON.parse(String(message));
      if (data.setup) {
        expect(data.setup.tools[0].functionDeclarations[0].name).toBe("record_learning_result");
        socket.send(JSON.stringify({ setupComplete: {} }));
      }
      if (data.clientContent) {
        if (JSON.stringify(data.clientContent).includes("Previous sessions:")) {
          priorMessages.push(JSON.stringify(data.clientContent)); return;
        }
        if (index === 2) expect(JSON.stringify(data.clientContent)).toContain("I went yesterday.");
        const text = index === 1 ? "I go yesterday." : "I went yesterday.";
        socket.send(JSON.stringify({ serverContent: { inputTranscription: { text } } }));
        socket.send(JSON.stringify({ toolCall: { functionCalls: [{ id: `tool-${index}`, name: "record_learning_result", args: index === 1 ? { original: text, learningState: "retry", replacement: "I went yesterday.", explanation: "과거형으로 말해 보세요." } : { original: text, learningState: "conversation", retryOutcome: "success" } }] } }));
        socket.send(JSON.stringify({ serverContent: { turnComplete: true } }));
      }
      if (data.toolResponse) socket.send(JSON.stringify({ serverContent: { outputTranscription: { text: index === 1 ? "Try: I went yesterday." : "Good. What happened next?" }, modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AAA=" } }] }, turnComplete: true } }));
    });
  });
  await page.goto("/voice"); await page.getByRole("checkbox").check();
  const start = page.getByRole("button", { name: "저장 학습 시작·이어서 하기" });
  await start.click(); await expect(page.getByRole("heading", { name: "다시 말해 보기" })).toBeVisible();
  await page.getByRole("button", { name: "학습 중단", exact: true }).click();
  await expect(start).toBeEnabled(); expect(paused).toBe(true);
  expect(snapshot.corrections).toHaveLength(1);
  await start.click(); await expect(page.getByText("AI 재시도 판정: 성공", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "학습 종료", exact: true }).click();
  await expect(page.getByText("저장과 노트 정리를 마쳤습니다.", { exact: true })).toBeVisible();
  expect(priorMessages).toHaveLength(2);
  expect(priorMessages.every(message => message.includes("Could I have some tea?") && !message.includes("I went yesterday."))).toBe(true);
  expect(ended).toBe(true); expect(snapshot.corrections[0].attempts).toHaveLength(1);
  await expect(page.getByRole("button", { name: "2026-10-29 노트 다운로드" })).toBeVisible();
  await expect(page.getByText("Saved voice note: I went yesterday.", { exact: true })).toBeVisible();
});
