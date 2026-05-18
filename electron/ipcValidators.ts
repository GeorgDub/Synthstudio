/**
 * Synthstudio – IPC-Validators (TASK-SEC-AUDIT, v2.99)
 *
 * Pure-Function-Layer für die Input-Validation der IPC-Handler aus
 * `electron/main.ts`. Trennung erlaubt:
 *   - Unit-Tests ohne Electron-Bootstrap (siehe tests/features/security-ipc.test.ts)
 *   - Drift-Schutz: ein Audit prüft genau diese Datei
 *   - Wieder-Verwendung wenn weitere IPC-Channels hinzukommen
 *
 * SCOPE — die Validators decken nur Audio-Recording-, License- und Electribe-
 * Import-Handler ab (Session v2.83-v2.97). Andere Channels (samples:*, fs:*,
 * collab:*) haben eigene Logik in main.ts und können in einer späteren
 * Iteration ebenfalls hier zentralisiert werden.
 *
 * Sicherheits-Annahmen:
 *   - Renderer ist NICHT vertrauenswürdig (XSS-Vektor möglich).
 *   - Alle Strings werden defensiv typed + längen-gebounded geprüft.
 *   - Pfad-Operationen erfolgen NACH Validation in main.ts mit path.resolve.
 */
import * as path from "path";

// ─── Audio-Recording-Filename ────────────────────────────────────────────────

export const RECORDING_FILENAME_MAX_LEN = 120;
/**
 * Strikte Whitelist: ASCII-alnum, Punkt, Underscore, Bindestrich; .wav-Endung.
 * Keine Verzeichnis-Trenner, kein '..', kein NUL-Byte, kein Unicode.
 */
export const RECORDING_FILENAME_REGEX = /^[A-Za-z0-9._-]+\.wav$/;

export type RecordingFilenameCheck =
  | { ok: true; filename: string }
  | { ok: false; error: string };

export function validateRecordingFilename(input: unknown): RecordingFilenameCheck {
  if (typeof input !== "string" || input.length === 0) {
    return { ok: false, error: "Ungültiger Dateiname" };
  }
  if (input.length > RECORDING_FILENAME_MAX_LEN) {
    return { ok: false, error: "Ungültiger Dateiname" };
  }
  if (
    input.includes("\0") ||
    input.includes("/") ||
    input.includes("\\") ||
    input.includes("..")
  ) {
    return { ok: false, error: "Dateiname enthält unzulässige Zeichen" };
  }
  if (!RECORDING_FILENAME_REGEX.test(input)) {
    return { ok: false, error: "Nur alphanumerische .wav-Dateinamen erlaubt" };
  }
  return { ok: true, filename: input };
}

// ─── WAV-Magic + Größe ───────────────────────────────────────────────────────

export const RECORDING_MAX_BYTES = 500 * 1024 * 1024; // 500 MB
export const WAV_MIN_HEADER_BYTES = 44;

export type WavBufferCheck =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Prüft das erste 12-Byte-Prefix auf 'RIFF....WAVE' + Min-Größe + Max-Größe.
 * Validation greift VOR dem Schreiben, damit kein Disk-Fill-Angriff möglich
 * ist und kein arbiträrer Binär-Müll auf die Platte landet.
 */
export function validateWavBuffer(
  byteLength: number,
  prefixAscii: string,
): WavBufferCheck {
  if (byteLength < WAV_MIN_HEADER_BYTES) {
    return { ok: false, error: "Buffer zu klein für WAV-Header" };
  }
  if (byteLength > RECORDING_MAX_BYTES) {
    return { ok: false, error: "Aufnahme zu groß (>500 MB)" };
  }
  if (prefixAscii.length < 12) {
    return { ok: false, error: "Prefix kürzer als 12 Bytes" };
  }
  const riff = prefixAscii.slice(0, 4);
  const wave = prefixAscii.slice(8, 12);
  if (riff !== "RIFF" || wave !== "WAVE") {
    return { ok: false, error: "Ungültiger WAV-Header" };
  }
  return { ok: true };
}

// ─── Path-Traversal-Guard (Recordings) ───────────────────────────────────────

export type PathGuardCheck =
  | { ok: true; resolved: string }
  | { ok: false; error: string };

/**
 * Stellt sicher, dass `path.resolve(join(baseDir, filename))` weiterhin
 * innerhalb von `baseDir` liegt. Filename muss vorher via
 * `validateRecordingFilename` durch sein — diese Funktion ist die zweite
 * Verteidigungslinie (defense-in-depth).
 */
export function guardRecordingPath(
  baseDir: string,
  filename: string,
): PathGuardCheck {
  const resolvedBase = path.resolve(baseDir);
  const expected = path.join(resolvedBase, filename);
  const resolved = path.resolve(expected);
  const expectedPrefix = resolvedBase + path.sep;
  if (resolved !== expected || !resolved.startsWith(expectedPrefix)) {
    return { ok: false, error: "Ungültiger Zielpfad" };
  }
  return { ok: true, resolved };
}

// ─── License-State-Whitelist ─────────────────────────────────────────────────

export const LICENSE_VALID_STATUS = new Set([
  "unknown",
  "trial",
  "pro",
  "expired",
  "invalid",
] as const);
export const LICENSE_MAX_KEY_LEN = 4096;
export const LICENSE_MAX_EMAIL_LEN = 254;
export const LICENSE_FILE_MAX_BYTES = 16 * 1024;

export interface SafeLicenseState {
  status: string;
  trialStartedAt: number | null;
  licenseKey: string | null;
  activatedEmail: string | null;
}

/**
 * Whitelist-Sanitisation. Unbekannte Status fallen auf 'unknown', invalide
 * Zahlen auf null, zu lange Strings auf null. Niemals Throw — Renderer kann
 * keine Exception-Strings nutzen, um Internals zu erspähen.
 */
export function sanitizeLicenseState(input: unknown): SafeLicenseState {
  const s = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const status =
    typeof s.status === "string" && (LICENSE_VALID_STATUS as Set<string>).has(s.status)
      ? s.status
      : "unknown";
  const trialStartedAt =
    typeof s.trialStartedAt === "number" && Number.isFinite(s.trialStartedAt)
      ? s.trialStartedAt
      : null;
  const licenseKey =
    typeof s.licenseKey === "string" &&
    s.licenseKey.length > 0 &&
    s.licenseKey.length <= LICENSE_MAX_KEY_LEN
      ? s.licenseKey
      : null;
  const activatedEmail =
    typeof s.activatedEmail === "string" &&
    s.activatedEmail.length > 0 &&
    s.activatedEmail.length <= LICENSE_MAX_EMAIL_LEN
      ? s.activatedEmail
      : null;
  return { status, trialStartedAt, licenseKey, activatedEmail };
}

// ─── Electribe-Import-Extension-Whitelist ────────────────────────────────────

// v3.2.0: .e2spat (Sampler-Export) als dritte Endung neben .e2pattern + .e2sallpat.
//         Verified gegen reale KORG E2 Sampler-Files (16640 Bytes Single-Pattern).
export const ELECTRIBE_ALLOWED_EXTENSIONS = new Set([".e2pattern", ".e2sallpat", ".e2spat"]);
// v3.11.0: erhoeht von 5 MB auf 8 MB damit .e2sallpat Stock-Banks
// (~4 MB) plus User-modifizierte Varianten (manchmal mit Sample-Embedded-Data
// auf Hardware-Side, hier nur theoretisch) sicher reinpassen.
export const ELECTRIBE_MAX_BYTES = 8 * 1024 * 1024; // 8 MB

export type ElectribePathCheck =
  | { ok: true; ext: string }
  | { ok: false; error: string };

/**
 * Prüft Endung (lower-case, Whitelist). Path-Resolve + stat erfolgt im
 * Caller. Diese Funktion ist die schnelle erste Schicht.
 */
export function validateElectribePath(input: unknown): ElectribePathCheck {
  if (typeof input !== "string" || input.length === 0) {
    return { ok: false, error: "Kein Dateipfad" };
  }
  if (input.length > 4096) {
    return { ok: false, error: "Dateipfad zu lang" };
  }
  if (input.includes("\0")) {
    return { ok: false, error: "Pfad enthält NUL-Byte" };
  }
  const ext = path.extname(input).toLowerCase();
  if (!ELECTRIBE_ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, error: "Nur .e2pattern/.e2sallpat/.e2spat erlaubt" };
  }
  return { ok: true, ext };
}

export function validateElectribeFileSize(byteSize: number): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(byteSize) || byteSize < 0) {
    return { ok: false, error: "Ungültige Dateigröße" };
  }
  if (byteSize > ELECTRIBE_MAX_BYTES) {
    return { ok: false, error: `Datei zu gross (>${ELECTRIBE_MAX_BYTES} Bytes)` };
  }
  return { ok: true };
}

// ─── KORG-Bank-Import-Extension-Whitelist (v3.3.0) ───────────────────────────

// .esx = ESX-1 Backup (~25 MB), .all = E2S Sample-Bank (~23 MB).
// Limit auf 100 MB als großzügige obere Schranke (Real-Files <30 MB, headroom
// für firmware-spezifische extras).
export const KORG_BANK_ALLOWED_EXTENSIONS = new Set([".esx", ".ess", ".all"]);
export const KORG_BANK_MAX_BYTES = 100 * 1024 * 1024; // 100 MB

export type KorgBankPathCheck =
  | { ok: true; ext: string }
  | { ok: false; error: string };

/** Prüft Endung (lower-case, Whitelist) für KORG-Bank-Files. */
export function validateKorgBankPath(input: unknown): KorgBankPathCheck {
  if (typeof input !== "string" || input.length === 0) {
    return { ok: false, error: "Kein Dateipfad" };
  }
  if (input.length > 4096) {
    return { ok: false, error: "Dateipfad zu lang" };
  }
  if (input.includes("\0")) {
    return { ok: false, error: "Pfad enthält NUL-Byte" };
  }
  const ext = path.extname(input).toLowerCase();
  if (!KORG_BANK_ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, error: "Nur .esx/.ess/.all erlaubt" };
  }
  return { ok: true, ext };
}

export function validateKorgBankFileSize(
  byteSize: number,
): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(byteSize) || byteSize < 0) {
    return { ok: false, error: "Ungültige Dateigröße" };
  }
  if (byteSize > KORG_BANK_MAX_BYTES) {
    return { ok: false, error: `Datei zu gross (>${KORG_BANK_MAX_BYTES} Bytes)` };
  }
  return { ok: true };
}

// ─── KORG-Bank-EXPORT-Filename + Buffer-Validation (v3.4.0) ──────────────────

/**
 * Filename-Whitelist beim Save-As .all File (Synthstudio → KORG E2S).
 * Wir akzeptieren nur ASCII-alnum + . _ - und MÜSSEN auf .all enden.
 */
export const KORG_BANK_SAVE_FILENAME_MAX_LEN = 120;
export const KORG_BANK_SAVE_FILENAME_REGEX = /^[A-Za-z0-9._-]+\.all$/;
/**
 * Buffer-Cap fürs IPC-Save. 256 MB = etwas über E2S_MAX_TOTAL_PCM_BYTES (224 MB)
 * für Header-Overhead + zukünftige globale-Section-Erweiterungen.
 */
export const KORG_BANK_SAVE_MAX_BYTES = 256 * 1024 * 1024; // 256 MB

export type KorgBankFilenameCheck =
  | { ok: true; filename: string }
  | { ok: false; error: string };

export function validateKorgBankSaveFilename(input: unknown): KorgBankFilenameCheck {
  if (typeof input !== "string" || input.length === 0) {
    return { ok: false, error: "Ungültiger Dateiname" };
  }
  if (input.length > KORG_BANK_SAVE_FILENAME_MAX_LEN) {
    return { ok: false, error: "Dateiname zu lang" };
  }
  if (
    input.includes("\0") ||
    input.includes("/") ||
    input.includes("\\") ||
    input.includes("..")
  ) {
    return { ok: false, error: "Dateiname enthält unzulässige Zeichen" };
  }
  if (!KORG_BANK_SAVE_FILENAME_REGEX.test(input)) {
    return { ok: false, error: "Nur alphanumerische .all-Dateinamen erlaubt" };
  }
  return { ok: true, filename: input };
}

export type KorgBankBufferCheck =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Prüft das erste 16-Byte-Prefix auf "e2s sample all\x1a\x00" + Min/Max-Größe.
 * Validation greift VOR dem Schreiben — Disk-Fill-Schutz + kein arbiträrer
 * Binär-Müll auf der Platte.
 *
 * @param byteLength volle Buffer-Größe in Bytes
 * @param prefixBytes erste 16 Bytes des Buffers (als Uint8Array vom Caller)
 */
export function validateKorgBankBuffer(
  byteLength: number,
  prefixBytes: Uint8Array,
): KorgBankBufferCheck {
  // E2S_ALL_SAMPLE_AREA_START = 0x1000 ist die kleinste sinnvolle Größe
  // (Prelude + leere Offset-Table). Wir prüfen hardcoded statt Import um
  // ipcValidators.ts unabhängig von client-Code zu halten.
  const MIN_BYTES = 0x1000;
  if (byteLength < MIN_BYTES) {
    return { ok: false, error: "Buffer zu klein für E2S .all-Header" };
  }
  if (byteLength > KORG_BANK_SAVE_MAX_BYTES) {
    return { ok: false, error: "Sample-Bank zu groß (>256 MB)" };
  }
  if (!prefixBytes || prefixBytes.length < 16) {
    return { ok: false, error: "Prefix kürzer als 16 Bytes" };
  }
  const expected = [
    0x65, 0x32, 0x73, 0x20, // "e2s "
    0x73, 0x61, 0x6d, 0x70, // "samp"
    0x6c, 0x65, 0x20, 0x61, // "le a"
    0x6c, 0x6c, 0x1a, 0x00, // "ll\x1a\0"
  ];
  for (let i = 0; i < 16; i++) {
    if (prefixBytes[i] !== expected[i]) {
      return { ok: false, error: "Ungültige E2S-Bank-Signatur" };
    }
  }
  return { ok: true };
}

// ─── ESX-1 BANK WRITE (.esx) — v3.28.0 ────────────────────────────────────────

/**
 * Filename-Whitelist beim Save-As .esx File (Synthstudio → KORG ESX-1 Bank).
 * Wir akzeptieren nur ASCII-alnum + . _ - und MÜSSEN auf .esx enden.
 *
 * Separat vom KORG_BANK_SAVE (.all = E2S) Validator, damit die Endungs-Pflicht
 * pro Format strikt enforced bleibt — kein Misch-Save.
 */
export const ESX_BANK_SAVE_FILENAME_MAX_LEN = 120;
export const ESX_BANK_SAVE_FILENAME_REGEX = /^[A-Za-z0-9._-]+\.esx$/;
/**
 * Buffer-Cap fürs IPC-Save. ESX-Files sind ~24-28 MB (256 patterns + 384
 * samples + 24 MB PCM). 64 MB = großzügige obere Schranke (matcht
 * ESX_FILE_MAX_BYTES in constants.ts, ohne Cross-Module-Import).
 */
export const ESX_BANK_SAVE_MAX_BYTES = 64 * 1024 * 1024; // 64 MB
/**
 * Minimum sinnvolle .esx-Größe: bis zum Sample-Section-Start (matched
 * ESX1_SIZE_FILE_MIN = 0x00250010, ohne Cross-Module-Import).
 */
export const ESX_BANK_SAVE_MIN_BYTES = 0x00250010;

export type EsxBankFilenameCheck =
  | { ok: true; filename: string }
  | { ok: false; error: string };

export function validateEsxBankSaveFilename(input: unknown): EsxBankFilenameCheck {
  if (typeof input !== "string" || input.length === 0) {
    return { ok: false, error: "Ungültiger Dateiname" };
  }
  if (input.length > ESX_BANK_SAVE_FILENAME_MAX_LEN) {
    return { ok: false, error: "Dateiname zu lang" };
  }
  if (
    input.includes("\0") ||
    input.includes("/") ||
    input.includes("\\") ||
    input.includes("..")
  ) {
    return { ok: false, error: "Dateiname enthält unzulässige Zeichen" };
  }
  if (!ESX_BANK_SAVE_FILENAME_REGEX.test(input)) {
    return { ok: false, error: "Nur alphanumerische .esx-Dateinamen erlaubt" };
  }
  return { ok: true, filename: input };
}

export type EsxBankBufferCheck =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Prüft Min/Max-Größe + erste 16 Bytes auf "KORG" @ 0x00 und "ESX\0" @ 0x08.
 * Validation greift VOR dem Schreiben — Disk-Fill-Schutz + kein arbiträrer
 * Binär-Müll auf der Platte.
 *
 * @param byteLength volle Buffer-Größe in Bytes
 * @param prefixBytes erste 16 Bytes des Buffers (als Uint8Array vom Caller)
 */
export function validateEsxBankBuffer(
  byteLength: number,
  prefixBytes: Uint8Array,
): EsxBankBufferCheck {
  if (!Number.isFinite(byteLength) || byteLength < ESX_BANK_SAVE_MIN_BYTES) {
    return { ok: false, error: "Buffer zu klein für ESX-1 Bank-Header" };
  }
  if (byteLength > ESX_BANK_SAVE_MAX_BYTES) {
    return { ok: false, error: "ESX-Bank zu groß (>64 MB)" };
  }
  if (!prefixBytes || prefixBytes.length < 16) {
    return { ok: false, error: "Prefix kürzer als 16 Bytes" };
  }
  // "KORG" @ 0x00
  if (
    prefixBytes[0] !== 0x4b ||
    prefixBytes[1] !== 0x4f ||
    prefixBytes[2] !== 0x52 ||
    prefixBytes[3] !== 0x47
  ) {
    return { ok: false, error: "Ungültige KORG-Signatur" };
  }
  // "ESX\0" @ 0x08
  if (
    prefixBytes[0x08] !== 0x45 ||
    prefixBytes[0x09] !== 0x53 ||
    prefixBytes[0x0a] !== 0x58 ||
    prefixBytes[0x0b] !== 0x00
  ) {
    return { ok: false, error: "Ungültige ESX-1 Sub-Magic" };
  }
  return { ok: true };
}

// ─── E2 PATTERN WRITE (.e2spat) — v3.26.0 ────────────────────────────────────

/**
 * Filename-Whitelist beim Save-As .e2spat File (Synthstudio → KORG E2 Sampler-Pattern).
 * ASCII-alnum + . _ - und MUSS auf .e2spat enden.
 */
export const E2_PATTERN_FILENAME_MAX_LEN = 120;
export const E2_PATTERN_FILENAME_REGEX = /^[A-Za-z0-9._-]+\.e2spat$/;

/**
 * Buffer-Cap fürs IPC-Save. Exakte Hardware-Größe = 16640 Bytes. Wir prüfen
 * gegen STRICT === 16640 in `validateE2PatternBuffer`. Diese Konstante bleibt
 * für Symmetrie zu `KORG_BANK_SAVE_MAX_BYTES` definiert.
 */
export const E2_PATTERN_FILE_SIZE_EXACT = 16640;

export type E2PatternFilenameCheck =
  | { ok: true; filename: string }
  | { ok: false; error: string };

/**
 * Strict filename validator for .e2spat writes. Defensiv gegen Path-Traversal,
 * NUL-Bytes und Endungs-Spoofing. Returns the validated string only — no
 * implicit normalisation.
 */
export function validateE2PatternFilename(input: unknown): E2PatternFilenameCheck {
  if (typeof input !== "string" || input.length === 0) {
    return { ok: false, error: "Ungültiger Dateiname" };
  }
  if (input.length > E2_PATTERN_FILENAME_MAX_LEN) {
    return { ok: false, error: "Dateiname zu lang" };
  }
  if (
    input.includes("\0") ||
    input.includes("/") ||
    input.includes("\\") ||
    input.includes("..")
  ) {
    return { ok: false, error: "Dateiname enthält unzulässige Zeichen" };
  }
  if (!E2_PATTERN_FILENAME_REGEX.test(input)) {
    return { ok: false, error: "Nur alphanumerische .e2spat-Dateinamen erlaubt" };
  }
  return { ok: true, filename: input };
}

export type E2PatternBufferCheck =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Strict buffer validator for .e2spat writes. Verifies:
 *   - Exact size 16640 bytes (KORG hardware-spec)
 *   - "KORG" magic @ 0x00
 *   - "e2sampler" identifier @ 0x10
 *   - "PTST" pattern marker @ 0x100
 *
 * `prefixBytes` must contain at least the first 260 bytes of the file (to
 * reach the PTST marker at 0x100..0x103). The caller is responsible for
 * sending enough bytes — main.ts slices 260 from the incoming buffer.
 */
export function validateE2PatternBuffer(
  byteLength: number,
  prefixBytes: Uint8Array,
): E2PatternBufferCheck {
  if (byteLength !== E2_PATTERN_FILE_SIZE_EXACT) {
    return { ok: false, error: `Ungültige Dateigröße (${byteLength} Bytes, erwartet 16640)` };
  }
  if (!prefixBytes || prefixBytes.length < 0x104) {
    return { ok: false, error: "Prefix kürzer als 260 Bytes" };
  }
  // "KORG" @ 0x00
  if (
    prefixBytes[0] !== 0x4b ||
    prefixBytes[1] !== 0x4f ||
    prefixBytes[2] !== 0x52 ||
    prefixBytes[3] !== 0x47
  ) {
    return { ok: false, error: "Ungültige KORG-Signatur" };
  }
  // "e2sa" @ 0x10 (prefix of "e2sampler")
  if (
    prefixBytes[0x10] !== 0x65 ||
    prefixBytes[0x11] !== 0x32 ||
    prefixBytes[0x12] !== 0x73 ||
    prefixBytes[0x13] !== 0x61
  ) {
    return { ok: false, error: "Ungültige e2sampler-Signatur" };
  }
  // "PTST" @ 0x100
  if (
    prefixBytes[0x100] !== 0x50 ||
    prefixBytes[0x101] !== 0x54 ||
    prefixBytes[0x102] !== 0x53 ||
    prefixBytes[0x103] !== 0x54
  ) {
    return { ok: false, error: "Ungültiger PTST-Marker" };
  }
  return { ok: true };
}
