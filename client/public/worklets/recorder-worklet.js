/**
 * Synthstudio – recorder-worklet.js (v3.114.0)
 *
 * AudioWorkletProcessor "recorder-processor" — läuft im Audio-Rendering-Thread
 * (off main). Migration der bisher ScriptProcessorNode-basierten Recorder
 * (LiveRecorder v3.110, AudioInputRecorder v3.113) auf moderne AudioWorklet-API.
 *
 * Protokoll (port.onmessage):
 *   { cmd: 'start' }                  → beginnt Capture, leert Buffer
 *   { cmd: 'stop' }                   → flusht remaining + sendet 'done' Event
 *   { cmd: 'getBuffer' }              → sendet aktuelle Buffer ohne stop
 *   { cmd: 'setMaxFrames', value: n } → setzt Memory-Cap (default 600 * 48000)
 *
 * Outgoing messages:
 *   { type: 'chunks', left: Float32[], right: Float32[] | null, frameCount: n }
 *   { type: 'limit', frameCount: n }
 *   { type: 'done',  left: Float32, right: Float32 | null, frameCount: n, truncated: bool }
 *
 * Plain JS (kein TS-Compile) — direkt browser-readable via
 * audioContext.audioWorklet.addModule('/worklets/recorder-worklet.js').
 */

const DEFAULT_MAX_FRAMES = 600 * 48000; // ~10 min @ 48 kHz
const FLUSH_FRAMES = 4 * 128;            // ~85 ms @ 48k (= 4 chunks á 128 frames)

class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._running = false;
    this._truncated = false;
    this._maxFrames = DEFAULT_MAX_FRAMES;
    this._bufferLeft = [];
    this._bufferRight = [];
    this._frameCount = 0;
    this._pendingLeft = [];
    this._pendingRight = [];
    this._pendingFrames = 0;
    this._channels = 2;

    this.port.onmessage = (ev) => {
      const data = ev.data || {};
      switch (data.cmd) {
        case "start":
          this._reset();
          this._running = true;
          break;
        case "stop":
          this._running = false;
          this._flushPending();
          this._postDone();
          break;
        case "getBuffer":
          this._flushPending();
          this._postChunks();
          break;
        case "setMaxFrames":
          if (typeof data.value === "number" && data.value > 0 && isFinite(data.value)) {
            this._maxFrames = Math.floor(data.value);
          }
          break;
        default:
          // unknown — ignore (Forward-Compat)
          break;
      }
    };
  }

  _reset() {
    this._bufferLeft = [];
    this._bufferRight = [];
    this._pendingLeft = [];
    this._pendingRight = [];
    this._frameCount = 0;
    this._pendingFrames = 0;
    this._truncated = false;
  }

  _flushPending() {
    if (this._pendingFrames === 0) return;
    // Konkateniere pending zu einem chunk pro Channel, push in main buffer.
    const lChunk = this._concat(this._pendingLeft, this._pendingFrames);
    this._bufferLeft.push(lChunk);
    if (this._channels === 2) {
      const rChunk = this._concat(this._pendingRight, this._pendingFrames);
      this._bufferRight.push(rChunk);
    }
    this._postChunks(lChunk, this._channels === 2 ? this._bufferRight[this._bufferRight.length - 1] : null);
    this._pendingLeft = [];
    this._pendingRight = [];
    this._pendingFrames = 0;
  }

  _concat(chunks, total) {
    const out = new Float32Array(total);
    let off = 0;
    for (let i = 0; i < chunks.length; i++) {
      out.set(chunks[i], off);
      off += chunks[i].length;
    }
    return out;
  }

  _postChunks(lastL, lastR) {
    // Streaming-Variante: schicke nur den letzten Flush ans main thread —
    // main behält stets das ganze Buffer-Array via append.
    this.port.postMessage({
      type: "chunks",
      left: lastL || null,
      right: lastR || null,
      frameCount: this._frameCount,
    });
  }

  _postDone() {
    const left = this._concatAll(this._bufferLeft);
    const right = this._channels === 2 ? this._concatAll(this._bufferRight) : null;
    this.port.postMessage({
      type: "done",
      left,
      right,
      frameCount: this._frameCount,
      truncated: this._truncated,
    });
    // Reset interner Buffer damit nächste Session sauber startet.
    this._reset();
  }

  _concatAll(chunks) {
    let total = 0;
    for (let i = 0; i < chunks.length; i++) total += chunks[i].length;
    const out = new Float32Array(total);
    let off = 0;
    for (let i = 0; i < chunks.length; i++) {
      out.set(chunks[i], off);
      off += chunks[i].length;
    }
    return out;
  }

  process(inputs) {
    if (!this._running) return true;
    if (this._truncated) return true;
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    // Realtime-channelCount entscheidet ueber Mono/Stereo-Capture.
    const ch0 = input[0];
    if (!ch0 || ch0.length === 0) return true;
    const ch1 = input.length > 1 ? input[1] : null;
    if (ch1) this._channels = 2;
    else this._channels = 1;

    // Pflicht-Kopie: input-arrays werden vom audio-thread wiederverwendet.
    const lCopy = new Float32Array(ch0.length);
    lCopy.set(ch0);
    this._pendingLeft.push(lCopy);
    if (ch1) {
      const rCopy = new Float32Array(ch1.length);
      rCopy.set(ch1);
      this._pendingRight.push(rCopy);
    }
    this._pendingFrames += ch0.length;
    this._frameCount += ch0.length;

    // Memory-Cap-Check.
    if (this._frameCount > this._maxFrames && !this._truncated) {
      this._truncated = true;
      this._running = false;
      this._flushPending();
      this.port.postMessage({ type: "limit", frameCount: this._frameCount });
      this._postDone();
      return true;
    }

    // Periodisch flushen damit main-thread nicht ueber GB Memory haelt.
    if (this._pendingFrames >= FLUSH_FRAMES) {
      this._flushPending();
    }
    return true;
  }
}

registerProcessor("recorder-processor", RecorderProcessor);
