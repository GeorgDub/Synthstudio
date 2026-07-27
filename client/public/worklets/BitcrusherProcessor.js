/**
 * BitcrusherProcessor – AudioWorklet für Bitcrusher / Redux-Effekt.
 * Parameter:
 *   bitDepth      0.5–16   (1=heavy crush, 16=no change)
 *   sampleReduct  1–50     (Sample-Rate-Reduction: 1=no reduction, 50=heavy decimation)
 *   mix           0–1      (Dry/Wet Mix)
 */
class BitcrusherProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "bitDepth",     defaultValue: 16,  minValue: 0.5,  maxValue: 16,   automationRate: "k-rate" },
      { name: "sampleReduct", defaultValue: 1,   minValue: 1,    maxValue: 50,   automationRate: "k-rate" },
      { name: "mix",          defaultValue: 1,   minValue: 0,    maxValue: 1,    automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this._holdSample = 0;
    this._sampleCounter = 0;
  }

  process(inputs, outputs, parameters) {
    const input  = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    const bitDepth    = parameters.bitDepth[0];
    const sampleReduct = Math.round(parameters.sampleReduct[0]);
    const mix         = parameters.mix[0];
    const steps       = Math.pow(2, bitDepth);

    for (let ch = 0; ch < output.length; ch++) {
      const inp = input[ch] || input[0];
      const out = output[ch];
      for (let i = 0; i < out.length; i++) {
        this._sampleCounter++;
        if (this._sampleCounter >= sampleReduct) {
          this._sampleCounter = 0;
          this._holdSample = Math.round(inp[i] * steps) / steps;
        }
        out[i] = inp[i] * (1 - mix) + this._holdSample * mix;
      }
    }
    return true;
  }
}

registerProcessor("bitcrusher-processor", BitcrusherProcessor);
