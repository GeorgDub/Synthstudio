/**
 * Synthstudio – sampleEmbedding.ts (v3.124.0)
 *
 * Closes v3.116-Blob-URL-Persistenz-Caveat: bei Sample-Transform-Workflow legt
 * SampleTransformDialog das Ergebnis als Blob-URL ab.  Beim Project-Save in eine
 * .synth-Datei + späterem Reload ist die Blob-URL ungültig (Browser-Session
 * generiert keine identischen URLs neu) — das transformed Sample wäre verloren.
 *
 * Lösung: encode AudioBuffer → WAV-Bytes → Base64-String → in das .synth-File
 * einbetten.  Beim Load: Base64 → WAV-Bytes → AudioContext.decodeAudioData →
 * frische Blob-URL.
 *
 * ─── Verwandte Module ───────────────────────────────────────────────────────
 *
 * - wavExporter.ts: hat audioBufferToWav (NICHT public-exported, private).
 *   Wir duplizieren die WAV-Encoder-Logik bewusst hier — selber Algorithmus,
 *   aber pure-AudioBufferLike-Interface (testbar ohne DOM AudioBuffer).
 *
 * - audioCompressEncoder.ts: hat AudioBufferLike-Interface + WAV-Fallback.
 *   Wir reuse das Interface NICHT, weil es interlocked mit OGG-Code ist.
 *
 * ─── Defensive Defaults ─────────────────────────────────────────────────────
 *
 * - 10 MB Cap (MAX_EMBED_SIZE_KB = 10240) für UI-Warning bei großen Samples
 * - leerer Buffer (length=0) → leerer WAV-Header (44 Bytes), kein Throw
 * - corrupted Base64 (ungültige Zeichen / kein WAV-Header) → throws beim
 *   decode, Caller fängt und liefert silent buffer + warning
 * - 16-bit PCM mono/stereo, sampleRate aus dem Buffer
 *
 * ─── Tests ──────────────────────────────────────────────────────────────────
 *
 * Siehe tests/features/sample-embedding.test.ts (Round-Trip + Edge-Cases).
 */

// ─── Konstanten ──────────────────────────────────────────────────────────────

/**
 * Max-Empfehlung für einen einzelnen embedded WAV in Base64.  Wenn ein Sample
 * darüber liegt, zeigen wir eine UI-Warning.  10 MB Base64 entsprechen ~7.5 MB
 * Rohdaten (~21 Sekunden Stereo @ 48k 16-bit).
 */
export const MAX_EMBED_SIZE_KB = 10240;

/** WAV-Header-Größe in Bytes (16-bit PCM, RIFF/WAVE/fmt/data). */
const WAV_HEADER_SIZE = 44;

/** WAV bytes-per-sample für unsere Embed-Strategie (16-bit). */
const BYTES_PER_SAMPLE = 2;

// ─── Public Types ────────────────────────────────────────────────────────────

/**
 * Minimal-AudioBuffer-Interface (DOM-frei testbar).  Identisch zu dem in
 * audioCompressEncoder.ts — wir importieren NICHT um Circular-Risk zu vermeiden.
 */
export interface AudioBufferLike {
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

// ─── Base64 Helpers (DOM-frei) ───────────────────────────────────────────────

/**
 * Konvertiert ein Uint8Array in einen Base64-String.  Nutzt btoa wenn
 * verfügbar (Browser), Buffer.from sonst (Node-Tests).
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  // Browser-Pfad
  if (typeof btoa === "function") {
    let bin = "";
    // Chunkweise um Stack-Overflow bei großen Buffers zu vermeiden
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      bin += String.fromCharCode(...chunk);
    }
    return btoa(bin);
  }
  // Node-Test-Pfad
  const g = globalThis as unknown as { Buffer?: { from(arr: Uint8Array): { toString(enc: string): string } } };
  if (g.Buffer) {
    return g.Buffer.from(bytes).toString("base64");
  }
  throw new Error("uint8ArrayToBase64: neither btoa nor Buffer available");
}

/**
 * Umkehr.  Akzeptiert sowohl btoa-output als auch Standard-Base64.  Wirft bei
 * korrupten Eingaben (atob throws InvalidCharacterError, wir wrappen).
 */
export function base64ToUint8Array(b64: string): Uint8Array {
  if (typeof b64 !== "string") {
    throw new Error("base64ToUint8Array: input must be a string");
  }
  // Browser
  if (typeof atob === "function") {
    let bin: string;
    try {
      bin = atob(b64);
    } catch (e) {
      throw new Error(
        `base64ToUint8Array: invalid base64 (${e instanceof Error ? e.message : String(e)})`,
      );
    }
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node
  const g = globalThis as unknown as {
    Buffer?: { from(s: string, enc: string): Uint8Array };
  };
  if (g.Buffer) {
    try {
      return new Uint8Array(g.Buffer.from(b64, "base64"));
    } catch (e) {
      throw new Error(
        `base64ToUint8Array: invalid base64 (${e instanceof Error ? e.message : String(e)})`,
      );
    }
  }
  throw new Error("base64ToUint8Array: neither atob nor Buffer available");
}

// ─── WAV Encoder (16-bit PCM, mono/stereo) ───────────────────────────────────

/**
 * Kodiert einen AudioBuffer als 16-bit PCM WAV in einen Uint8Array.
 * Pure-DOM-frei (akzeptiert AudioBufferLike, also auch Mocks).
 *
 * Für leere Buffer (length=0) liefern wir einen minimal-validen WAV-Header
 * (44 Bytes) zurück.  dataSize=0 ist im RIFF-Standard zulässig.
 */
export function audioBufferToWavBytes(buffer: AudioBufferLike): Uint8Array {
  const channels = Math.max(1, buffer.numberOfChannels);
  const length = Math.max(0, buffer.length);
  const sampleRate = buffer.sampleRate > 0 ? buffer.sampleRate : 44100;
  const blockAlign = channels * BYTES_PER_SAMPLE;
  const byteRate = sampleRate * blockAlign;
  const dataSize = length * blockAlign;
  const totalSize = WAV_HEADER_SIZE + dataSize;

  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, totalSize - 8, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);          // fmt chunk size
  view.setUint16(20, 1, true);           // PCM format
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);          // bitsPerSample
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  if (length === 0) return out;

  // Interleave + clamp + Int16-PCM-Encode.
  // Wir holen alle Channel-Buffers EINMAL — getChannelData kann teuer sein.
  const channelData: Float32Array[] = [];
  for (let c = 0; c < channels; c++) channelData.push(buffer.getChannelData(c));

  let offset = WAV_HEADER_SIZE;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, channelData[c][i] ?? 0));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return out;
}

/**
 * Kodiert einen AudioBuffer als Base64-String (16-bit PCM WAV).
 * Round-Trip-getestet via base64WavToAudioBuffer.
 */
export function audioBufferToBase64Wav(buffer: AudioBufferLike): string {
  const bytes = audioBufferToWavBytes(buffer);
  return uint8ArrayToBase64(bytes);
}

// ─── WAV Decoder (über decodeAudioData) ──────────────────────────────────────

/**
 * Minimal AudioContext-Interface — nur das was wir brauchen.  Damit Caller
 * auch OfflineAudioContext durchreichen können und Tests einen Mock injizieren.
 */
export interface DecodeContextLike {
  decodeAudioData(buffer: ArrayBuffer): Promise<AudioBuffer>;
}

/**
 * Decodet einen Base64-WAV-String über ctx.decodeAudioData zurück zu einem
 * AudioBuffer.  Wirft bei corrupted Base64 oder invalidem WAV-Format.
 *
 * Caller (z.B. parseProjectWithSamples) sollte try/catch um den Aufruf legen
 * und bei Failure auf einen silent buffer (createBuffer(1, 1, 44100)) zurück-
 * fallen — wir wollen das ganze Project nicht verlieren wenn ein einzelnes
 * Sample korrupt ist.
 */
export async function base64WavToAudioBuffer(
  b64: string,
  ctx: DecodeContextLike,
): Promise<AudioBuffer> {
  const bytes = base64ToUint8Array(b64);
  if (bytes.length < WAV_HEADER_SIZE) {
    throw new Error(
      `base64WavToAudioBuffer: too small for WAV header (${bytes.length} < ${WAV_HEADER_SIZE} bytes)`,
    );
  }
  // Quick sanity-check: erste 4 Bytes "RIFF", Bytes 8..12 "WAVE".  Spart einen
  // confusing "EncodingError" aus decodeAudioData bei reinem garbage.
  if (
    bytes[0] !== 0x52 || // R
    bytes[1] !== 0x49 || // I
    bytes[2] !== 0x46 || // F
    bytes[3] !== 0x46 || // F
    bytes[8] !== 0x57 || // W
    bytes[9] !== 0x41 || // A
    bytes[10] !== 0x56 || // V
    bytes[11] !== 0x45 // E
  ) {
    throw new Error(
      "base64WavToAudioBuffer: invalid WAV header (missing RIFF/WAVE marker)",
    );
  }
  // Kopie damit decodeAudioData nicht das original .buffer detacht
  // (decodeAudioData transferiert in einigen Browsern den ArrayBuffer).
  const ab = bytes.slice().buffer;
  return ctx.decodeAudioData(ab as ArrayBuffer);
}

// ─── Größen-Schätzung ────────────────────────────────────────────────────────

/**
 * Schätzt die Embed-Größe in KB für einen Buffer.  Verwendet die WAV-Formel
 * direkt (kein actual encode), damit UI ohne Spike zur Render-Zeit das
 * Project-Save-Dialog updatet.
 *
 * Formel: header (44 B) + length * channels * 2 Bytes.
 * Base64 inflation: × 4/3 ≈ 1.333.
 */
export function estimateEmbedSizeKb(buffer: AudioBufferLike | null | undefined): number {
  if (!buffer) return 0;
  const length = Math.max(0, buffer.length);
  const channels = Math.max(1, buffer.numberOfChannels);
  const rawBytes = WAV_HEADER_SIZE + length * channels * BYTES_PER_SAMPLE;
  // Base64 ~33% Overhead — runden auf nächstes 4er-Vielfaches.
  const b64Bytes = Math.ceil(rawBytes / 3) * 4;
  return Math.round(b64Bytes / 1024);
}

/**
 * Liefert true wenn die Embed-Größe MAX_EMBED_SIZE_KB überschreitet.
 * UI nutzt das für eine Warning-Pille im Save-Dialog.
 */
export function exceedsEmbedSizeLimit(buffer: AudioBufferLike | null | undefined): boolean {
  return estimateEmbedSizeKb(buffer) > MAX_EMBED_SIZE_KB;
}

// ─── Sample-Path Heuristik ───────────────────────────────────────────────────

/**
 * True wenn das Sample-`path`-Feld auf eine Blob-URL zeigt (`blob:`-Schema).
 * Blob-URLs sind ephemer und überleben Project-Save+Reload NICHT — solche
 * Samples MÜSSEN embedded werden um nicht zu verschwinden.
 *
 * Disk-Pfade (Electron) oder Pack-Refs werden NICHT embedded — sie reverten
 * beim Reload korrekt über filePath bzw. pack:readFile.
 */
export function isBlobUrlPath(path: string | undefined | null): boolean {
  if (typeof path !== "string") return false;
  return path.startsWith("blob:");
}
