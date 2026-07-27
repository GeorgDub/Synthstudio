/**
 * TapeSatProcessor — v3.44.0 Built-In Plugin
 *
 * Simple Tape-Saturation via tanh-Curve. Drive boostet das Signal vor der
 * Sättigung, der Curve macht non-lineare Distortion analog zu analoger
 * Bandsättigung.
 *
 * Math: out = tanh(in * drive_boost) / tanh(drive_boost)
 *   - drive=0   → near-linear (drive_boost ≈ 1)
 *   - drive=1   → heavy saturation (drive_boost ≈ 11)
 *
 * Normalisierung via tanh(drive_boost) damit das Ausgangs-Level relativ
 * konstant bleibt — User regelt nur Charakter, nicht Lautstärke.
 *
 * Params:
 *   drive  0..1   (0=clean, 1=heavy)
 *   mix    0..1   (Dry/Wet)
 */
class TapeSatProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "drive", defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "mix",   defaultValue: 1,   minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ];
  }

  process(inputs, outputs, parameters) {
    const input  = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    const drive = parameters.drive[0];
    const mix   = parameters.mix[0];

    // Map drive 0..1 → boost 1..11 (linear)
    const boost = 1 + drive * 10;
    const normInv = 1 / Math.tanh(boost);

    for (let ch = 0; ch < output.length; ch++) {
      const inp = input[ch] || input[0];
      const out = output[ch];
      for (let i = 0; i < out.length; i++) {
        const wet = Math.tanh(inp[i] * boost) * normInv;
        out[i] = inp[i] * (1 - mix) + wet * mix;
      }
    }
    return true;
  }
}

registerProcessor("tape-sat-processor", TapeSatProcessor);
