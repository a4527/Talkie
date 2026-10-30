import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
vi.mock("../src/server/auth", () => ({ withIdentity: vi.fn() }));
vi.mock("../src/server/learning", () => ({ getVoiceLearningContext: vi.fn(), validateConversationSnapshot: vi.fn(v => v) }));
vi.mock("../src/server/voice-cascade", () => ({ issueCascadeCredential: vi.fn(), authorizeCascadeRequest: vi.fn(() => vi.fn()), recordCascadeReply: vi.fn(), cascadeText: vi.fn(), cascadeSpeech: vi.fn() }));
import { POST } from "../src/app/api/voice/cascade/route";
import { withIdentity } from "../src/server/auth";
import { getVoiceLearningContext } from "../src/server/learning";
import { issueCascadeCredential, authorizeCascadeRequest, recordCascadeReply, cascadeText, cascadeSpeech } from "../src/server/voice-cascade";
function request(body: unknown, origin = "http://127.0.0.1:3000") { return new NextRequest("http://127.0.0.1:3000/api/voice/cascade", { method: "POST", headers: { host: "127.0.0.1:3000", origin, "Content-Type": "application/json", cookie: "talkie_session=test" }, body: JSON.stringify(body) }); }
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
it("blocks cross-origin and missing test acknowledgement before any credential issuance", async () => {
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
  expect((await POST(request({ action: "credential", testOnly: true }, "https://evil.test"))).status).toBe(403);
  expect((await POST(request({ action: "credential" }))).status).toBe(403);
  expect(issueCascadeCredential).not.toHaveBeenCalled();
});
it("provisions only for authenticated owner and never returns permanent credentials", async () => {
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
  vi.mocked(getVoiceLearningContext).mockResolvedValue({ userId: "owner", priorLearningContext: { reviewExpressions: [] } });
  vi.mocked(issueCascadeCredential).mockResolvedValue({ temporarySttKey: "temporary", cascadeRequestToken: "request", testDurationSeconds: 180 });
  const response = await POST(request({ action: "credential", testOnly: true, learningSessionId: "session", learningConnectionToken: "connection" }));
  expect(getVoiceLearningContext).toHaveBeenCalledWith("test", "session", "connection");
  expect(issueCascadeCredential).toHaveBeenCalledWith("owner", expect.any(Function), "session");
  expect(response.headers.get("Cache-Control")).toBe("no-store, private");
  expect(await response.json()).toMatchObject({ temporarySttKey: "temporary", cascadeRequestToken: "request" });
});
it("enforces request authorization on text and speech before upstream calls", async () => {
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
  vi.mocked(withIdentity).mockResolvedValue("owner");
  vi.mocked(cascadeText).mockResolvedValue({ text: "hello", learningResult: undefined });
  vi.mocked(cascadeSpeech).mockResolvedValue(Buffer.from([0, 0]));
  const context = { turns: [{ turnId: "u", requestId: "u", role: "user", text: "Hello" }], corrections: [], learningState: "conversation" };
  expect((await POST(request({ action: "text", testOnly: true, cascadeRequestToken: "request", context }))).status).toBe(200);
  expect((await POST(request({ action: "speech", testOnly: true, cascadeRequestToken: "request", text: "hello" }))).status).toBe(200);
  expect(authorizeCascadeRequest).toHaveBeenCalledWith("request", "owner", "text", undefined);
  expect(authorizeCascadeRequest).toHaveBeenCalledWith("request", "owner", "speech", undefined, "hello");
  expect(recordCascadeReply).toHaveBeenCalledWith("request", "owner", undefined, "hello");
  expect(cascadeText).toHaveBeenCalledOnce(); expect(cascadeSpeech).toHaveBeenCalledOnce();
});
