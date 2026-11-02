import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getCloudTtsAccessToken } from "../src/server/google-cloud-auth";

// Fixed, fictional lines keep provider comparison separate from user records.
const samples = [
  { id: "english", text: "I went hiking with my sister. We saw a small lake.", sonioxLanguage: "en", cloudLanguage: "en-US", cloudVoice: "en-US-Standard-C" },
  { id: "korean", text: "좋아요. 이번에는 천천히 다시 말해 볼까요?", sonioxLanguage: "ko", cloudLanguage: "ko-KR", cloudVoice: "ko-KR-Standard-A" },
] as const;
const provider = process.argv[2];
if (provider !== "soniox" && provider !== "google-cloud") throw new Error("Usage: compare-tts.ts soniox|google-cloud");

function normalizeWavLength(audio: Buffer) {
  if (audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") throw new Error("INVALID_WAV_AUDIO");
  audio.writeUInt32LE(audio.length - 8, 4);
  for (let offset = 12; offset + 8 <= audio.length;) {
    const size = audio.readUInt32LE(offset + 4);
    if (audio.toString("ascii", offset, offset + 4) === "data") {
      if (size === 0xffffffff) audio.writeUInt32LE(audio.length - offset - 8, offset + 4);
      else if (offset + 8 + size > audio.length) throw new Error("INVALID_WAV_AUDIO");
      return audio;
    }
    if (size === 0xffffffff || offset + 8 + size > audio.length) break;
    offset += 8 + size + (size % 2);
  }
  throw new Error("INVALID_WAV_AUDIO");
}

const directory = join(process.cwd(), ".local", "tts-compare");
await mkdir(directory, { recursive: true });
for (const sample of samples) {
  const start = performance.now();
  let audio: Buffer;
  if (provider === "soniox") {
    const key = process.env.SONIOX_API_KEY?.trim();
    if (!key) throw new Error("SONIOX_API_KEY_REQUIRED");
    const response = await fetch("https://tts-rt.soniox.com/tts", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "tts-rt-v2", voice: "Daniel", language: sample.sonioxLanguage, audio_format: "wav", sample_rate: 24000, text: sample.text }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`SONIOX_TTS_HTTP_${response.status}`);
    audio = Buffer.from(await response.arrayBuffer());
  } else {
    // GOOGLE_API_KEY is a Gemini Developer API key and must not be used here.
    const token = await getCloudTtsAccessToken();
    const project = process.env.GOOGLE_CLOUD_PROJECT?.trim();
    if (!project) throw new Error("GOOGLE_CLOUD_PROJECT_REQUIRED");
    const response = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "x-goog-user-project": project, "Content-Type": "application/json" },
      body: JSON.stringify({ input: { text: sample.text }, voice: { languageCode: sample.cloudLanguage, name: sample.cloudVoice }, audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 24000 } }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`GOOGLE_CLOUD_TTS_HTTP_${response.status}`);
    const data = await response.json() as { audioContent?: unknown };
    if (typeof data.audioContent !== "string" || data.audioContent.length > 8_000_000) throw new Error("INVALID_CLOUD_AUDIO");
    audio = Buffer.from(data.audioContent, "base64");
  }
  if (audio.length < 44 || audio.length > 6_000_000) throw new Error("INVALID_WAV_AUDIO");
  audio = normalizeWavLength(audio);
  const file = join(directory, `${provider}-${sample.id}.wav`);
  await writeFile(file, audio);
  console.log(JSON.stringify({ provider, sample: sample.id, characters: sample.text.length, bytes: audio.length, elapsedMs: Math.round(performance.now() - start), file }));
}
