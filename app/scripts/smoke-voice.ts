/** Explicit real-provider smoke: fixed synthetic input, no devices, transcript/audio content never logged. */
import { issueVoiceToken } from "../src/server/voice-token";
import { GeminiLiveAdapter } from "../src/voice/adapters/gemini-live";

async function main() {
  const credential = await issueVoiceToken("local-synthetic-smoke");
  let socket: WebSocket, chunks = 0, bytes = 0, transcribed = false;
  await new Promise<void>((resolve, reject) => {
    let complete = false;
    const timeout = setTimeout(() => finish(false), 25_000);
    const finish = (ok: boolean) => {
      if (complete) return;
      complete = true; clearTimeout(timeout); adapter.close();
      if (ok) resolve(); else reject(new Error("VOICE_SMOKE_FAILED"));
    };
    const adapter = new GeminiLiveAdapter(credential, event => {
      if (event.type === "connected") socket.send(JSON.stringify({ clientContent: { turns: [
        { role: "user", parts: [{ text: "This is a synthetic connection test. Say hello in one short English sentence." }] },
      ], turnComplete: true } }));
      if (event.type === "audio") { chunks++; bytes += event.pcm.byteLength; }
      if (event.type === "transcript" && event.role === "assistant") transcribed = true;
      if (event.type === "response-complete") finish(chunks > 0 && transcribed);
      if (event.type === "error" || event.type === "closed") finish(false);
    }, url => (socket = new WebSocket(url)));
    void adapter.connect().catch(() => finish(false));
  });
  console.log(JSON.stringify({ connected: true, audioChunks: chunks, audioBytes: bytes, transcriptReceived: transcribed }));
}
main().catch(() => { console.error("VOICE_SMOKE_FAILED: 키·무료 티어 설정·연결 상태를 확인하세요. 자동 재시도하지 않습니다."); process.exitCode = 1; });
