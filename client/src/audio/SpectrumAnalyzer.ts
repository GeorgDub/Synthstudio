/**
 * SpectrumAnalyzer – wraps a Web Audio AnalyserNode and provides
 * calibrated FFT magnitude data and frequency-band summaries.
 */

export interface SpectrumFrame {
  /** Raw FFT magnitude values (dB), length = fftSize / 2 */
  magnitudes: Float32Array;
  /** Capture timestamp (performance.now()) */
  timestamp: number;
  /** Frequency resolution per bin in Hz (sampleRate / fftSize) */
  binHz: number;
}

export interface FrequencyBand {
  name: string;
  minHz: number;
  maxHz: number;
  /** Average magnitude in band (dB) */
  magnitude: number;
  /** Peak magnitude in band (dB) */
  peak: number;
}

const STANDARD_BANDS: Readonly<{ name: string; minHz: number; maxHz: number }[]> = [
  { name: "sub",     minHz:    20, maxHz:    80 },
  { name: "bass",    minHz:    80, maxHz:   300 },
  { name: "low-mid", minHz:   300, maxHz:   800 },
  { name: "mid",     minHz:   800, maxHz:  3000 },
  { name: "hi-mid",  minHz:  3000, maxHz:  8000 },
  { name: "high",    minHz:  8000, maxHz: 20000 },
];

export class SpectrumAnalyzer {
  private readonly ctx: AudioContext;
  private readonly analyser: AnalyserNode;
  private readonly buffer: Float32Array;
  private connected = false;

  constructor(ctx: AudioContext, fftSize = 2048) {
    this.ctx = ctx;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = fftSize;
    this.analyser.smoothingTimeConstant = 0.85;
    this.buffer = new Float32Array(this.analyser.frequencyBinCount);
  }

  /** Connect an AudioNode as the analysis source. */
  connect(source: AudioNode): void {
    source.connect(this.analyser);
    this.connected = true;
  }

  /** Return the current FFT frame. */
  getFrame(): SpectrumFrame {
    this.analyser.getFloatFrequencyData(this.buffer);
    return {
      magnitudes: this.buffer.slice(0),
      timestamp: performance.now(),
      binHz: this.ctx.sampleRate / this.analyser.fftSize,
    };
  }

  /**
   * Return the average and peak magnitude for a frequency range.
   * Returns -Infinity if no bins fall within the range.
   */
  getBandMagnitude(minHz: number, maxHz: number): number {
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    const startBin = Math.max(0, Math.floor(minHz / binHz));
    const endBin = Math.min(
      this.analyser.frequencyBinCount - 1,
      Math.ceil(maxHz / binHz),
    );
    if (startBin > endBin) return -Infinity;

    this.analyser.getFloatFrequencyData(this.buffer);
    let sum = 0;
    for (let i = startBin; i <= endBin; i++) {
      sum += this.buffer[i];
    }
    return sum / (endBin - startBin + 1);
  }

  /** Return all standard frequency bands with magnitude and peak. */
  getBands(): FrequencyBand[] {
    this.analyser.getFloatFrequencyData(this.buffer);
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;

    return STANDARD_BANDS.map((band) => {
      const startBin = Math.max(0, Math.floor(band.minHz / binHz));
      const endBin = Math.min(
        this.analyser.frequencyBinCount - 1,
        Math.ceil(band.maxHz / binHz),
      );

      if (startBin > endBin) {
        return { ...band, magnitude: -Infinity, peak: -Infinity };
      }

      let sum = 0;
      let peak = -Infinity;
      for (let i = startBin; i <= endBin; i++) {
        const v = this.buffer[i];
        sum += v;
        if (v > peak) peak = v;
      }
      return {
        ...band,
        magnitude: sum / (endBin - startBin + 1),
        peak,
      };
    });
  }

  /** Disconnect the analyser and release resources. */
  disconnect(): void {
    if (this.connected) {
      this.analyser.disconnect();
      this.connected = false;
    }
  }
}
