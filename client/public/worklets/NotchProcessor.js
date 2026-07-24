/**
 * NotchProcessor — v3.44.0 Built-In Plugin
 *
 * Single Notch-Filter (Biquad-form) per Sample. Klassische Implementation
 * direkter Form 1 (DF1). Coefficient-Update einmal pro Block (k-rate
 * automation) damit der Filter stabil bleibt.
 *
 * Math (RBJ Audio EQ Cookbook, notch):
 *   w0 = 2π * freq / sampleRate
 *   alpha = sin(w0) / (2 * Q)
 *   b0 = 1, b1 = -2cos(w0), b2 = 1
 *   a0 = 1+alpha, a1 = -2cos(w0), a2 = 1-alpha
 *
 * Params:
 *   frequency  50..12000 Hz
 *   q          0.5..30
 *   mix        0..1
 */
class NotchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "frequency", defaultValue: 1000, minValue: 50,  maxValue: 12000, automationRate: "k-rate" },
      { name: "q",         defaultValue: 10,   minValue: 0.5, maxValue: 30,    automationRate: "k-rate" },
      { name: "mix",       defaultValue: 1,    minValue: 0,   maxValue: 1,     automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    // Per-channel state (max 2 channels stereo)
    this._x1 = [0, 0];
    this._x2 = [0, 0];
    this._y1 = [0, 0];
    this._y2 = [0, 0];
  }

  process(inputs, outputs, parameters) {
    const input  = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    const freq = parameters.frequency[0];
    const q    = parameters.q[0];
    const mix  = parameters.mix[0];

    const w0 = (2 * Math.PI * freq) / sampleRate;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = sinW0 / (2 * Math.max(0.0001, q));

    const a0 = 1 + alpha;
    const a1 = -2 * cosW0;
    const a2 = 1 - alpha;
    const b0 = 1;
    const b1 = -2 * cosW0;
    const b2 = 1;

    // Normalize
    const a1n = a1 / a0;
    const a2n = a2 / a0;
    const b0n = b0 / a0;
    const b1n = b1 / a0;
    const b2n = b2 / a0;

    for (let ch = 0; ch < output.length; ch++) {
      const inp = input[ch] || input[0];
      const out = output[ch];
      let x1 = this._x1[ch] || 0;
      let x2 = this._x2[ch] || 0;
      let y1 = this._y1[ch] || 0;
      let y2 = this._y2[ch] || 0;

      for (let i = 0; i < out.length; i++) {
        const x0 = inp[i];
        const y0 = b0n * x0 + b1n * x1 + b2n * x2 - a1n * y1 - a2n * y2;
        out[i] = x0 * (1 - mix) + y0 * mix;
        x2 = x1;
        x1 = x0;
        y2 = y1;
        y1 = y0;
      }

      this._x1[ch] = x1;
      this._x2[ch] = x2;
      this._y1[ch] = y1;
      this._y2[ch] = y2;
    }
    return true;
  }
}

registerProcessor("notch-processor", NotchProcessor);
