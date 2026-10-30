import type { ConversationSnapshot } from "../../learning/types";
import { selectVoiceContext } from "../context";
import { parseVoiceLearningResult, VoiceLearningRecords } from "../learning";
import type { VoiceEvent, VoiceListener, VoicePort } from "../port";
import type { PriorLearningContext } from "../prior-learning";
import { createTutorInstruction } from "../tutor-prompt";
import type { CascadeProviders, RecognitionEvent, SpeechChunk } from "../cascade/providers";

type Output = { turnId: string; abort: AbortController; complete: boolean; timer: ReturnType<typeof setTimeout> };
const validAudio = ({ pcm, sampleRateHz }: SpeechChunk) => pcm instanceof Uint8Array && pcm.length > 0 && pcm.length <= 256 * 1024 && pcm.length % 2 === 0 && Number.isInteger(sampleRateHz) && sampleRateHz >= 8000 && sampleRateHz <= 96000;

/** Provider-independent STT → text judgement → streamed PCM. No credentials, storage or logging. */
export class CascadeAdapter implements VoicePort {
  private state: "idle" | "connecting" | "ready" | "closed" = "idle";
  private lifetime = new AbortController();
  private records = new VoiceLearningRecords();
  private prior?: PriorLearningContext;
  private utterance?: { id: string; finalized: boolean };
  private seen = new Set<string>();
  private output?: Output;
  constructor(private providers: CascadeProviders, private emit: VoiceListener,
    private options: { learning?: boolean; connectTimeoutMs?: number; responseTimeoutMs?: number } = {}) {}

  async connect(context?: ConversationSnapshot, prior?: PriorLearningContext) {
    if (this.state !== "idle") throw new Error("VOICE_CONNECTION_STATE");
    this.state = "connecting";
    this.records = new VoiceLearningRecords(context);
    this.prior = prior ? structuredClone(prior) : undefined;
    const timer = setTimeout(() => this.fail("timeout"), this.options.connectTimeoutMs ?? 15000);
    try {
      // Abort must settle connection even if a faulty transport ignores its signal.
      await new Promise<void>((resolve, reject) => {
        this.lifetime.signal.addEventListener("abort", () => reject(new Error("VOICE_CONNECTION_CLOSED")), { once: true });
        Promise.resolve().then(() => {
          if (this.lifetime.signal.aborted) throw new Error("VOICE_CONNECTION_CLOSED");
          return this.providers.stt.connect(event => this.receive(event), this.lifetime.signal);
        }).then(resolve, reject);
      });
      if (this.lifetime.signal.aborted) throw new Error("VOICE_CONNECTION_CLOSED");
      this.state = "ready";
      this.dispatch({ type: "connected" });
    } catch {
      this.fail("connection");
      throw new Error("VOICE_CONNECTION_CLOSED");
    } finally { clearTimeout(timer); }
  }
  sendAudio(pcm: Uint8Array, sampleRateHz: number) {
    if (this.state !== "ready") return;
    if (!validAudio({ pcm, sampleRateHz })) { this.fail("protocol"); return; }
    try { this.providers.stt.sendAudio(pcm, sampleRateHz); } catch { this.fail("connection"); }
  }
  private dispatch(event: VoiceEvent) { this.records.apply(event); this.emit(event); }
  private receive(event: RecognitionEvent) {
    if (this.state !== "ready") return;
    if (event.type === "error") { this.fail(event.code === "billing" ? "billing" : "connection"); return; }
    if (typeof event.utteranceId !== "string" || !event.utteranceId || event.utteranceId.length > 200) { this.fail("protocol"); return; }
    if (event.type === "speech-start") {
      if (this.seen.has(event.utteranceId)) return;
      // Bound deduplication memory without allowing old utterance IDs to replay.
      if (this.seen.size >= 2048) { this.fail("protocol"); return; }
      this.seen.add(event.utteranceId);
      this.utterance = { id: event.utteranceId, finalized: false };
      this.cancelOutput();
      return;
    }
    const utterance = this.utterance;
    if (!utterance || utterance.id !== event.utteranceId || utterance.finalized) return;
    utterance.finalized = true;
    if (typeof event.text !== "string" || event.text.length > 6000) { this.fail("protocol"); return; }
    if (!event.text.trim()) return; // Silence is not a learner turn.
    const inputTurnId = crypto.randomUUID();
    this.dispatch({ type: "transcript", role: "user", turnId: inputTurnId, text: event.text });
    this.dispatch({ type: "input-complete", turnId: inputTurnId });
    if (this.state !== "ready") return;
    const output: Output = { turnId: crypto.randomUUID(), abort: new AbortController(), complete: false,
      timer: setTimeout(() => this.fail("timeout"), this.options.responseTimeoutMs ?? 45000) };
    this.output = output;
    void this.respond(output, inputTurnId);
  }
  private live(output: Output) { return this.state === "ready" && this.output === output && !output.abort.signal.aborted; }
  private async respond(output: Output, inputTurnId: string) {
    try {
      const reply = await this.providers.llm.respond({ instruction: createTutorInstruction(this.options.learning === true),
        context: selectVoiceContext(this.records.getSnapshot()), priorLearningContext: this.prior ? structuredClone(this.prior) : undefined }, output.abort.signal);
      if (!this.live(output)) return;
      if (typeof reply.text !== "string" || !reply.text.trim() || reply.text.length > 6000) throw new Error("INVALID_REPLY");
      const result = reply.learningResult === undefined ? undefined : parseVoiceLearningResult(reply.learningResult);
      if (reply.learningResult !== undefined && !result) throw new Error("INVALID_RESULT");
      this.dispatch({ type: "transcript", role: "assistant", turnId: output.turnId, text: reply.text });
      if (!this.live(output)) return;
      if (this.options.learning && result) this.dispatch({ type: "learning-result", turnId: output.turnId, inputTurnId, result });
      if (!this.live(output)) return;
      let seconds = 0;
      for await (const chunk of this.providers.tts.synthesize(reply.text, output.abort.signal)) {
        if (!this.live(output)) return;
        if (!validAudio(chunk)) throw new Error("INVALID_AUDIO");
        seconds += chunk.pcm.length / (2 * chunk.sampleRateHz);
        if (seconds > 60) throw new Error("OUTPUT_TOO_LONG");
        this.dispatch({ type: "audio", turnId: output.turnId, ...chunk });
      }
      if (!this.live(output)) return;
      if (!seconds) throw new Error("EMPTY_AUDIO");
      output.complete = true;
      this.dispatch({ type: "response-complete", turnId: output.turnId, inputTurnId });
      // Keep cancellation and timeout armed until the actual output device acknowledges playback.
    } catch {
      if (this.live(output)) this.fail("protocol");
    }
  }
  acknowledgePlayback(turnId: string) {
    const output = this.output;
    if (!output || output.turnId !== turnId || !output.complete || !this.live(output)) return;
    this.records.apply({ type: "played", turnId });
    clearTimeout(output.timer); this.output = undefined;
  }
  private cancelOutput() {
    const output = this.output;
    if (!output) return;
    this.output = undefined; clearTimeout(output.timer); output.abort.abort();
    this.dispatch({ type: "interrupted", turnId: output.turnId });
  }
  private fail(code: "connection" | "protocol" | "timeout" | "billing") {
    if (this.state === "closed") return;
    this.cancelOutput();
    this.dispatch({ type: "error", code });
    this.close();
  }
  close() {
    if (this.state === "closed") return;
    this.state = "closed";
    this.cancelOutput(); this.lifetime.abort();
    try { this.providers.stt.close(); } catch { /* Transport details never escape. */ }
    this.prior = undefined; this.utterance = undefined; this.seen.clear();
    this.records = new VoiceLearningRecords();
    this.dispatch({ type: "closed" });
  }
}
