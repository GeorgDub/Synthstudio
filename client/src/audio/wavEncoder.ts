/**
 * Synthstudio – wavEncoder.ts (TASK-234 / v2.86)
 *
 * Pure-Funktionen für die WAV-Kodierung aus Float32-PCM-Buffern.
 * KEIN Web-Audio-API-Import → trivial testbar in Node.js mit Vitest.
 *
 * Format: 16-bit PCM, interleaved bei Stereo, Little-Endian.
 * Header-Layout (44 Bytes vor den Daten):
 *
 *   RIFF<4>  chunkSize<4>   WAVE<4>
 *   fmt <4>  16<4>          PCM=1<2>  ch<2>  sr<4>  byteRate<4>  blockAlign<2>  bits<2>
 *   data<4>  dataSize<4>    <PCM-Daten…>
 *
 * Wird vom Renderer-Recording-Pfad (AudioRecorder.ts) genutzt und vom
 * Electron-IPC-Pfad `audio:save-recording` ohne Format-Conversion durchgereicht.
 *
 * Diese Funktion ist bewusst doppelt zu wav-writer.ts:
 *  - wav-writer.ts ist Node/fs-basiert (Disk-Schreib-Helfer, Electron-only).
 *  - wavEncoder.ts liefert einen ArrayBuffer in-memory (Browser-tauglich).
 */

// ─── Konstanten ──────────────────────────────────────────────────────────────

/** Anzahl Header-Bytes (RIFF+fmt+data-Chunk-Header, ohne LIST/INFO). */
export const WAV_HEADER_SIZE = 44;

/** Magic-Bytes für RIFF-Container. */
export const WAV_RIFF_MAGIC = "RIFF";
export const WAV_WAVE_MAGIC = "WAVE";
export const WAV_FMT_MAGIC = "fmt ";
export const WAV_DATA_MAGIC = "data";

// ─── Public API ──────────────────────────────────────────────────────────────

export interface WavEncodeOptions {
  /** Sample-Rate in Hz (z.B. 48000). MUSS > 0 sein. */
  sampleRate: number;
  /** Anzahl Kanäle (1=mono, 2=stereo). Default 1. */
  channels?: 1 | 2;
  /**
   * Bittiefe. 16 (default, DAW-Standard) oder 24 (v3.150 — höhere Dynamic
   * Range, ~50% mehr Dateigröße). Beides PCM, signed Little-Endian.
   */
  bitDepth?: 16 | 24;
}

/**
 * Kodiert ein einzelnes Float32Array als Mono-WAV.
 * Sample-Werte werden auf [-1, +1] geklemmt und auf Int16 quantisiert.
 *
 * @returns ArrayBuffer mit kompletter WAV-Datei (Header + PCM-Daten).
 * @throws Error bei sampleRate <= 0 oder leerem Input.
 */
export function encodeWavMono(
  samples: Float32Array,
  sampleRate: number,
  bitDepth: 16 | 24 = 16,
): ArrayBuffer {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`Invalid sampleRate: ${sampleRate}`);
  }
  return encodeWav([samples], { sampleRate, channels: 1, bitDepth });
}

/**
 * Kodiert zwei Float32Arrays als interleaved Stereo-WAV.
 * Die Längen müssen identisch sein, sonst wird auf das Minimum getrimmt.
 */
export function encodeWavStereo(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  bitDepth: 16 | 24 = 16,
): ArrayBuffer {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`Invalid sampleRate: ${sampleRate}`);
  }
  const len = Math.min(left.length, right.length);
  const l = left.length === len ? left : left.subarray(0, len);
  const r = right.length === len ? right : right.subarray(0, len);
  return encodeWav([l, r], { sampleRate, channels: 2, bitDepth });
}

/**
 * Generische Variante: nimmt ein Array von Kanal-Buffers entgegen
 * (1 oder 2 Einträge) und produziert die entsprechende WAV-Datei.
 */
export function encodeWav(
  channelData: Float32Array[],
  options: WavEncodeOptions,
): ArrayBuffer {
  const { sampleRate } = options;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`Invalid sampleRate: ${sampleRate}`);
  }
  const channels = options.channels ?? (channelData.length === 2 ? 2 : 1);
  if (channels !== 1 && channels !== 2) {
    throw new Error(`Unsupported channel count: ${channels}`);
  }
  if (channelData.length === 0 || !channelData[0]) {
    throw new Error("encodeWav requires at least one channel buffer");
  }
  const bitDepth = options.bitDepth ?? 16;
  if (bitDepth !== 16 && bitDepth !== 24) {
    throw new Error(`Unsupported bitDepth: ${bitDepth} (only 16 or 24 supported)`);
  }

  const length = channelData[0].length;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = length * blockAlign;
  const totalSize = WAV_HEADER_SIZE + dataSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  let offset = 0;

  // RIFF-Header
  writeAscii(view, offset, WAV_RIFF_MAGIC); offset += 4;
  view.setUint32(offset, totalSize - 8, true); offset += 4;
  writeAscii(view, offset, WAV_WAVE_MAGIC); offset += 4;

  // fmt-Chunk
  writeAscii(view, offset, WAV_FMT_MAGIC); offset += 4;
  view.setUint32(offset, 16, true); offset += 4;          // Chunk-Size
  view.setUint16(offset, 1, true); offset += 2;           // PCM
  view.setUint16(offset, channels, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, byteRate, true); offset += 4;
  view.setUint16(offset, blockAlign, true); offset += 2;
  view.setUint16(offset, bitDepth, true); offset += 2;

  // data-Chunk
  writeAscii(view, offset, WAV_DATA_MAGIC); offset += 4;
  view.setUint32(offset, dataSize, true); offset += 4;

  // PCM-Daten (Float32 → Int16/Int24, interleaved bei Stereo)
  if (bitDepth === 16) {
    if (channels === 1) {
      const ch0 = channelData[0];
      for (let i = 0; i < length; i++) {
        const s = Math.max(-1, Math.min(1, ch0[i]));
        view.setInt16(offset, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
        offset += 2;
      }
    } else {
      const ch0 = channelData[0];
      const ch1 = channelData[1] ?? channelData[0];
      for (let i = 0; i < length; i++) {
        const l = Math.max(-1, Math.min(1, ch0[i]));
        const r = Math.max(-1, Math.min(1, ch1[i]));
        view.setInt16(offset, l < 0 ? Math.round(l * 0x8000) : Math.round(l * 0x7fff), true);
        offset += 2;
        view.setInt16(offset, r < 0 ? Math.round(r * 0x8000) : Math.round(r * 0x7fff), true);
        offset += 2;
      }
    }
  } else {
    // 24-bit PCM: signed integer, 3 bytes per sample, little-endian.
    // Range: -8388608..8388607 (-0x800000..0x7fffff).
    if (channels === 1) {
      const ch0 = channelData[0];
      for (let i = 0; i < length; i++) {
        const s = Math.max(-1, Math.min(1, ch0[i]));
        offset = writeInt24LE(view, offset, s);
      }
    } else {
      const ch0 = channelData[0];
      const ch1 = channelData[1] ?? channelData[0];
      for (let i = 0; i < length; i++) {
        const l = Math.max(-1, Math.min(1, ch0[i]));
        const r = Math.max(-1, Math.min(1, ch1[i]));
        offset = writeInt24LE(view, offset, l);
        offset = writeInt24LE(view, offset, r);
      }
    }
  }

  return buffer;
}

/** Schreibt 24-bit signed PCM (3 bytes LE) für einen Float-Sample im Bereich [-1, +1]. */
function writeInt24LE(view: DataView, offset: number, sample: number): number {
  const n = sample < 0 ? Math.round(sample * 0x800000) : Math.round(sample * 0x7fffff);
  // n liegt im Bereich -0x800000..0x7fffff. Für Little-Endian-3-Byte-Write:
  // byte 0 = LSB, byte 1 = mid, byte 2 = MSB (sign-bit im obersten).
  const u = n & 0xffffff; // 24-bit two's complement (negative wird automatisch).
  view.setUint8(offset, u & 0xff);
  view.setUint8(offset + 1, (u >> 8) & 0xff);
  view.setUint8(offset + 2, (u >> 16) & 0xff);
  return offset + 3;
}

/**
 * Concateniert eine Liste von Float32-Chunks zu einem zusammenhängenden Buffer.
 * Wird vom AudioRecorder genutzt um ScriptProcessor-Chunks (typ. 4096 Samples)
 * am Stop-Zeitpunkt zu mergen.
 */
export function concatFloat32(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * Validiert dass ein gegebener Buffer einen plausiblen WAV-Header trägt.
 * Pure: liest nur die ersten 44 Bytes und prüft Magic-Strings + PCM-Format.
 */
export function isValidWavHeader(buf: ArrayBuffer): boolean {
  if (buf.byteLength < WAV_HEADER_SIZE) return false;
  const view = new DataView(buf);
  if (readAscii(view, 0, 4) !== WAV_RIFF_MAGIC) return false;
  if (readAscii(view, 8, 4) !== WAV_WAVE_MAGIC) return false;
  if (readAscii(view, 12, 4) !== WAV_FMT_MAGIC) return false;
  const fmtSize = view.getUint32(16, true);
  if (fmtSize !== 16) return false;
  const audioFormat = view.getUint16(20, true);
  if (audioFormat !== 1) return false; // nur PCM
  const ch = view.getUint16(22, true);
  if (ch !== 1 && ch !== 2) return false;
  const sr = view.getUint32(24, true);
  if (sr <= 0) return false;
  if (readAscii(view, 36, 4) !== WAV_DATA_MAGIC) return false;
  return true;
}

// ─── Private Helpers ─────────────────────────────────────────────────────────

function writeAscii(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function readAscii(view: DataView, offset: number, len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += String.fromCharCode(view.getUint8(offset + i));
  }
  return out;
}
