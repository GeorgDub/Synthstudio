/**
 * e2sWavChunks.ts — baut die optionalen RIFF-`smpl`- und `cue `-Chunks, die
 * Oe2sSLE beim WAV-Export einbettet (Loop- + Slice-Metadaten).
 *
 * SoT: Oe2sSLE `e2s_sample.write` (export_smpl / export_cue):
 *   - smpl: nur wenn LoopStart < End; samplePeriod = round(1e9/freq);
 *     ein Forward-Loop; loop.start/end in Frames.
 *   - cue : ein Cue-Punkt pro Slice; position = sampleOffset = slice.start (Frames).
 *
 * Rein (nur Byte-Bau) → in Node testbar. Alle Multi-Byte-Felder LITTLE-ENDIAN
 * (RIFF-Standard).
 */

/** Ein Cue-Punkt (aus einem E2S-Slice). `position` in Frames. */
export interface CuePoint {
  position: number;
}

const ASCII = (s: string) => s.split("").map(c => c.charCodeAt(0));

/**
 * Baut den kompletten `smpl`-Chunk (`'smpl' + size + body`) für genau einen
 * Forward-Loop [loopStartFrame, loopEndFrame]. samplePeriod = round(1e9/rate) ns.
 * Größe: 8 (Header) + 36 (Body) + 24 (1 Loop) = 68 Bytes.
 */
export function buildSmplChunk(
  sampleRate: number,
  loopStartFrame: number,
  loopEndFrame: number
): Uint8Array {
  const sr = sampleRate > 0 ? sampleRate : 44100;
  const samplePeriod = Math.round(1e9 / sr);
  const body = 36 + 24; // 1 loop
  const buf = new Uint8Array(8 + body);
  const dv = new DataView(buf.buffer);
  buf.set(ASCII("smpl"), 0);
  dv.setUint32(4, body, true);
  dv.setUint32(8, 0, true); // manufacturer
  dv.setUint32(12, 0, true); // product
  dv.setUint32(16, samplePeriod, true);
  dv.setUint32(20, 60, true); // MIDI unity note (C4)
  dv.setUint32(24, 0, true); // MIDI pitch fraction
  dv.setUint32(28, 0, true); // SMPTE format
  dv.setUint32(32, 0, true); // SMPTE offset
  dv.setUint32(36, 1, true); // num sample loops
  dv.setUint32(40, 0, true); // sampler data
  // Loop record @ 44 (24 bytes)
  dv.setUint32(44, 0, true); // cue point id
  dv.setUint32(48, 0, true); // type 0 = forward
  dv.setUint32(52, Math.max(0, Math.floor(loopStartFrame)), true);
  dv.setUint32(56, Math.max(0, Math.floor(loopEndFrame)), true);
  dv.setUint32(60, 0, true); // fraction
  dv.setUint32(64, 0, true); // play count (0 = infinite)
  return buf;
}

/**
 * Baut den kompletten `cue `-Chunk für N Cue-Punkte (aus den Slices).
 * Größe: 8 (Header) + 4 (numCues) + N*24 Bytes.
 */
export function buildCueChunk(cues: ReadonlyArray<CuePoint>): Uint8Array {
  const n = cues.length;
  const body = 4 + n * 24;
  const buf = new Uint8Array(8 + body);
  const dv = new DataView(buf.buffer);
  buf.set(ASCII("cue "), 0);
  dv.setUint32(4, body, true);
  dv.setUint32(8, n, true); // num cue points
  let off = 12;
  const dataId = ASCII("data");
  for (let i = 0; i < n; i++) {
    const pos = Math.max(0, Math.floor(cues[i].position));
    dv.setUint32(off + 0, i + 1, true); // id
    dv.setUint32(off + 4, pos, true); // position (frames)
    buf.set(dataId, off + 8); // data chunk id
    dv.setUint32(off + 12, 0, true); // chunk start
    dv.setUint32(off + 16, 0, true); // block start
    dv.setUint32(off + 20, pos, true); // sample offset (frames)
    off += 24;
  }
  return buf;
}

/**
 * Hängt fertige Extra-Chunks an eine Basis-WAV an und korrigiert die RIFF-Größe
 * (Bytes 4..7 = totalLen - 8). Rein; erwartet eine gültige `RIFF….WAVE`-Datei.
 */
export function appendWavChunks(
  baseWav: Uint8Array,
  chunks: ReadonlyArray<Uint8Array>
): Uint8Array {
  const extra = chunks.reduce((n, c) => n + c.length, 0);
  if (extra === 0) return baseWav;
  const out = new Uint8Array(baseWav.length + extra);
  out.set(baseWav, 0);
  let off = baseWav.length;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  // RIFF-Größe aktualisieren.
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  return out;
}
