// Runs on the audio thread. Collects raw stereo samples and posts them in batches
// so the offscreen page can write them into a WAV file.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 8192;
    this.left = new Float32Array(this.size);
    this.right = new Float32Array(this.size);
    this.fill = 0;
    this.port.onmessage = (e) => { if (e.data === 'flush') this.flush(); };
  }
  flush() {
    if (!this.fill) return;
    this.port.postMessage({ left: this.left.slice(0, this.fill), right: this.right.slice(0, this.fill) });
    this.fill = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (input && input.length) {
      const l = input[0];
      const r = input[1] || input[0];
      for (let i = 0; i < l.length; i++) {
        this.left[this.fill] = l[i];
        this.right[this.fill] = r[i];
        if (++this.fill === this.size) this.flush();
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
