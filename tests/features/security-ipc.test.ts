/**
 * Synthstudio – IPC-Security-Audit-Tests (v2.99.0)
 *
 * Verifiziert die Validation-Layer aus electron/ipcValidators.ts:
 * - Path-Traversal-Schutz (Recording-Filename + Electribe-Path)
 * - Filename-Allowlist (Regex + NUL-Byte + separators)
 * - Size-Limits (WAV 500MB, License 16KB, Electribe 5MB)
 * - WAV-Magic-Check (RIFF/WAVE Header)
 * - License-State-Whitelist (kein Object-Injection in JSON)
 * - Electribe-Extension-Whitelist (case-insensitive)
 */
import { describe, it, expect } from "vitest";
import {
  validateRecordingFilename,
  validateWavBuffer,
  guardRecordingPath,
  sanitizeLicenseState,
  validateElectribePath,
  validateElectribeFileSize,
  RECORDING_MAX_BYTES,
  ELECTRIBE_MAX_BYTES,
  LICENSE_VALID_STATUS,
} from "../../electron/ipcValidators";

describe("validateRecordingFilename", () => {
  it("akzeptiert valide ASCII-Filename mit .wav", () => {
    expect(validateRecordingFilename("recording_2026-05-18.wav")).toEqual({
      ok: true,
      filename: "recording_2026-05-18.wav",
    });
  });

  it("lehnt Path-Traversal mit ../ ab", () => {
    expect(validateRecordingFilename("../etc/passwd.wav").ok).toBe(false);
    expect(validateRecordingFilename("..\\windows\\system32.wav").ok).toBe(false);
  });

  it("lehnt forward-slash ab", () => {
    expect(validateRecordingFilename("subdir/file.wav").ok).toBe(false);
  });

  it("lehnt backslash ab", () => {
    expect(validateRecordingFilename("subdir\\file.wav").ok).toBe(false);
  });

  it("lehnt NUL-Byte ab", () => {
    expect(validateRecordingFilename("file\0.wav").ok).toBe(false);
  });

  it("lehnt non-.wav-Endung ab", () => {
    expect(validateRecordingFilename("rec.exe").ok).toBe(false);
    expect(validateRecordingFilename("rec.bat").ok).toBe(false);
    expect(validateRecordingFilename("rec").ok).toBe(false);
  });

  it("lehnt Shell-Metacharacters ab", () => {
    expect(validateRecordingFilename("rec;rm -rf.wav").ok).toBe(false);
    expect(validateRecordingFilename("rec|cat.wav").ok).toBe(false);
    expect(validateRecordingFilename("rec`pwd`.wav").ok).toBe(false);
    expect(validateRecordingFilename("rec$(whoami).wav").ok).toBe(false);
  });

  it("lehnt Unicode-Pfad-Tricks ab", () => {
    expect(validateRecordingFilename("rec‮.wav").ok).toBe(false);
    expect(validateRecordingFilename("réc.wav").ok).toBe(false);
  });

  it("lehnt empty string + non-string ab", () => {
    expect(validateRecordingFilename("").ok).toBe(false);
    expect(validateRecordingFilename(null).ok).toBe(false);
    expect(validateRecordingFilename(123 as unknown).ok).toBe(false);
    expect(validateRecordingFilename({} as unknown).ok).toBe(false);
  });

  it("lehnt zu lange Filename ab (>120)", () => {
    const tooLong = "a".repeat(121) + ".wav";
    expect(validateRecordingFilename(tooLong).ok).toBe(false);
  });
});

describe("validateWavBuffer", () => {
  it("akzeptiert validen WAV-Header", () => {
    expect(validateWavBuffer(1024, "RIFF\0\0\0\0WAVE")).toEqual({ ok: true });
  });

  it("lehnt fehlende RIFF-Marker ab", () => {
    expect(validateWavBuffer(1024, "BLAH\0\0\0\0WAVE").ok).toBe(false);
  });

  it("lehnt fehlende WAVE-Marker ab", () => {
    expect(validateWavBuffer(1024, "RIFF\0\0\0\0BLAH").ok).toBe(false);
  });

  it("lehnt zu kleinen Buffer ab (<44 Bytes)", () => {
    expect(validateWavBuffer(20, "RIFF\0\0\0\0WAVE").ok).toBe(false);
  });

  it("lehnt zu großen Buffer ab (>500MB)", () => {
    expect(validateWavBuffer(RECORDING_MAX_BYTES + 1, "RIFF\0\0\0\0WAVE").ok).toBe(false);
  });

  it("lehnt zu kurzes Prefix ab (<12 Bytes)", () => {
    expect(validateWavBuffer(1024, "RIFF").ok).toBe(false);
  });
});

describe("guardRecordingPath (Path-Traversal Defense-in-Depth)", () => {
  const baseDir = process.platform === "win32" ? "C:\\Users\\test\\recordings" : "/tmp/recordings";

  it("akzeptiert normale Filename in baseDir", () => {
    const result = guardRecordingPath(baseDir, "rec.wav");
    expect(result.ok).toBe(true);
  });

  it("lehnt ../ Escape ab", () => {
    expect(guardRecordingPath(baseDir, "../escape.wav").ok).toBe(false);
  });

  it("lehnt ../-Escape außerhalb baseDir ab (defense-in-depth)", () => {
    expect(guardRecordingPath(baseDir, "../escape.wav").ok).toBe(false);
    expect(guardRecordingPath(baseDir, "../../etc/passwd.wav").ok).toBe(false);
  });
});

describe("sanitizeLicenseState", () => {
  it("sanitiert valide State unverändert", () => {
    const input = {
      status: "pro",
      trialStartedAt: 1234567890,
      licenseKey: "abc.def",
      activatedEmail: "user@example.com",
    };
    expect(sanitizeLicenseState(input)).toEqual(input);
  });

  it("fällt auf 'unknown' bei unbekanntem Status", () => {
    const result = sanitizeLicenseState({ status: "hacker", trialStartedAt: null });
    expect(result.status).toBe("unknown");
  });

  it("fällt auf null bei NaN trialStartedAt", () => {
    const result = sanitizeLicenseState({ status: "trial", trialStartedAt: NaN });
    expect(result.trialStartedAt).toBeNull();
  });

  it("fällt auf null bei Infinity trialStartedAt", () => {
    const result = sanitizeLicenseState({ status: "trial", trialStartedAt: Infinity });
    expect(result.trialStartedAt).toBeNull();
  });

  it("trimmt zu langen LicenseKey auf null", () => {
    const tooLong = "x".repeat(5000);
    const result = sanitizeLicenseState({ status: "pro", licenseKey: tooLong });
    expect(result.licenseKey).toBeNull();
  });

  it("trimmt zu lange Email auf null", () => {
    const tooLong = "x".repeat(300) + "@example.com";
    const result = sanitizeLicenseState({ status: "pro", activatedEmail: tooLong });
    expect(result.activatedEmail).toBeNull();
  });

  it("akzeptiert {} ohne Throw (defensive)", () => {
    const result = sanitizeLicenseState({});
    expect(result.status).toBe("unknown");
    expect(result.trialStartedAt).toBeNull();
  });

  it("akzeptiert null ohne Throw", () => {
    const result = sanitizeLicenseState(null);
    expect(result.status).toBe("unknown");
  });

  it("ignoriert nicht-whitelisted Felder (kein Prototype-Pollution)", () => {
    const input = {
      status: "pro",
      __proto__: { isAdmin: true },
      constructor: "evil",
      extra: "ignored",
    };
    const result = sanitizeLicenseState(input);
    expect(Object.keys(result).sort()).toEqual([
      "activatedEmail",
      "licenseKey",
      "status",
      "trialStartedAt",
    ]);
  });

  it("alle whitelisted Statuses werden akzeptiert", () => {
    for (const status of LICENSE_VALID_STATUS) {
      expect(sanitizeLicenseState({ status }).status).toBe(status);
    }
  });
});

describe("validateElectribePath", () => {
  it("akzeptiert .e2pattern", () => {
    const result = validateElectribePath("C:/Users/test/sample.e2pattern");
    expect(result.ok).toBe(true);
  });

  it("akzeptiert .e2sallpat", () => {
    const result = validateElectribePath("/home/user/bank.e2sallpat");
    expect(result.ok).toBe(true);
  });

  // v3.2.0: Real KORG E2 Sampler-Endung
  it("akzeptiert .e2spat (KORG E2 Sampler Real-Files)", () => {
    const result = validateElectribePath("C:/Korg/245_BodyTalk1.e2spat");
    expect(result.ok).toBe(true);
  });

  it("case-insensitive Endung", () => {
    expect(validateElectribePath("rec.E2PATTERN").ok).toBe(true);
    expect(validateElectribePath("rec.E2SallPat").ok).toBe(true);
    expect(validateElectribePath("rec.E2SPAT").ok).toBe(true);
  });

  it("lehnt andere Endungen ab", () => {
    expect(validateElectribePath("rec.exe").ok).toBe(false);
    expect(validateElectribePath("rec.txt").ok).toBe(false);
    expect(validateElectribePath("rec.wav").ok).toBe(false);
  });

  it("lehnt NUL-Byte ab", () => {
    expect(validateElectribePath("rec\0.e2pattern").ok).toBe(false);
  });

  it("lehnt empty + non-string ab", () => {
    expect(validateElectribePath("").ok).toBe(false);
    expect(validateElectribePath(null).ok).toBe(false);
    expect(validateElectribePath(undefined).ok).toBe(false);
    expect(validateElectribePath(42 as unknown).ok).toBe(false);
  });

  it("lehnt zu langen Pfad ab (>4096)", () => {
    const long = "a".repeat(4090) + ".e2pattern";
    expect(validateElectribePath(long).ok).toBe(false);
  });
});

describe("validateElectribeFileSize", () => {
  it("akzeptiert normale Größe", () => {
    expect(validateElectribeFileSize(100_000).ok).toBe(true);
  });

  it("akzeptiert exakte Max-Größe", () => {
    expect(validateElectribeFileSize(ELECTRIBE_MAX_BYTES).ok).toBe(true);
  });

  it("lehnt zu große Datei ab", () => {
    expect(validateElectribeFileSize(ELECTRIBE_MAX_BYTES + 1).ok).toBe(false);
  });

  it("lehnt negative ab", () => {
    expect(validateElectribeFileSize(-1).ok).toBe(false);
  });

  it("lehnt NaN ab", () => {
    expect(validateElectribeFileSize(NaN).ok).toBe(false);
  });
});
