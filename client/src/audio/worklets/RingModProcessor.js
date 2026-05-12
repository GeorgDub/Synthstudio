/**
 * RingModProcessor – AudioWorklet für Ring-Modulation.
 * Multipliziert das Eingangssignal mit einem Sinuston (frequency).
 * Parameter:
 *   frequency   20–5000 Hz
 *   mix         0–1 (Dry/Wet)
 */
class RingModProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "frequency", defaultValue: 200, minValue: 20,  maxValue: 5000, automationRate: "a-rate" },
      { name: "mix",       defaultValue: 0.5, minValue: 0,   maxValue: 1,    automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this._phase = 0;
  }

  process(inputs, outputs, parameters) {
    const input  = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    const mix  = parameters.mix[0];
    const freqs = parameters.frequency;
    const TWO_PI = 2 * Math.PI;

    for (let ch = 0; ch < output.length; ch++) {
      const inp = input[ch] || input[0];
      const out = output[ch];
      let phase = this._phase;

      for (let i = 0; i < out.length; i++) {
        const freq = freqs.length > 1 ? freqs[i] : freqs[0];
        const carrier = Math.sin(phase);
        phase += TWO_PI * freq / sampleRate;
        if (phase > TWO_PI) phase -= TWO_PI;
        out[i] = inp[i] * (1 - mix) + (inp[i] * carrier) * mix;
      }

      if (ch === 0) this._phase = phase;
    }
    return true;
  }
}

registerProcessor("ringmod-processor", RingModProcessor);
