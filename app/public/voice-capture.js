// Worklet batches mono PCM16 input (~40ms at 48kHz), retaining only the current batch.
class TalkieCapture extends AudioWorkletProcessor {
  constructor() { super(); this.samples = new Int16Array(2048); this.offset = 0; }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) for (const sample of channel) {
      const value = Math.max(-1, Math.min(1, sample));
      this.samples[this.offset++] = Math.round(value * (value < 0 ? 32768 : 32767));
      if (this.offset === this.samples.length) {
        const bytes = new ArrayBuffer(this.samples.length * 2), view = new DataView(bytes);
        for (let i = 0; i < this.samples.length; i++) view.setInt16(i * 2, this.samples[i], true);
        this.port.postMessage(bytes, [bytes]); this.samples.fill(0); this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("talkie-capture", TalkieCapture);
