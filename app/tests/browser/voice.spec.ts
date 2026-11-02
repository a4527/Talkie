import { expect, test, type Page } from "@playwright/test";

/** Signed-in records API stub; the real storage path is covered by storage.spec.ts. */
async function mockLearning(page: Page, notes: { learningSessionId: string; learningEndDateKst: string; noteMarkdown: string }[] = []) {
  const state = { snapshot: { turns: [], corrections: [], learningState: "conversation", hasConversationGaps: false } as any, sequence: 0, paused: false, ended: false, open: false };
  await page.route("**/api/learn", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { emailAddress: "learner@example.test", notes: state.ended ? notes : [],
      sessions: state.open || state.ended ? [{ learningSessionId: "synthetic-session", learningSessionStatus: state.ended ? "ended" : "interrupted", noteGenerationStatus: state.ended ? "ready" : "idle", demoScenario: "voice", learningSessionStartedAt: "2026-11-02T01:00:00.000Z", learningSessionEndedAt: null }] : [] } });
    const data = route.request().postDataJSON();
    if (data.action === "start") { state.open = true; return route.fulfill({ json: { learningSessionId: "synthetic-session", learningConnectionToken: "synthetic-connection", conversationSnapshot: state.snapshot, confirmedSaveSequenceNumber: state.sequence } }); }
    if (data.action === "save") { state.snapshot = data.conversationSnapshot; state.sequence = data.saveSequenceNumber; }
    if (data.action === "pause") state.paused = true;
    if (data.action === "end") state.ended = true;
    await route.fulfill({ json: { ok: true } });
  });
  return state;
}
async function fakeMicrophone(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => {
      const context = new AudioContext(), stream = context.createMediaStreamDestination().stream;
      for (const track of stream.getTracks()) { const stop = track.stop.bind(track); track.stop = () => { stop(); void context.close(); (window as any).micStopped = true; }; }
      return stream;
    } });
  });
}

test("split voice choices fit desktop and mobile before connection", async ({ page }) => {
  await mockLearning(page);
  await page.goto("/talk");
  await page.getByLabel("음성 경로").selectOption("cascade");
  await expect(page.getByRole("combobox", { name: "STT" })).toHaveValue("soniox");
  await expect(page.getByRole("combobox", { name: "LLM" })).toHaveValue("gemini-flash-lite");
  await page.getByRole("combobox", { name: "TTS" }).selectOption("google-cloud-standard");
  await expect(page.getByText("별도 Cloud 프로젝트 인증이 필요합니다.", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("split voice sends the chosen TTS when requesting a connection", async ({ page }) => {
  let selectedTts: string | undefined;
  await page.route("**/api/voice/cascade", async route => {
    const input = route.request().postDataJSON();
    if (input.action === "credential") selectedTts = input.selection?.tts;
    await route.fulfill({ json: { temporarySttKey: "synthetic-stt", cascadeRequestToken: "synthetic-request", testDurationSeconds: 180 } });
  });
  await mockLearning(page); await fakeMicrophone(page);
  await page.routeWebSocket(/stt-rt\.soniox\.com/, () => {});
  await page.goto("/talk");
  await page.getByRole("combobox", { name: "음성 경로" }).selectOption("cascade");
  await page.getByRole("combobox", { name: "TTS" }).selectOption("google-cloud-standard");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "대화 시작" }).click();
  await expect.poll(() => selectedTts).toBe("google-cloud-standard");
  await page.getByRole("button", { name: "잠시 멈추기" }).click();
});

test("voice requires acknowledgement, shows the live transcript and releases the microphone when paused (fake provider)", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  let issued = 0;
  const state = await mockLearning(page); await fakeMicrophone(page);
  await page.route("**/api/voice/token", async route => {
    issued++;
    await route.fulfill({ json: { voiceConnectionToken: "auth_tokens/synthetic", testDurationSeconds: 180 } });
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
  await page.goto("/talk");
  const start = page.getByRole("button", { name: "대화 시작" });
  await expect(start).toBeDisabled(); expect(issued).toBe(0);
  await page.getByRole("checkbox").check(); await start.click();
  await expect(page.getByText("What would you order?", { exact: true })).toBeVisible();
  await expect(page.getByText("대화 중", { exact: true })).toBeVisible();
  expect(issued).toBe(1);
  await page.getByRole("button", { name: "잠시 멈추기", exact: true }).click();
  await expect(page.getByRole("button", { name: "이어서 하기" })).toBeVisible();
  expect(state.paused).toBe(true);
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
  await mockLearning(page);
  await page.goto("/talk"); await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "대화 시작" }).click();
  await expect(page.getByRole("status").filter({ hasText: "마이크 권한" })).toBeVisible();
  await expect(page.getByRole("button", { name: "대화 시작" })).toBeEnabled();
  expect(issued).toBe(0);
});

test("stored voice resumes confirmed correction state and finishes with the feedback note (fake provider)", async ({ page }) => {
  let connections = 0;
  const priorMessages: string[] = [];
  const state = await mockLearning(page, [{ learningSessionId: "synthetic-session", learningEndDateKst: "2026-10-29", noteMarkdown: "## 학습 상세\n\nSaved voice note: I went yesterday." }]);
  await fakeMicrophone(page);
  await page.route("**/api/voice/token", async route => {
    expect(route.request().postDataJSON().learningSessionId).toBe("synthetic-session");
    await route.fulfill({ json: { voiceConnectionToken: "auth_tokens/synthetic", testDurationSeconds: 180, priorLearningContext: { reviewExpressions: [{ expression: "Could I have some tea?", lastPracticedDateKst: "2026-10-28" }] } } });
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
  await page.goto("/talk"); await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "대화 시작" }).click();
  await expect(page.getByRole("heading", { name: "다시 말해 보기" })).toBeVisible();
  await page.getByRole("button", { name: "잠시 멈추기", exact: true }).click();
  const resume = page.getByRole("button", { name: "이어서 하기" });
  await expect(resume).toBeEnabled(); expect(state.paused).toBe(true);
  expect(state.snapshot.corrections).toHaveLength(1);
  await resume.click(); await expect(page.getByText("AI 재시도 판정: 성공", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "대화 종료", exact: true }).click();
  await expect(page.getByRole("heading", { name: /오늘의 대화를 마쳤어요/ })).toBeVisible();
  await expect(page.getByText("Saved voice note: I went yesterday.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Markdown 다운로드/ })).toBeVisible();
  expect(priorMessages).toHaveLength(2);
  expect(priorMessages.every(message => message.includes("Could I have some tea?") && !message.includes("I went yesterday."))).toBe(true);
  expect(state.ended).toBe(true); expect(state.snapshot.corrections[0].attempts).toHaveLength(1);
});
