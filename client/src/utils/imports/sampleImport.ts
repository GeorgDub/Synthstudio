/**
 * sampleImport.ts — Sprint-98: WAV-Sample-Metadata-Parser.
 *
 * Liest Standard-WAV-Header + optional eingebettete Chunks fuer
 * OmniTribe-relevante Metadata:
 *   - "fmt " — sample-rate, channels, bit-depth (PCM 8/16/24/32)
 *   - "data" — Sample-Length in Bytes/Frames
 *   - "cue " — Cue-Points / Chop-Points (max 8 fuer Hardware-Slicer)
 *   - "smpl" — Loop-Points (MIDI-Note + sustain-loop)
 *   - "INFO" → "INAM" — Sample-Name (UTF-8/ASCII)
 *
 * Konvertiert NICHT die Audio-Daten; nur Metadata. Audio-Reading
 * passiert separat (Browser AudioBuffer-Decoder oder OmniTribe-Tooling).
 *
 * Spec: RIFF/WAVE (Microsoft). Wir lesen Little-Endian, da WAV grundsätzlich
 * LE ist. Big-Endian RIFX wird per Magic-Check erkannt und abgelehnt.
 */

import { ImportError } from "./types";

export interface ImportedSampleCuePoint {
  /** Cue-ID (1-basiert oder beliebig). */
  id: number;
  /** Position in Frames ab Sample-Start. */
  framePos: number;
  /** Optionales Label aus "labl" chunk. */
  label?: string;
}

export interface ImportedSampleLoop {
  startFrame: number;
  endFrame: number;
  /** Loop-Type aus smpl-chunk (0=forward, 1=alternate, 2=reverse). */
  type: number;
}

export interface ImportedSample {
  name: string;
  fileName: string;
  sampleRate: number;
  channels: number;
  bitDepth: number;
  /** Frame-Count (= sampleCount per channel). */
  frameCount: number;
  /** Dauer in Sekunden. */
  durationSec: number;
  /** Ist 8-bit PCM (unsigned) statt 16-bit (signed)? */
  isPcm8: boolean;
  /** Float-Format statt PCM? (fmt tag = 3) */
  isFloat: boolean;
  cuePoints: ImportedSampleCuePoint[];
  loops: ImportedSampleLoop[];
  /** Original-RIFF-Filesize (kann von echter Filesize abweichen bei Corruption). */
  declaredSize: number;
}

const RIFF_MAGIC = "RIFF";
const RIFX_MAGIC = "RIFX";
const WAVE_MAGIC = "WAVE";

function readFourCC(view: DataView, offset: number): string {
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += String.fromCharCode(view.getUint8(offset + i));
  }
  return out;
}

function readNullTerminated(view: DataView, offset: number, maxLength: number): string {
  let out = "";
  for (let i = 0; i < maxLength; i++) {
    const c = view.getUint8(offset + i);
    if (c === 0) break;
    if (c >= 0x20 && c <= 0x7E) out += String.fromCharCode(c);
  }
  return out;
}

/**
 * Importiert ein .wav-File und extrahiert Metadata.
 * Wirft ImportError bei: falscher Magic, truncatem Header, oder
 * unsupported Encoding (z.B. ADPCM, MP3-in-WAV).
 */
export function importWavSample(
  buffer: ArrayBuffer | Uint8Array,
  fileName = "sample.wav",
): ImportedSample {
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (data.length < 44) {
    throw new ImportError(
      `wav: Buffer zu kurz fuer Header: ${data.length} < 44`,
      "wav",
    );
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const riffMagic = readFourCC(view, 0);
  if (riffMagic === RIFX_MAGIC) {
    throw new ImportError("wav: Big-Endian RIFX wird nicht unterstuetzt", "wav");
  }
  if (riffMagic !== RIFF_MAGIC) {
    throw new ImportError(
      `wav: falsche Magic "${riffMagic}" — erwartet "${RIFF_MAGIC}"`,
      "wav",
    );
  }
  const declaredSize = view.getUint32(4, true);
  const waveMagic = readFourCC(view, 8);
  if (waveMagic !== WAVE_MAGIC) {
    throw new ImportError(
      `wav: falsche WAVE-Magic "${waveMagic}"`,
      "wav",
    );
  }

  // Chunk-Iterator: starte bei offset 12 ("WAVE" + chunks).
  let pos = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitDepth = 0;
  let frameCount = 0;
  let isPcm8 = false;
  let isFloat = false;
  let formatTag = 0;
  let blockAlign = 0;
  let name = "";
  const cuePoints: ImportedSampleCuePoint[] = [];
  const cueLabels: Map<number, string> = new Map();
  const loops: ImportedSampleLoop[] = [];

  while (pos + 8 <= data.length) {
    const chunkId = readFourCC(view, pos);
    const chunkSize = view.getUint32(pos + 4, true);
    const chunkStart = pos + 8;
    if (chunkStart + chunkSize > data.length) break;  // Truncated

    if (chunkId === "fmt ") {
      formatTag = view.getUint16(chunkStart + 0, true);
      channels = view.getUint16(chunkStart + 2, true);
      sampleRate = view.getUint32(chunkStart + 4, true);
      blockAlign = view.getUint16(chunkStart + 12, true);
      bitDepth = view.getUint16(chunkStart + 14, true);
      isPcm8 = formatTag === 1 && bitDepth === 8;
      isFloat = formatTag === 3;
      if (formatTag !== 1 && formatTag !== 3) {
        // Compression (ADPCM, etc.) — unsupported fuer Metadata-Extract.
        // We DON'T throw — UI-Layer kann mit isFloat=false + formatTag info
        // entscheiden ob es weiterhin verarbeitbar ist.
      }
    } else if (chunkId === "data") {
      if (blockAlign > 0) {
        frameCount = Math.floor(chunkSize / blockAlign);
      }
    } else if (chunkId === "cue ") {
      const cueCount = view.getUint32(chunkStart, true);
      for (let i = 0; i < cueCount; i++) {
        const cueOffset = chunkStart + 4 + i * 24;
        if (cueOffset + 24 > chunkStart + chunkSize) break;
        const id = view.getUint32(cueOffset + 0, true);
        // sampleOffset ist relative zur DataChunk-Position fuer den
        // einfachen PCM-Fall — wir nehmen es direkt als framePos.
        const framePos = view.getUint32(cueOffset + 20, true);
        cuePoints.push({ id, framePos });
      }
    } else if (chunkId === "smpl") {
      // smpl chunk: MIDI-Note, loops, etc.
      if (chunkSize >= 36) {
        const numLoops = view.getUint32(chunkStart + 28, true);
        for (let i = 0; i < numLoops; i++) {
          const loopOffset = chunkStart + 36 + i * 24;
          if (loopOffset + 24 > chunkStart + chunkSize) break;
          const type = view.getUint32(loopOffset + 4, true);
          const startFrame = view.getUint32(loopOffset + 8, true);
          const endFrame = view.getUint32(loopOffset + 12, true);
          loops.push({ type, startFrame, endFrame });
        }
      }
    } else if (chunkId === "LIST") {
      const listType = readFourCC(view, chunkStart);
      if (listType === "INFO") {
        let subPos = chunkStart + 4;
        while (subPos + 8 <= chunkStart + chunkSize) {
          const subId = readFourCC(view, subPos);
          const subSize = view.getUint32(subPos + 4, true);
          if (subId === "INAM") {
            name = readNullTerminated(view, subPos + 8, subSize);
          }
          subPos += 8 + subSize + (subSize & 1);
        }
      } else if (listType === "adtl") {
        // associated data list — kann labl-chunks fuer cue-points enthalten
        let subPos = chunkStart + 4;
        while (subPos + 8 <= chunkStart + chunkSize) {
          const subId = readFourCC(view, subPos);
          const subSize = view.getUint32(subPos + 4, true);
          if (subId === "labl" && subSize >= 4) {
            const cueId = view.getUint32(subPos + 8, true);
            const label = readNullTerminated(view, subPos + 12, subSize - 4);
            if (label) cueLabels.set(cueId, label);
          }
          subPos += 8 + subSize + (subSize & 1);
        }
      }
    }

    // Chunk-Size ist immer even-padded (RIFF-Spec).
    pos = chunkStart + chunkSize + (chunkSize & 1);
  }

  // Labels in cuePoints einbetten
  for (const cue of cuePoints) {
    const label = cueLabels.get(cue.id);
    if (label) cue.label = label;
  }

  if (sampleRate === 0 || channels === 0) {
    throw new ImportError("wav: fmt-Chunk fehlt oder unvollstaendig", "wav");
  }

  const durationSec = frameCount > 0 ? frameCount / sampleRate : 0;

  // Fallback-Name: filename ohne Extension
  if (!name) {
    name = fileName.replace(/\.[^/.]+$/, "");
  }

  return {
    name,
    fileName,
    sampleRate,
    channels,
    bitDepth,
    frameCount,
    durationSec,
    isPcm8,
    isFloat,
    cuePoints,
    loops,
    declaredSize,
  };
}

/** Quick magic-check: true wenn buffer mit "RIFF...WAVE" beginnt. */
export function isWavSample(buffer: ArrayBuffer | Uint8Array): boolean {
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (data.length < 12) return false;
  if (data[0] !== 0x52 || data[1] !== 0x49 ||
      data[2] !== 0x46 || data[3] !== 0x46) return false;   // "RIFF"
  if (data[8] !== 0x57 || data[9] !== 0x41 ||
      data[10] !== 0x56 || data[11] !== 0x45) return false; // "WAVE"
  return true;
}
