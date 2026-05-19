/**
 * Synthstudio – audioCompressEncoder.ts (v3.83.0)
 *
 * Compressed Audio-Export via WebCodecs `AudioEncoder` (Opus in OGG-Container)
 * mit transparenter Fallback-Logik:
 *
 *   1. WebCodecs verfügbar + Opus-Codec supported (Chrome/Edge ≥94, Electron ≥17):
 *      → Opus-Encoding, native, blazing-fast, ~10× kleiner als WAV bei 192 kbps.
 *   2. WebCodecs NICHT verfügbar (Firefox < ~131, Safari < 17):
 *      → automatischer Fallback auf WAV (verlustfrei, kein extra Decoder nötig).
 *
 * Die Funktion ist Pure-DOM-free testbar — wir injizieren AudioEncoder via
 * dependency injection (createEncoderImpl) und mocken in den Tests. Die Default-
 * Implementierung greift auf `globalThis.AudioEncoder` zu.
 *
 * Wichtig:
 *  - WebCodecs liefert "raw" Opus-EncodedAudioChunks (kein Container).
 *    Wir verpacken sie in einen minimal-validen OGG-Container (Ogg-Page-Pakete
 *    nach https://datatracker.ietf.org/doc/html/rfc3533 + Opus-Header nach
 *    https://datatracker.ietf.org/doc/html/rfc7845). Für die meisten DAWs +
 *    Player (Foobar, VLC, Audacity, ffmpeg, Reaper) ist das ausreichend.
 *  - Browser-fallback `MediaRecorder` ist NICHT vorgesehen weil er offline-
 *    Render-Buffers (OfflineAudioContext-Output) nicht entgegennimmt.
 *
 * Exported API:
 *  - encodeAsOgg(audioBuffer, opts?) → Promise<Blob>  (audio/ogg | audio/wav fallback)
 *  - encodeCompressed(audioBuffer, opts?) → Promise<{ blob, format, bitrate }>
 *  - isWebCodecsOpusSupported() → Promise<boolean>
 *  - DEFAULT_OGG_BITRATE_BPS = 192_000
 *  - SUPPORTED_OGG_BITRATES_BPS = [96k, 128k, 192k, 256k, 320k]
 *
 * Tests siehe tests/features/audio-compress-encoder.test.ts.
 */

// ─── Konstanten ──────────────────────────────────────────────────────────────

/** Default-Bitrate (Opus 192 kbps — transparent für Mixed-Music laut Hydrogenaudio). */
export const DEFAULT_OGG_BITRATE_BPS = 192_000;

/** Empfohlene Bitrate-Auswahl im UI-Slider. */
export const SUPPORTED_OGG_BITRATES_BPS: readonly number[] = [
  96_000,
  128_000,
  192_000,
  256_000,
  320_000,
];

/** Minimal/Maximal-Bitrate (Opus akzeptiert 6..510 kbps, wir cappen wie Spotify). */
export const MIN_OGG_BITRATE_BPS = 32_000;
export const MAX_OGG_BITRATE_BPS = 510_000;

/** MIME-Typen für die UI-File-Pickers. */
export const OGG_MIME = "audio/ogg";
export const WAV_MIME = "audio/wav";

/** Datei-Endungen. */
export const OGG_EXT = ".ogg";
export const WAV_EXT = ".wav";

// ─── Public Types ────────────────────────────────────────────────────────────

export type CompressFormat = "ogg" | "wav";

export interface CompressOptions {
  /** Ziel-Bitrate in bps. Default = 192_000. Wird auf [MIN, MAX] geclampt. */
  bitrate?: number;
  /** Bevorzugter Sample-Rate-Output. Default = audioBuffer.sampleRate. */
  sampleRate?: number;
  /**
   * Force-WAV-Fallback (für Tests / explizite User-Wahl). Default false.
   * Wenn true wird WebCodecs NICHT versucht, direkt WAV erzeugt.
   */
  forceWav?: boolean;
  /**
   * Test-Override: erlaubt das Injizieren eines Mock-AudioEncoders ohne
   * `globalThis.AudioEncoder`. Im Production-Code unbenutzt.
   */
  encoderImpl?: AudioEncoderFactory | null;
}

export interface CompressResult {
  blob: Blob;
  format: CompressFormat;
  /** Tatsächlich verwendete Bitrate (nur bei "ogg" sinnvoll). */
  bitrate: number;
  /** True wenn WebCodecs versagt hat und wir auf WAV gefallen sind. */
  usedFallback: boolean;
}

// ─── Pure-Helpers ────────────────────────────────────────────────────────────

/** Clampt eine Bitrate auf [MIN, MAX]. NaN/Infinity → Default. */
export function clampBitrate(v: number | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return DEFAULT_OGG_BITRATE_BPS;
  return Math.max(MIN_OGG_BITRATE_BPS, Math.min(MAX_OGG_BITRATE_BPS, Math.round(v)));
}

/** Wechselt die Datei-Endung passend zum Format. */
export function filenameForFormat(baseName: string, format: CompressFormat): string {
  const stripped = baseName.replace(/\.(wav|ogg|opus|mp3|flac|m4a)$/i, "");
  return stripped + (format === "ogg" ? OGG_EXT : WAV_EXT);
}

// ─── WebCodecs Detection ─────────────────────────────────────────────────────

interface AudioEncoderConfig {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  bitrate: number;
}

interface AudioEncoderLike {
  configure(cfg: AudioEncoderConfig): void;
  encode(data: AudioDataLike): void;
  flush(): Promise<void>;
  close(): void;
}

interface AudioDataLike {
  close?(): void;
}

interface EncodedAudioChunkLike {
  byteLength: number;
  copyTo(dst: Uint8Array): void;
  type?: "key" | "delta";
  timestamp?: number;
  duration?: number;
}

type AudioEncoderFactory = new (init: {
  output: (chunk: EncodedAudioChunkLike) => void;
  error: (err: Error) => void;
}) => AudioEncoderLike;

/**
 * Erkennt zur Laufzeit ob WebCodecs + Opus-Encoding verfügbar ist.
 * Cached das Ergebnis NICHT (Test-Resilience — verschiedene Tests dürfen
 * verschiedene `globalThis.AudioEncoder`-Werte setzen).
 */
export async function isWebCodecsOpusSupported(): Promise<boolean> {
  const g = globalThis as unknown as {
    AudioEncoder?: AudioEncoderFactory & {
      isConfigSupported?: (cfg: AudioEncoderConfig) => Promise<{ supported: boolean }>;
    };
  };
  if (typeof g.AudioEncoder !== "function") return false;
  // Wenn isConfigSupported nicht existiert (z.B. Mocks), nehmen wir an:
  // der Encoder funktioniert (Caller's responsibility).
  if (typeof g.AudioEncoder.isConfigSupported !== "function") return true;
  try {
    const res = await g.AudioEncoder.isConfigSupported({
      codec: "opus",
      sampleRate: 48000,
      numberOfChannels: 2,
      bitrate: DEFAULT_OGG_BITRATE_BPS,
    });
    return !!res?.supported;
  } catch {
    return false;
  }
}

// ─── Public Encoder ──────────────────────────────────────────────────────────

/**
 * Kodiert einen AudioBuffer als OGG-Opus-Blob. Wenn WebCodecs nicht verfügbar
 * ist (oder forceWav=true), wird transparent ein WAV-Blob zurückgegeben.
 *
 * Wirft NUR bei invaliden Inputs (audioBuffer ohne Channels, sampleRate≤0).
 */
export async function encodeAsOgg(
  audioBuffer: AudioBufferLike,
  opts: CompressOptions = {},
): Promise<Blob> {
  const result = await encodeCompressed(audioBuffer, opts);
  return result.blob;
}

/**
 * Detaillierte Variante: liefert Blob + Metadata (Format, Bitrate, Fallback-Flag).
 * Bevorzugte Variante für UI die den Status anzeigen muss.
 */
export async function encodeCompressed(
  audioBuffer: AudioBufferLike,
  opts: CompressOptions = {},
): Promise<CompressResult> {
  if (!audioBuffer || audioBuffer.numberOfChannels < 1) {
    throw new Error("encodeCompressed: invalid AudioBuffer (no channels)");
  }
  if (!Number.isFinite(audioBuffer.sampleRate) || audioBuffer.sampleRate <= 0) {
    throw new Error(`encodeCompressed: invalid sampleRate ${audioBuffer.sampleRate}`);
  }

  const bitrate = clampBitrate(opts.bitrate);
  const sampleRate = opts.sampleRate ?? audioBuffer.sampleRate;

  if (opts.forceWav) {
    return {
      blob: encodeWavFallback(audioBuffer),
      format: "wav",
      bitrate,
      usedFallback: false,
    };
  }

  // Try WebCodecs path
  const encoderImpl = resolveEncoderImpl(opts);
  if (encoderImpl) {
    try {
      const oggBlob = await encodeViaWebCodecs(audioBuffer, sampleRate, bitrate, encoderImpl);
      return {
        blob: oggBlob,
        format: "ogg",
        bitrate,
        usedFallback: false,
      };
    } catch {
      // Silent fallback — Caller bekommt einfach WAV.
    }
  }

  return {
    blob: encodeWavFallback(audioBuffer),
    format: "wav",
    bitrate,
    usedFallback: true,
  };
}

// ─── Internals ───────────────────────────────────────────────────────────────

/** Resolve den AudioEncoder-Konstruktor — entweder via Test-Inject oder global. */
function resolveEncoderImpl(opts: CompressOptions): AudioEncoderFactory | null {
  if (opts.encoderImpl) return opts.encoderImpl;
  const g = globalThis as unknown as { AudioEncoder?: AudioEncoderFactory };
  if (typeof g.AudioEncoder === "function") return g.AudioEncoder;
  return null;
}

/**
 * Minimal-AudioBuffer-Interface (DOM-frei testbar).
 */
export interface AudioBufferLike {
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

/** WebCodecs-Opus-Encoding mit Packaging in OGG-Container. */
async function encodeViaWebCodecs(
  buffer: AudioBufferLike,
  sampleRate: number,
  bitrate: number,
  EncoderCtor: AudioEncoderFactory,
): Promise<Blob> {
  // Sammle alle EncodedAudioChunks
  const chunks: Uint8Array[] = [];
  let lastError: Error | null = null;
  let done = false;

  const encoder = new EncoderCtor({
    output: (chunk) => {
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      chunks.push(bytes);
    },
    error: (err) => {
      lastError = err;
    },
  });

  encoder.configure({
    codec: "opus",
    sampleRate,
    numberOfChannels: Math.min(2, buffer.numberOfChannels),
    bitrate,
  });

  // Feed AudioData-Frames in ~20ms-Häppchen (Opus-Standardframe-Größe)
  const channels = Math.min(2, buffer.numberOfChannels);
  const frameSize = Math.floor(sampleRate * 0.02); // 20ms
  const total = buffer.length;
  let offset = 0;

  while (offset < total) {
    const frameLen = Math.min(frameSize, total - offset);
    const interleaved = new Float32Array(frameLen * channels);
    for (let ch = 0; ch < channels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < frameLen; i++) {
        interleaved[i * channels + ch] = data[offset + i] ?? 0;
      }
    }
    const audioData = makeAudioData(interleaved, sampleRate, channels, offset);
    encoder.encode(audioData);
    audioData.close?.();
    offset += frameLen;
  }

  await encoder.flush();
  encoder.close();
  done = true;

  if (lastError) throw lastError;
  if (!done || chunks.length === 0) {
    throw new Error("WebCodecs Opus encoding produced no chunks");
  }

  return packageOggOpus(chunks, sampleRate, channels);
}

/**
 * Erzeugt ein AudioData-Objekt für WebCodecs. Verwendet `AudioData` aus dem
 * globalScope falls verfügbar, ansonsten Plain-Object-Fallback für Tests.
 */
function makeAudioData(
  data: Float32Array,
  sampleRate: number,
  channels: number,
  offsetSamples: number,
): AudioDataLike {
  const g = globalThis as unknown as {
    AudioData?: new (init: {
      format: string;
      sampleRate: number;
      numberOfFrames: number;
      numberOfChannels: number;
      timestamp: number;
      data: Float32Array;
    }) => AudioDataLike;
  };
  const timestamp = Math.round((offsetSamples / sampleRate) * 1_000_000);
  const numberOfFrames = Math.floor(data.length / channels);
  if (typeof g.AudioData === "function") {
    return new g.AudioData({
      format: "f32",
      sampleRate,
      numberOfFrames,
      numberOfChannels: channels,
      timestamp,
      data,
    });
  }
  // Plain-Object-Fallback für Tests
  return {
    close: () => {},
  };
}

// ─── OGG Container ───────────────────────────────────────────────────────────

/**
 * Verpackt eine Folge von Opus-Encoded-Chunks in einen OGG-Container.
 * Layout:
 *   Page 0: OpusHead-Identification-Header (RFC 7845 §5.1)
 *   Page 1: OpusTags-Comment-Header (RFC 7845 §5.2)
 *   Page 2..N: Opus-Audio-Frames (jeweils ein Frame pro Page, vereinfacht)
 *   Letzte Page: EOS-Bit gesetzt
 *
 * Vereinfachung: wir nehmen 1 Opus-Packet pro Ogg-Page. Das ist nicht
 * bitrate-optimal aber überall lesbar.
 */
function packageOggOpus(
  opusChunks: Uint8Array[],
  sampleRate: number,
  channels: number,
): Blob {
  const pages: Uint8Array[] = [];
  const serial = (Math.random() * 0xffffffff) >>> 0;
  let pageSeq = 0;
  let granulePos = 0;

  // Page 0: OpusHead
  const idHeader = buildOpusIdHeader(sampleRate, channels);
  pages.push(buildOggPage(idHeader, serial, pageSeq++, 0, /*bos*/ true, /*eos*/ false));

  // Page 1: OpusTags
  const tagsHeader = buildOpusTagsHeader();
  pages.push(buildOggPage(tagsHeader, serial, pageSeq++, 0, false, false));

  // Audio pages
  for (let i = 0; i < opusChunks.length; i++) {
    granulePos += 960; // 20ms @ 48k = 960 samples (Opus standard granule)
    const isLast = i === opusChunks.length - 1;
    pages.push(buildOggPage(opusChunks[i], serial, pageSeq++, granulePos, false, isLast));
  }

  // Konkateniere alle Pages in ein einzelnes ArrayBuffer für saubere Blob-Typisierung.
  let totalLen = 0;
  for (const p of pages) totalLen += p.byteLength;
  const merged = new Uint8Array(totalLen);
  let off = 0;
  for (const p of pages) {
    merged.set(p, off);
    off += p.byteLength;
  }
  return new Blob([merged.buffer as ArrayBuffer], { type: OGG_MIME });
}

/** Baut den OpusHead (RFC 7845 §5.1). */
function buildOpusIdHeader(sampleRate: number, channels: number): Uint8Array {
  const buf = new Uint8Array(19);
  const view = new DataView(buf.buffer);
  // "OpusHead"
  buf.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0);
  buf[8] = 1; // version
  buf[9] = channels;
  view.setUint16(10, 0, true); // pre-skip
  view.setUint32(12, sampleRate, true); // original input sample rate
  view.setInt16(16, 0, true); // output gain (Q7.8)
  buf[18] = 0; // mapping family (0 = mono/stereo)
  return buf;
}

/** Baut den OpusTags (RFC 7845 §5.2) — minimaler Vendor-String. */
function buildOpusTagsHeader(): Uint8Array {
  const vendor = "Synthstudio";
  const vendorBytes = new TextEncoder().encode(vendor);
  const buf = new Uint8Array(8 + 4 + vendorBytes.length + 4);
  buf.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73], 0);
  const view = new DataView(buf.buffer);
  view.setUint32(8, vendorBytes.length, true);
  buf.set(vendorBytes, 12);
  view.setUint32(12 + vendorBytes.length, 0, true); // user-comment-list-length = 0
  return buf;
}

/** Baut eine einzelne Ogg-Page (RFC 3533 §6). Vereinfacht: max 255 Bytes Payload. */
function buildOggPage(
  payload: Uint8Array,
  serial: number,
  pageSeq: number,
  granulePos: number,
  bos: boolean,
  eos: boolean,
): Uint8Array {
  // Segmentation: max 255 Bytes pro Segment, max 255 Segments pro Page.
  const segmentCount = Math.max(1, Math.ceil(payload.length / 255));
  if (segmentCount > 255) {
    // Theoretisch sollte das nie passieren bei 20ms-Opus-Packets (<= ~510 Bytes).
    // Würde mehrere Pages erfordern; wir akzeptieren das Limit bewusst.
    throw new Error(`OGG page payload too large: ${payload.length} bytes`);
  }
  const segmentTable: number[] = [];
  let remaining = payload.length;
  for (let i = 0; i < segmentCount - 1; i++) {
    segmentTable.push(255);
    remaining -= 255;
  }
  segmentTable.push(remaining);

  const headerSize = 27 + segmentCount;
  const page = new Uint8Array(headerSize + payload.length);
  const view = new DataView(page.buffer);

  // OggS magic
  page[0] = 0x4f;
  page[1] = 0x67;
  page[2] = 0x67;
  page[3] = 0x53;
  page[4] = 0; // version
  let flags = 0;
  if (bos) flags |= 0x02;
  if (eos) flags |= 0x04;
  page[5] = flags;
  // granule position (64-bit LE)
  view.setUint32(6, granulePos & 0xffffffff, true);
  view.setUint32(10, Math.floor(granulePos / 0x100000000), true);
  view.setUint32(14, serial, true);
  view.setUint32(18, pageSeq, true);
  view.setUint32(22, 0, true); // checksum placeholder
  page[26] = segmentCount;
  for (let i = 0; i < segmentCount; i++) {
    page[27 + i] = segmentTable[i];
  }
  page.set(payload, headerSize);

  // CRC32 (Ogg uses 0x04C11DB7 polynomial, no input reflection)
  const crc = oggCrc32(page);
  view.setUint32(22, crc, true);
  return page;
}

// ─── CRC32 für OGG (RFC 3533 §6) ─────────────────────────────────────────────

let _oggCrcTable: Uint32Array | null = null;
function getOggCrcTable(): Uint32Array {
  if (_oggCrcTable) return _oggCrcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let r = n << 24;
    for (let k = 0; k < 8; k++) {
      r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0;
    }
    table[n] = r >>> 0;
  }
  _oggCrcTable = table;
  return table;
}

function oggCrc32(buf: Uint8Array): number {
  const table = getOggCrcTable();
  let crc = 0;
  for (let i = 0; i < buf.length; i++) {
    crc = ((crc << 8) ^ table[((crc >>> 24) ^ buf[i]) & 0xff]) >>> 0;
  }
  return crc >>> 0;
}

// ─── WAV Fallback ────────────────────────────────────────────────────────────

/**
 * Identische Logik zu encodeWav aus wavEncoder.ts, aber lokal damit wir
 * unabhängig von der Audio-Engine bleiben (kein zirkulärer Import).
 */
function encodeWavFallback(buffer: AudioBufferLike): Blob {
  const channels = Math.min(2, buffer.numberOfChannels);
  const length = buffer.length;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = length * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const out = new ArrayBuffer(totalSize);
  const view = new DataView(out);
  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, totalSize - 8, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = headerSize;
  const chData = [
    buffer.getChannelData(0),
    channels === 2 ? buffer.getChannelData(1) : buffer.getChannelData(0),
  ];
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < channels; ch++) {
      const s = Math.max(-1, Math.min(1, chData[ch][i] ?? 0));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([out], { type: WAV_MIME });
}
