import { getVoiceLearningContext } from "../src/server/learning";
import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
vi.mock("../src/server/learning", () => ({ getVoiceLearningContext: vi.fn() }));
vi.mock("../src/server/auth", () => ({ withIdentity: vi.fn() }));
vi.mock("../src/server/voice-token", () => ({ issueVoiceToken: vi.fn() }));
import { POST } from "../src/app/api/voice/token/route";
import { withIdentity } from "../src/server/auth";
import { issueVoiceToken } from "../src/server/voice-token";
import { AppError } from "../src/server/config";
function request(origin = "http://127.0.0.1:3000", testOnly = true) {
  return new NextRequest("http://127.0.0.1:3000/api/voice/token", { method: "POST",
    headers: { host: "127.0.0.1:3000", origin, "Content-Type": "application/json", cookie: "talkie_session=synthetic-session" },
    body: JSON.stringify({ testOnly }) });
}
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
it("rejects cross-origin provisioning before authentication or upstream calls", async () => {
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
  expect((await POST(request("https://elsewhere.test"))).status).toBe(403);
  expect(withIdentity).not.toHaveBeenCalled(); expect(issueVoiceToken).not.toHaveBeenCalled();
});
it("requires test acknowledgement before provisioning", async () => {
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
  expect((await POST(request(undefined, false))).status).toBe(403);
  expect(issueVoiceToken).not.toHaveBeenCalled();
});
it("does not provision credentials for an unauthenticated or deleted account", async () => {
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
  vi.mocked(withIdentity).mockRejectedValue(new AppError("LOGIN_REQUIRED", 401));
  expect((await POST(request())).status).toBe(401); expect(issueVoiceToken).not.toHaveBeenCalled();
});
it("returns only the ephemeral credential with no-store caching after authentication", async () => {
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
  vi.mocked(withIdentity).mockResolvedValue("synthetic-user");
  vi.mocked(issueVoiceToken).mockResolvedValue({ voiceConnectionToken: "auth_tokens/synthetic", testDurationSeconds: 180 });
  const response = await POST(request());
  expect(issueVoiceToken).toHaveBeenCalledWith("synthetic-user");
  expect(response.headers.get("Cache-Control")).toBe("no-store, private");
  expect(await response.json()).toEqual({ voiceConnectionToken: "auth_tokens/synthetic", testDurationSeconds: 180 });
});

it("checks the owned learning connection before issuing a learning-enabled token", async () => {
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
  const linked = () => new NextRequest("http://127.0.0.1:3000/api/voice/token", { method: "POST", headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "Content-Type": "application/json", cookie: "talkie_session=synthetic-session" }, body: JSON.stringify({ testOnly: true, learningSessionId: "synthetic-learning", learningConnectionToken: "synthetic-connection" }) });
  vi.mocked(getVoiceLearningContext).mockRejectedValueOnce(new AppError("CONNECTION_EXPIRED", 409));
  expect((await POST(linked())).status).toBe(409); expect(issueVoiceToken).not.toHaveBeenCalled();
  vi.mocked(getVoiceLearningContext).mockResolvedValueOnce({ userId: "synthetic-user", priorLearningContext: { reviewExpressions: [] } });
  vi.mocked(issueVoiceToken).mockResolvedValue({ voiceConnectionToken: "auth_tokens/synthetic", testDurationSeconds: 180 });
  const response = await POST(linked());
  expect(response.status).toBe(200);
  expect((await response.json()).priorLearningContext).toEqual({ reviewExpressions: [] });
  expect(getVoiceLearningContext).toHaveBeenLastCalledWith("synthetic-session", "synthetic-learning", "synthetic-connection");
  expect(issueVoiceToken).toHaveBeenCalledWith("synthetic-user", fetch, true);
});
