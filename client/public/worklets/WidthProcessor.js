/**
 * WidthProcessor — v3.44.0 Built-In Plugin
 *
 * Stereo-Width via Mid/Side-Encoding:
 *   M = (L + R) / 2
 *   S = (L - R) / 2
 *   L_out = M + S * width
 *   R_out = M - S * width
 *
 *   width = 0  → mono (S annulliert)
 *   width = 1  → original Stereo
 *   width > 1  → exaggerated Stereo (S boosted)
 *
 * Mono-Input wird passthrough (kein S-Anteil).
 *
 * Params:
 *   width  0..2
 */
class WidthProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "width", defaultValue: 1, minValue: 0, maxValue: 2, automationRate: "k-rate" },
    ];
  }

  process(inputs, outputs, parameters) {
    const input  = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    const width = parameters.width[0];

    // Stereo branch: 2 input channels available
    if (input.length >= 2 && input[1] && output.length >= 2) {
      const l = input[0];
      const r = input[1];
      const outL = output[0];
      const outR = output[1];
      for (let i = 0; i < outL.length; i++) {
        const m = (l[i] + r[i]) * 0.5;
        const s = (l[i] - r[i]) * 0.5 * width;
        outL[i] = m + s;
        outR[i] = m - s;
      }
      return true;
    }

    // Mono branch: passthrough to all output channels
    for (let ch = 0; ch < output.length; ch++) {
      const inp = input[ch] || input[0];
      const out = output[ch];
      for (let i = 0; i < out.length; i++) {
        out[i] = inp[i];
      }
    }
    return true;
  }
}

registerProcessor("width-processor", WidthProcessor);
