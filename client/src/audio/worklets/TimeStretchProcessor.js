/**
 * TimeStretchProcessor – WSOLA AudioWorklet
 *
 * Pitch-erhaltendes Time-Stretch via OLA (Overlap-Add).
 * Wird als AudioWorkletProcessor registriert und verarbeitet einen
 * vorgeladenen Stereo-Buffer mit einstellbarem Stretch-Faktor.
 *
 * Messages (port):
 *   in:
 *     - { type: "setBuffer", channels: Float32Array[] }  // 1 (mono→up) oder 2 channels
 *     - { type: "setLoop",   loop: boolean }
 *     - { type: "seek",      samplePos: number }
 *   out:
 *     - { type: "position",  samplePos: number }         // ca. alle ~50ms
 *
 * Output: stereo (outputChannelCount: [2] empfohlen).
 *   - 1-Channel-Input → identisch auf L+R kopiert (Mono-Upmix)
 *   - 2-Channel-Input → unabhängige OLA pro Channel mit GLEICHEM _readPos
 *     (kanal-synchron für saubere Stereo-Imaging)
 *
 * Loop-Flag:
 *   - true (default): _readPos %= length (endlos)
 *   - false: bei Erreichen von length → silence (output fill 0)
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
    /** @type {Float32Array[] | null} */
    this._channels = null;
    this._numChannels = 0;
    this._length = 0;
    this._readPos = 0;
    /** Pro-Channel Output-Akkumulator (für unabhängige OLA pro Kanal). */
    /** @type {Float32Array[]} */
    this._outAccums = [new Float32Array(this._GRAIN * 4), new Float32Array(this._GRAIN * 4)];
    this._outPos = 0;
    this._window = this._makeHann(this._GRAIN);
    this._loop = true;
    this._ended = false;

    // Position-Reporting throttle: ca. alle ~50ms (≈ 2200 samples bei 44.1kHz).
    this._posReportInterval = 2200;
    this._posReportCounter = 0;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg || typeof msg !== "object") return;
      switch (msg.type) {
        case "setBuffer": {
          const ch = msg.channels;
          if (!Array.isArray(ch) || ch.length === 0) {
            this._channels = null;
            this._length = 0;
            this._numChannels = 0;
            return;
          }
          this._channels = ch;
          this._numChannels = ch.length;
          this._length = ch[0]?.length ?? 0;
          this._readPos = 0;
          this._outPos = 0;
          this._outAccums[0].fill(0);
          this._outAccums[1].fill(0);
          this._ended = false;
          this._posReportCounter = 0;
          break;
        }
        case "setLoop": {
          this._loop = !!msg.loop;
          // Wenn Loop wieder eingeschaltet wird, _ended reset.
          if (this._loop) this._ended = false;
          break;
        }
        case "seek": {
          const p = Number(msg.samplePos) || 0;
          this._readPos = Math.max(0, p);
          if (this._length > 0 && this._readPos >= this._length) {
            this._readPos = this._loop ? this._readPos % this._length : this._length;
          }
          this._outPos = 0;
          this._outAccums[0].fill(0);
          this._outAccums[1].fill(0);
          this._ended = this._loop ? false : this._readPos >= this._length;
          break;
        }
        default:
          break;
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
    const out = outputs[0];
    if (!out || out.length === 0) return true;

    const outL = out[0];
    const outR = out[1] ?? null;
    const outLen = outL.length;

    // Kein Buffer geladen oder bereits am Ende (loop=false) → silence.
    if (!this._channels || this._length === 0 || this._ended) {
      outL.fill(0);
      if (outR) outR.fill(0);
      return true;
    }

    const stretch = parameters.stretch[0] ?? 1.0;
    const hopIn = Math.max(1, Math.round(this._HOP_OUT * stretch));
    const useStereo = this._numChannels >= 2 && outR !== null;
    const srcL = this._channels[0];
    const srcR = useStereo ? this._channels[1] : srcL;

    for (let i = 0; i < outLen; i++) {
      if ((this._outPos + i) % this._HOP_OUT === 0) {
        const startIn = Math.round(this._readPos);
        // Wenn !loop und wir bereits jenseits length sind → keine neuen Grains mehr.
        if (!this._loop && startIn >= this._length) {
          this._ended = true;
        } else {
          for (let j = 0; j < this._GRAIN; j++) {
            const srcIdx = startIn + j;
            let sampleL = 0;
            let sampleR = 0;
            if (srcIdx < this._length) {
              sampleL = srcL[srcIdx];
              sampleR = useStereo ? srcR[srcIdx] : sampleL;
            } else if (this._loop) {
              // Loop: wrap-around index für lückenfreie Grain-Lesung.
              const wrapped = srcIdx % this._length;
              sampleL = srcL[wrapped];
              sampleR = useStereo ? srcR[wrapped] : sampleL;
            } else {
              sampleL = 0;
              sampleR = 0;
            }
            const win = this._window[j];
            const accumIdx = (this._outPos + i + j) % this._outAccums[0].length;
            this._outAccums[0][accumIdx] += sampleL * win;
            this._outAccums[1][accumIdx] += sampleR * win;
          }
          this._readPos += hopIn;
          if (this._readPos >= this._length) {
            if (this._loop) {
              this._readPos %= this._length;
            } else {
              // Letzter Grain wurde noch geschrieben; _ended setzen wir wenn
              // der Akkumulator gespielt ist (in der nächsten Iteration via
              // startIn >= length).
              this._readPos = this._length;
            }
          }
        }
      }
      const accumIdx = (this._outPos + i) % this._outAccums[0].length;
      outL[i] = this._outAccums[0][accumIdx];
      this._outAccums[0][accumIdx] = 0;
      if (outR) {
        outR[i] = this._outAccums[1][accumIdx];
      }
      this._outAccums[1][accumIdx] = 0;
    }
    this._outPos += outLen;

    // Position-Report (~50ms throttle).
    this._posReportCounter += outLen;
    if (this._posReportCounter >= this._posReportInterval) {
      this._posReportCounter = 0;
      try {
        this.port.postMessage({ type: "position", samplePos: this._readPos });
      } catch (_e) {
        // ignore
      }
    }
    return true;
  }
}

registerProcessor("time-stretch-processor", TimeStretchProcessor);
