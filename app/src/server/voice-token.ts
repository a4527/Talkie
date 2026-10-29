import "server-only";
import { AppError, getLocalConfig } from "./config";
import { createGeminiLiveSetup, VOICE_TEST_SECONDS } from "../voice/gemini-live-setup";

// Local, single-process test guard only. This is not an operational quota or cost system.
const issuedUntil = new Map<string, number>();
export function requireVoiceTestConfiguration() {
  getLocalConfig(); // Reject non-loopback deployments using the existing local configuration boundary.
  if (process.env.TALKIE_VOICE_TEST !== "gemini-free" || process.env.GEMINI_FREE_TIER_CONFIRMED !== "true") {
    throw new AppError("VOICE_TEST_DISABLED", 403);
  }
  const key = process.env.GOOGLE_API_KEY?.trim();
  if (!key) throw new AppError("VOICE_KEY_REQUIRED", 503);
  return key;
}
export async function issueVoiceToken(userId: string, request: typeof fetch = fetch, learning = false) {
  const key = requireVoiceTestConfiguration();
  const now = Date.now();
  for (const [id, until] of issuedUntil) if (until <= now) issuedUntil.delete(id);
  if (issuedUntil.has(userId)) throw new AppError("VOICE_TEST_WAIT", 429);
  issuedUntil.set(userId, now + (VOICE_TEST_SECONDS + 60) * 1000);
  try {
    const res = await request("https://generativelanguage.googleapis.com/v1beta/auth_tokens", {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ uses: 1, expireTime: new Date(now + (VOICE_TEST_SECONDS + 60) * 1000).toISOString(),
        newSessionExpireTime: new Date(now + 60_000).toISOString(),
        bidiGenerateContentSetup: createGeminiLiveSetup(learning) }),
      signal: AbortSignal.timeout(10_000), cache: "no-store",
    });
    if (!res.ok) throw new AppError("VOICE_TOKEN_UNAVAILABLE", 503);
    const result = await res.json();
    if (typeof result.name !== "string" || !result.name.startsWith("auth_tokens/")) throw new AppError("VOICE_TOKEN_UNAVAILABLE", 503);
    return { voiceConnectionToken: result.name, testDurationSeconds: VOICE_TEST_SECONDS };
  } catch {
    // Keep the reservation after an ambiguous upstream failure; no automatic retries.
    throw new AppError("VOICE_TOKEN_UNAVAILABLE", 503);
  }
}
