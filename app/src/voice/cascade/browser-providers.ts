import { SonioxRecognizer } from "./soniox";
import type { CascadeProviders } from "./providers";

export function createBrowserCascadeProviders(temporarySttKey: string, cascadeRequestToken: string, session?: { learningSessionId: string; learningConnectionToken: string }): CascadeProviders {
  async function call(action: "text" | "speech", value: object, signal: AbortSignal) {
    const response = await fetch("/api/voice/cascade", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ testOnly: true, action, cascadeRequestToken, ...session, ...value }), signal });
    if (!response.ok) throw new Error("VOICE_PROVIDER_UNAVAILABLE");
    return response;
  }
  return { stt: new SonioxRecognizer(temporarySttKey),
    llm: { async respond(value, signal) { return (await call("text", { context: value.context }, signal)).json(); } },
    tts: { async *synthesize(text, signal) {
      const response = await call("speech", { text }, signal);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 6_000_000 || bytes.length % 2) throw new Error("INVALID_AUDIO");
      for (let offset = 0; offset < bytes.length; offset += 96_000) {
        if (signal.aborted) return;
        yield { pcm: bytes.slice(offset, offset + 96_000), sampleRateHz: 24000 };
      }
    } },
  };
}
