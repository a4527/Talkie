import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../src/server/google-cloud-auth", () => ({ getCloudTtsAccessToken: vi.fn(async () => "synthetic-token") }));
import { NonRetryableExtractionError } from "../src/voice/note-extraction";
import { getCloudTtsAccessToken } from "../src/server/google-cloud-auth";
import { authorizeCascadeRequest, recordCascadeReply, cascadeSelectionForToken, cascadeSpeech, cascadeText, createGeminiExtractionGenerate, issueCascadeCredential } from "../src/server/voice-cascade";
import type { CascadeSelection } from "../src/voice/cascade/selection";
afterEach(() => { vi.unstubAllEnvs(); });
function configured() { vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000"); vi.stubEnv("TALKIE_VOICE_CASCADE_TEST", "enabled"); vi.stubEnv("SONIOX_API_KEY", "synthetic-soniox"); vi.stubEnv("GOOGLE_API_KEY", "synthetic-google"); }
const cloudSelection: CascadeSelection = { stt: "soniox", llm: "gemini-flash-lite", tts: "google-cloud-standard" };
function wavFixture() {
  const wav = Buffer.alloc(48);
  wav.write("RIFF", 0); wav.writeUInt32LE(40, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(4, 40);
  wav[44] = 1; wav[46] = 2;
  return wav;
}
it("binds the selected TTS to the issued connection and rejects missing Cloud setup", async () => {
  configured();
  const temporaryKey = vi.fn(async () => ({ ok: true, json: async () => ({ api_key: "temporary" }) })) as unknown as typeof fetch;
  await expect(issueCascadeCredential("cloud-owner", temporaryKey, undefined, cloudSelection)).rejects.toMatchObject({ code: "VOICE_KEY_REQUIRED" });
  expect(temporaryKey).not.toHaveBeenCalled();
  vi.stubEnv("GOOGLE_CLOUD_PROJECT", "synthetic-project");
  const credential = await issueCascadeCredential("cloud-owner", temporaryKey, undefined, cloudSelection);
  expect(getCloudTtsAccessToken).toHaveBeenCalled();
  expect(cascadeSelectionForToken(credential.cascadeRequestToken, "cloud-owner")).toEqual(cloudSelection);
  expect(() => cascadeSelectionForToken(credential.cascadeRequestToken, "other")).toThrow();
});
it("sends Cloud TTS with the selected project and returns only validated PCM", async () => {
  configured(); vi.stubEnv("GOOGLE_CLOUD_PROJECT", "synthetic-project");
  const request = vi.fn(async () => ({ ok: true, json: async () => ({ audioContent: wavFixture().toString("base64") }) })) as unknown as typeof fetch;
  expect(await cascadeSpeech("Hello", new AbortController().signal, request, undefined, "google-cloud-standard")).toEqual(Buffer.from([1, 0, 2, 0]));
  const [url, options] = vi.mocked(request).mock.calls[0];
  expect(url).toBe("https://texttospeech.googleapis.com/v1/text:synthesize");
  expect(options?.headers).toMatchObject({ "x-goog-user-project": "synthetic-project", Authorization: "Bearer synthetic-token" });
  expect(JSON.parse(String(options?.body)).voice.name).toBe("en-US-Standard-C");
  await cascadeSpeech("좋아요", new AbortController().signal, request, undefined, "google-cloud-standard");
  expect(JSON.parse(String(vi.mocked(request).mock.calls[1][1]?.body)).voice.name).toBe("ko-KR-Standard-A");
  const invalid = vi.fn(async () => ({ ok: true, json: async () => ({ audioContent: Buffer.from("not wav").toString("base64") }) })) as unknown as typeof fetch;
  await expect(cascadeSpeech("Hello", new AbortController().signal, invalid, undefined, "google-cloud-standard")).rejects.toThrow();
});
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

it("observes server-side text and TTS usage without putting it in client payloads", async () => {
  configured();
  const snapshot = { turns: [{ turnId: "u", requestId: "u", role: "user" as const, text: "Hello" }], corrections: [], learningState: "conversation" as const };
  const textUsage = vi.fn();
  const textRequest = vi.fn(async () => ({ ok: true, json: async () => ({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ text: "Hello there." }) }] } }],
    usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 2, totalTokenCount: 10 },
  }) })) as unknown as typeof fetch;
  expect(await cascadeText(snapshot, undefined, false, new AbortController().signal, textRequest, textUsage)).toEqual({ text: "Hello there.", learningResult: undefined });
  expect(textUsage).toHaveBeenCalledWith(expect.objectContaining({ status: "reported", model: "gemini-3.5-flash-lite", totalTokenCount: 10 }));

  const speechUsage = vi.fn();
  const speechRequest = vi.fn(async () => ({ ok: true, json: async () => ({
    candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from([0, 0]).toString("base64") } }] } }],
    usageMetadata: { promptTokensDetails: [{ modality: "TEXT", tokenCount: 2 }], candidatesTokensDetails: [{ modality: "AUDIO", tokenCount: 26 }] },
  }) })) as unknown as typeof fetch;
  expect(await cascadeSpeech("Hello", new AbortController().signal, speechRequest, speechUsage)).toEqual(Buffer.from([0, 0]));
  expect(speechUsage).toHaveBeenCalledWith(expect.objectContaining({ status: "reported", model: "gemini-3.8-flash-lite-tts", candidatesTokensDetails: [{ modality: "AUDIO", tokenCount: 26 }] }));
});

it("marks an unsuccessful provider request as unconfirmed usage", async () => {
  configured();
  const usage = vi.fn();
  const request = vi.fn(async () => ({ ok: false })) as unknown as typeof fetch;
  await expect(cascadeSpeech("Hello", new AbortController().signal, request, usage)).rejects.toThrow();
  expect(usage).toHaveBeenCalledWith({ provider: "google", model: "gemini-3.8-flash-lite-tts", source: "server_response", status: "unavailable" });
});

it("note extraction adapter sends the system prompt and classifies upstream errors", async () => {
  configured();
  const ok = vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }) })) as unknown as typeof fetch;
  expect(await createGeminiExtractionGenerate(ok)({ system: "SYS", input: "IN", maxOutputTokens: 77 }, new AbortController().signal)).toBe("{}");
  const body = JSON.parse((ok as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
  expect(body.systemInstruction.parts[0].text).toBe("SYS");
  expect(body.generationConfig.maxOutputTokens).toBe(77);
  const fail = (status: number) => createGeminiExtractionGenerate(vi.fn(async () => ({ ok: false, status })) as unknown as typeof fetch)({ system: "s", input: "i", maxOutputTokens: 1 }, new AbortController().signal);
  await expect(fail(401)).rejects.toBeInstanceOf(NonRetryableExtractionError);
  await expect(fail(429)).rejects.not.toBeInstanceOf(NonRetryableExtractionError);
  await expect(fail(503)).rejects.not.toBeInstanceOf(NonRetryableExtractionError);
});
