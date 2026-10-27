/** Volatile microphone and playback buffers. No MediaRecorder, files, storage or logging. */
export class BrowserAudio {
  private context?: AudioContext;
  private stream?: MediaStream;
  private microphone?: MediaStreamAudioSourceNode;
  private capture?: AudioWorkletNode;
  private silent?: GainNode;
  private sources = new Set<AudioBufferSourceNode>();
  private nextPlaybackTimeSeconds = 0;
  private disposed = false;
  private generation = 0;
  private waiters: (() => void)[] = [];
  async open(send: (pcm: Uint8Array, sampleRateHz: number) => void) {
    this.context = new AudioContext();
    await this.context.resume();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
    if (this.disposed) { stream.getTracks().forEach(track => track.stop()); return; }
    this.stream = stream;
    await this.context.audioWorklet.addModule("/voice-capture.js");
    if (this.disposed) return;
    const context = this.context;
    this.capture = new AudioWorkletNode(context, "talkie-capture");
    this.capture.port.onmessage = event => {
      if (!this.disposed) send(new Uint8Array(event.data), context.sampleRate);
    };
    this.microphone = context.createMediaStreamSource(stream);
    this.silent = context.createGain(); this.silent.gain.value = 0;
    this.microphone.connect(this.capture).connect(this.silent).connect(context.destination);
  }
  play(pcm: Uint8Array, sampleRateHz: number) {
    const context = this.context;
    if (!context || this.disposed) return;
    // Bound queued audio; never keep an entire stalled response in memory.
    if (this.nextPlaybackTimeSeconds - context.currentTime > 15) throw new Error("VOICE_PLAYBACK_BACKLOG");
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const buffer = context.createBuffer(1, pcm.length / 2, sampleRateHz);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
    this.sources.add(source);
    source.onended = () => {
      source.disconnect(); source.buffer = null; this.sources.delete(source);
      if (!this.sources.size) this.finishWaiting();
    };
    const start = Math.max(context.currentTime, this.nextPlaybackTimeSeconds);
    source.start(start); this.nextPlaybackTimeSeconds = start + buffer.duration;
  }
  async drained(): Promise<boolean> {
    const generation = this.generation;
    if (this.sources.size) await new Promise<void>(resolve => this.waiters.push(resolve));
    return generation === this.generation && !this.disposed && this.context?.state === "running";
  }
  interrupt() {
    this.generation++;
    for (const source of this.sources) { source.onended = null; source.stop(); source.disconnect(); source.buffer = null; }
    this.sources.clear(); this.nextPlaybackTimeSeconds = 0; this.finishWaiting();
  }
  private finishWaiting() { for (const resolve of this.waiters.splice(0)) resolve(); }
  close() {
    if (this.disposed) return;
    this.disposed = true; this.interrupt();
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = undefined;
    if (this.capture) { this.capture.port.onmessage = null; this.capture.port.close(); this.capture.disconnect(); }
    this.microphone?.disconnect(); this.silent?.disconnect();
    if (this.context) void this.context.close().catch(() => {});
  }
}
