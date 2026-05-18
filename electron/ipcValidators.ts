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
export const ELECTRIBE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

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
