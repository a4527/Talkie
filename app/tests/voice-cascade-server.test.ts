import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { authorizeCascadeRequest, recordCascadeReply, cascadeSpeech, cascadeText, issueCascadeCredential } from "../src/server/voice-cascade";
afterEach(() => { vi.unstubAllEnvs(); });
function configured() { vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000"); vi.stubEnv("TALKIE_VOICE_CASCADE_TEST", "enabled"); vi.stubEnv("SONIOX_API_KEY", "synthetic-soniox"); vi.stubEnv("GOOGLE_API_KEY", "synthetic-google"); }
it("issues a single-use bounded STT key and limits text/speech requests", async () => {
  configured();
  const request = vi.fn(async () => ({ ok: true, json: async () => ({ api_key: "temporary" }) })) as unknown as typeof fetch;
  const credential = await issueCascadeCredential("user-one", request);
  const [url, options] = vi.mocked(request).mock.calls[0];
  expect(url).toBe("https://api.soniox.com/v1/auth/temporary-api-key");
  expect(JSON.parse(String(options?.body))).toMatchObject({ usage_type: "transcribe_websocket", single_use: true, max_session_duration_seconds: 180 });
  expect(() => authorizeCascadeRequest(credential.cascadeRequestToken, "other", "text")).toThrow();
  const release = authorizeCascadeRequest(credential.cascadeRequestToken, "user-one", "text");
  expect(() => authorizeCascadeRequest(credential.cascadeRequestToken, "user-one", "speech")).toThrow(); release();
  for (let i = 1; i < 20; i++) authorizeCascadeRequest(credential.cascadeRequestToken, "user-one", "text")();
  expect(() => authorizeCascadeRequest(credential.cascadeRequestToken, "user-one", "text")).toThrow();
});
it("allows speech only once for the server-generated reply and binds a learning token to its session", async () => {
  configured();
  const request = vi.fn(async () => ({ ok: true, json: async () => ({ api_key: "temporary" }) })) as unknown as typeof fetch;
  const credential = await issueCascadeCredential("session-owner", request, "learning-one");
  const token = credential.cascadeRequestToken;
  expect(() => authorizeCascadeRequest(token, "session-owner", "text", "learning-two")).toThrow();
  const releaseText = authorizeCascadeRequest(token, "session-owner", "text", "learning-one");
  recordCascadeReply(token, "session-owner", "learning-one", "Hello there.");
  releaseText();
  expect(() => authorizeCascadeRequest(token, "session-owner", "speech", "learning-one", "Different text")).toThrow();
  authorizeCascadeRequest(token, "session-owner", "speech", "learning-one", "Hello there.")();
  expect(() => authorizeCascadeRequest(token, "session-owner", "speech", "learning-one", "Hello there.")).toThrow();
});
it("parses bounded structured text and PCM without exposing provider payloads", async () => {
  configured(); const snapshot = { turns: [{ turnId: "u", requestId: "u", role: "user" as const, text: "Hello" }], corrections: [], learningState: "conversation" as const };
  const request = vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ text: "Hello there." }) }] } }] }) })) as unknown as typeof fetch;
  expect((await cascadeText(snapshot, undefined, false, new AbortController().signal, request)).text).toBe("Hello there.");
  expect(String(vi.mocked(request).mock.calls[0][0])).toContain("gemini-3.5-flash-lite");
  const audio = vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from([0, 0, 1, 0]).toString("base64") } }] } }] }) })) as unknown as typeof fetch;
  expect(await cascadeSpeech("Hello", new AbortController().signal, audio)).toEqual(Buffer.from([0, 0, 1, 0]));
  expect(String(vi.mocked(audio).mock.calls[0][0])).toContain("gemini-3.8-flash-lite-tts");
});

it("normalizes Gemini spokenText without inventing learning evidence", async () => {
  configured();
  const request = vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ spokenText: "Hello there." }) }] } }] }) })) as unknown as typeof fetch;
  const snapshot = { turns: [{ turnId: "u", requestId: "u", role: "user" as const, text: "Hello" }], corrections: [], learningState: "conversation" as const };
  expect(await cascadeText(snapshot, undefined, false, new AbortController().signal, request)).toEqual({ text: "Hello there.", learningResult: undefined });
});
