/** Real-provider synthetic speech only. Never prints speech, transcripts, or credentials. */
import { spawnSync } from "node:child_process";
import { issueVoiceToken } from "../src/server/voice-token";
import { GeminiLiveAdapter } from "../src/voice/adapters/gemini-live";
import { VoiceLearningRecords, type VoiceLearningResult } from "../src/voice/learning";

// Synthetic speech is not reliably recognized by automatic voice activity detection.
// Keep this override in the smoke only, and constrain the token to the same setup.
function syntheticSetup(setup: object) {
  return { ...setup, realtimeInputConfig: { automaticActivityDetection: { disabled: true } } };
}

// Generate fixed fictional practice input locally, before requesting credentials.
function speech(text: string): Uint8Array {
  const result = spawnSync(process.env.TALKIE_SYNTHETIC_SPEECH ?? "espeak-ng",
    ["--stdout", "-v", "en-us", "-s", "135", text], { maxBuffer: 2 * 1024 * 1024 });
  if (result.status !== 0) throw new Error("SYNTHETIC_SPEECH_UNAVAILABLE");
  const wav = result.stdout;
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") throw new Error("SYNTHETIC_SPEECH_FORMAT");
  let rate = 0, samples: Buffer | undefined;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4), name = wav.toString("ascii", offset, offset + 4);
    if (name === "fmt ") {
      if (size < 16 || offset + 24 > wav.length || wav.readUInt16LE(offset + 8) !== 1 || wav.readUInt16LE(offset + 10) !== 1 || wav.readUInt16LE(offset + 22) !== 16) throw new Error("SYNTHETIC_SPEECH_FORMAT");
      rate = wav.readUInt32LE(offset + 12);
    }
    if (name === "data") { samples = wav.subarray(offset + 8, Math.min(wav.length, offset + 8 + size)); break; }
    offset += 8 + size + (size % 2);
  }
  if (!rate || !samples?.length || samples.length % 2) throw new Error("SYNTHETIC_SPEECH_FORMAT");
  const pcm = Buffer.alloc(Math.floor(samples.length / 2 * 16000 / rate) * 2);
  for (let i = 0; i < pcm.length / 2; i++) {
    const position = i * rate / 16000, left = Math.floor(position), right = Math.min(left + 1, samples.length / 2 - 1);
    pcm.writeInt16LE(Math.round(samples.readInt16LE(left * 2) * (1 - position + left) + samples.readInt16LE(right * 2) * (position - left)), i * 2);
  }
  return pcm;
}

async function main() {
  const inputs = [speech("I go to the park yesterday."), speech("I went to the park yesterday.")];
  const request: typeof fetch = (url, init) => {
    const body = JSON.parse(init!.body as string);
    body.bidiGenerateContentSetup = syntheticSetup(body.bidiGenerateContentSetup);
    return fetch(url, { ...init, body: JSON.stringify(body) });
  };
  const credential = await issueVoiceToken("local-synthetic-learning-smoke", request, true);
  const records = new VoiceLearningRecords();
  let socket: WebSocket, chunks = 0, bytes = 0, tools = 0, responses = 0;
  let inputSent: Promise<void> = Promise.resolve();
  let providerToolCalls = 0, inputTranscripts = 0, toolCallsBeforeInput = 0;
  let connected = false, sentBytes = 0, closeCode: number | undefined, adapterError: string | undefined;
  const transcripts = new Map<string, string>(), results = new Map<string, { inputTurnId: string; result: VoiceLearningResult }>();
  const responseChecks: object[] = [];
  let responseChunks = 0;
  await new Promise<void>((resolve, reject) => {
    let complete = false;
    const finish = (ok: boolean) => {
      if (complete) return;
      complete = true; clearTimeout(timeout); adapter.close();
      if (ok) resolve(); else reject(new Error("VOICE_LEARNING_SMOKE_FAILED"));
    };
    const send = async (pcm: Uint8Array) => {
      socket.send(JSON.stringify({ realtimeInput: { activityStart: {} } }));
      for (let offset = 0; offset < pcm.length && !complete; offset += 3200) {
        adapter.sendAudio(pcm.subarray(offset, offset + 3200), 16000);
        sentBytes += pcm.subarray(offset, offset + 3200).length;
        await new Promise(r => setTimeout(r, 100));
      }
      if (!complete) socket.send(JSON.stringify({ realtimeInput: { activityEnd: {} } }));
    };
    const timeout = setTimeout(() => finish(false), 60_000);
    const adapter = new GeminiLiveAdapter({ ...credential, learning: true }, event => {
      records.apply(event);
      if (event.type === "transcript") transcripts.set(event.turnId, (transcripts.get(event.turnId) ?? "") + event.text);
      if (event.type === "connected") {
        connected = true;
        inputSent = send(inputs[0]);
        void inputSent.catch(() => finish(false));
      }
      if (event.type === "audio") { chunks++; responseChunks++; bytes += event.pcm.byteLength; }
      if (event.type === "learning-result") { tools++; results.set(event.turnId, event); }
      if (event.type === "response-complete") {
        // Synthetic playback acknowledgement tests record assembly; there is no audio device.
        if (responseChunks > 0) records.apply({ type: "played", turnId: event.turnId });
        const metadata = results.get(event.turnId), input = transcripts.get(metadata?.inputTurnId ?? "") ?? "", output = transcripts.get(event.turnId) ?? "";
        const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
        responseChecks.push({ audioChunks: responseChunks, outputTranscript: Boolean(output), toolResult: Boolean(metadata),
          originalMatches: metadata ? input.trim() === metadata.result.original.trim() : undefined,
          originalMatchesNormalized: metadata ? normalize(input) === normalize(metadata.result.original) : undefined,
          hasReplacement: Boolean(metadata?.result.replacement),
          replacementInOutput: metadata?.result.replacement ? output.includes(metadata.result.replacement) : undefined,
          replacementInOutputNormalized: metadata?.result.replacement ? normalize(output).includes(normalize(metadata.result.replacement)) : undefined,
          learningState: metadata?.result.learningState, retryOutcome: metadata?.result.retryOutcome });
        responseChunks = 0;
        responses++;
        if (responses === 1) void inputSent.then(() => { if (!complete) return send(inputs[1]); }).catch(() => finish(false));
        else if (responses >= 2) {
          const snapshot = records.getSnapshot();
          finish(chunks > 0 && tools >= 2 && snapshot.corrections.some(c => c.attempts.some(a => a.outcome === "success")));
        }
      }
      if (event.type === "error") adapterError = event.code;
      if (event.type === "error" || event.type === "closed") finish(false);
    }, url => {
      socket = new WebSocket(url);
      const send = socket.send.bind(socket);
      socket.send = value => {
        const message = JSON.parse(String(value));
        if (message.setup) message.setup = syntheticSetup(message.setup);
        send(JSON.stringify(message));
      };
      socket.addEventListener("close", event => { closeCode = event.code; });
      socket.addEventListener("message", event => {
        void (async () => {
          const message = JSON.parse(typeof event.data === "string" ? event.data : await event.data.text());
          if (message.serverContent?.inputTranscription?.text) inputTranscripts++;
          const count = message.toolCall?.functionCalls?.length ?? 0;
          providerToolCalls += count;
          if (!inputTranscripts) toolCallsBeforeInput += count;
        })().catch(() => { /* The adapter handles protocol errors without logging payloads. */ });
      });
      return socket;
    });
    void adapter.connect().catch(() => finish(false));
  }).finally(() => {
    const snapshot = records.getSnapshot();
    const retrySuccesses = snapshot.corrections.flatMap(c => c.attempts).filter(a => a.outcome === "success").length;
    const failureStage = !connected ? "setup" : responses < 2 ? "response" : !snapshot.corrections.length ? "correction-evidence" : !retrySuccesses ? "retry-result" : undefined;
    console.log(JSON.stringify({ connected, sentBytes, closeCode, adapterError, audioChunks: chunks, audioBytes: bytes, toolResults: tools, responses,
      providerToolCalls, inputTranscripts, toolCallsBeforeInput,
      responseChecks, failureStage,
      userTurns: snapshot.turns.filter(t => t.role === "user").length, corrections: snapshot.corrections.length,
      retrySuccesses,
      activityDetection: "manual-synthetic-only", playback: "simulated", databaseWrites: false }));
  });
}
main().catch(() => { console.error("VOICE_LEARNING_SMOKE_FAILED: 합성 음성 생성·무료 설정·연결·구조화 결과를 확인하세요. 자동 재시도하지 않습니다."); process.exitCode = 1; });
