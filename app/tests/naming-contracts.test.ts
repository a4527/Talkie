import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
import { encodeStoredConversationSnapshot, validateConversationSnapshot } from "../src/server/learning";

const legacySnapshot = {
  turns: [
    { id: "u1", requestId: "r1", role: "user", text: "Synthetic answer" },
    { id: "a1", requestId: "r1", role: "assistant", text: "Try: synthetic replacement" },
    { id: "u2", requestId: "r2", role: "user", text: "Synthetic retry" },
  ],
  corrections: [{ id: "c1", sourceTurnId: "u1", deliveredTurnId: "a1", replacement: "synthetic replacement", explanation: "Synthetic explanation", attempts: [{ turnId: "u2", outcome: "success" }] }],
  learning: "conversation", gaps: true,
};

describe("stored naming compatibility", () => {
  it("restores old turn/correction/state/gap fields and preserves canonical bytes and hash", () => {
    const conversationSnapshot = validateConversationSnapshot(legacySnapshot);
    expect(conversationSnapshot.turns[0].turnId).toBe("u1");
    expect(conversationSnapshot.corrections[0].correctionId).toBe("c1");
    expect(conversationSnapshot.corrections[0].attempts).toEqual([{ turnId: "u2", outcome: "success" }]);
    expect(conversationSnapshot.hasConversationGaps).toBe(true);
    const encoded = JSON.stringify(encodeStoredConversationSnapshot(conversationSnapshot));
    expect(encoded).toBe(JSON.stringify(legacySnapshot));
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    expect(hash(encoded)).toBe(hash(JSON.stringify(legacySnapshot)));
    expect(validateConversationSnapshot(conversationSnapshot)).toEqual(conversationSnapshot);
  });
  it("keeps the initial snapshot bytes stable and rejects invalid old/new references", () => {
    expect(JSON.stringify(encodeStoredConversationSnapshot(validateConversationSnapshot({ turns: [], corrections: [], learning: "conversation", gaps: false }))))
      .toBe('{"turns":[],"corrections":[],"learning":"conversation","gaps":false}');
    expect(() => validateConversationSnapshot({ ...legacySnapshot, turns: [] })).toThrow("INVALID_RECORD");
    const renamed = validateConversationSnapshot(legacySnapshot);
    expect(() => validateConversationSnapshot({ ...renamed, corrections: [{ ...renamed.corrections[0], deliveredTurnId: "missing" }] })).toThrow("INVALID_RECORD");
  });
});

// Exercise the real route parser/response helpers; only authenticated domain work
// is mocked. No database, email or provider request is made by these tests.
vi.mock("../src/server/auth", () => ({ withIdentity: vi.fn(), consumeLink: vi.fn(), deleteAccount: vi.fn(), inspectLink: vi.fn(), logout: vi.fn(), requestLink: vi.fn(), digest: (s: string) => s }));
vi.mock("../src/server/learning", async importOriginal => ({ ...await importOriginal<typeof import("../src/server/learning")>(), startLearning: vi.fn(), saveLearning: vi.fn(), listLearningRecords: vi.fn() }));
import { POST as learnPost, GET as learnGet } from "../src/app/api/learn/route";
import { POST as accountPost } from "../src/app/api/account/route";
import { listLearningRecords, saveLearning, startLearning } from "../src/server/learning";
import { consumeLink, requestLink } from "../src/server/auth";
function request(path: string, body: unknown) {
  return new NextRequest(`http://127.0.0.1:3000/api/${path}`, { method: "POST", headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "Content-Type": "application/json", cookie: "talkie_session=synthetic-login" }, body: JSON.stringify(body) });
}
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
it("passes distinct learning identifiers and credentials through the renamed route", async () => {
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
  const conversationSnapshot = validateConversationSnapshot(legacySnapshot);
  vi.mocked(startLearning).mockResolvedValue({ learningSessionId: "synthetic-learning", learningConnectionToken: "synthetic-connection", confirmedSaveSequenceNumber: 0, demoScenario: "correction", conversationSnapshot });
  const response = await learnPost(request("learn", { action: "start", scenario: "correction" }));
  expect(startLearning).toHaveBeenCalledWith("synthetic-login", "correction");
  expect(await response.json()).toMatchObject({ learningSessionId: "synthetic-learning", learningConnectionToken: "synthetic-connection" });
  vi.mocked(saveLearning).mockResolvedValue({ confirmedSaveSequenceNumber: 1 });
  expect((await learnPost(request("learn", { action: "save", learningSessionId: "synthetic-learning", learningConnectionToken: "synthetic-connection", saveSequenceNumber: 1, conversationSnapshot }))).status).toBe(200);
  expect(saveLearning).toHaveBeenCalledWith("synthetic-login", "synthetic-learning", "synthetic-connection", 1, conversationSnapshot);
  vi.mocked(listLearningRecords).mockResolvedValue({ emailAddress: "learner@example.test", notes: [{ learningEndDateKst: "2026-10-27", noteMarkdown: "Synthetic note" }], sessions: [{ learningSessionId: "synthetic-learning", learningSessionStatus: "ended", noteGenerationStatus: "ready" }] });
  const records = await learnGet(request("learn", {}));
  expect((await records.json()).sessions[0]).toMatchObject({ learningSessionStatus: "ended", noteGenerationStatus: "ready" });
});
it("keeps auth link and login session credentials separate and sets the original cookie", async () => {
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
  vi.mocked(requestLink).mockResolvedValue(undefined);
  expect((await accountPost(request("account", { action: "request", emailAddress: "learner@example.test", purpose: "login" }))).status).toBe(200);
  expect(requestLink).toHaveBeenCalledWith("learner@example.test", "login", "synthetic-login");
  vi.mocked(consumeLink).mockResolvedValue({ purpose: "login", loginSessionToken: "new-synthetic-login", expiresAt: new Date() });
  const response = await accountPost(request("account", { action: "confirm", authLinkToken: "synthetic-link" }));
  expect(consumeLink).toHaveBeenCalledWith("synthetic-link", "synthetic-login");
  expect(response.headers.get("set-cookie")).toContain("talkie_session=new-synthetic-login;");
  expect(await response.json()).toEqual({ purpose: "login" });
});
