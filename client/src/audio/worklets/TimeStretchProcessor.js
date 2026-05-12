/**
 * TimeStretchProcessor – WSOLA AudioWorklet
 *
 * Pitch-erhaltendes Time-Stretch via OLA (Overlap-Add).
 * Wird als AudioWorkletProcessor registriert und verarbeitet einen
 * vorgeladenen Buffer mit einstellbarem Stretch-Faktor.
 */
class TimeStretchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "stretch", defaultValue: 1.0, minValue: 0.25, maxValue: 4.0, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this._GRAIN = 2048;
    this._HOP_OUT = 512;
    this._buffer = null;
    this._readPos = 0;
    this._outAccum = new Float32Array(this._GRAIN * 4);
    this._outPos = 0;
    this._window = this._makeHann(this._GRAIN);

    this.port.onmessage = (e) => {
      if (e.data.type === "setBuffer") {
        this._buffer = e.data.buffer;
        this._readPos = 0;
        this._outPos = 0;
        this._outAccum.fill(0);
      }
    };
  }

  _makeHann(size) {
    const w = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    return w;
  }

  process(_inputs, outputs, parameters) {
    if (!this._buffer) return true;
    const output = outputs[0]?.[0];
    if (!output) return true;

    const stretch = parameters.stretch[0] ?? 1.0;
    const hopIn = Math.max(1, Math.round(this._HOP_OUT * stretch));

    for (let i = 0; i < output.length; i++) {
      if ((this._outPos + i) % this._HOP_OUT === 0) {
        const startIn = Math.round(this._readPos);
        for (let j = 0; j < this._GRAIN; j++) {
          const srcIdx = startIn + j;
          const sample = srcIdx < this._buffer.length ? this._buffer[srcIdx] : 0;
          const accumIdx = (this._outPos + i + j) % this._outAccum.length;
          this._outAccum[accumIdx] += sample * this._window[j];
        }
        this._readPos += hopIn;
        if (this._readPos >= this._buffer.length) {
          this._readPos %= this._buffer.length;
        }
      }
      const accumIdx = (this._outPos + i) % this._outAccum.length;
      output[i] = this._outAccum[accumIdx];
      this._outAccum[accumIdx] = 0;
    }
    this._outPos += output.length;
    return true;
  }
}

registerProcessor("time-stretch-processor", TimeStretchProcessor);
