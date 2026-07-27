/**
 * hacktribe-ram.test.ts — v3.285.0
 *
 * Deckt Hacktribes RAM-Peek/Poke ab (`utils/korg/hacktribeRam.ts`).
 *
 * Schwerpunkt liegt auf den **Schutzmechanismen**, nicht auf dem Happy Path:
 * dieses Modul kann ein Gerät unbrauchbar machen, und die interessanten Fälle
 * sind die, in denen es das verweigern muss.
 */
import { describe, it, expect } from "vitest";
import {
  DDR2_BASE,
  DDR2_END,
  E2_RAM_MAP,
  RAM_ACK_CMD,
  RAM_CMD,
  RAM_WRITE_CHUNK,
  addressForSlot,
  buildRamReadRequest,
  buildRamWriteAddress,
  buildRamWriteData,
  encodeAddrLen,
  findRamMapEntry,
  formatHexDump,
  parseAddress,
  parseHexBytes,
  parseRamResponse,
  readU32le,
  splitRamRead,
  splitRamWrite,
  u32le,
  validateRamRange,
  verifyRamWrite,
} from "@/utils/korg/hacktribeRam";
import { decode7Bit, encode7Bit, buildFrame } from "@/utils/korg/e2NativeSysex";

// ─── Kommando-Bytes ─────────────────────────────────────────────────────────

describe("RAM_CMD", () => {
  it("benutzt die Hacktribe-Kommandos aus der Protokoll-Doku", () => {
    expect(RAM_CMD.read).toBe(0x52);
    expect(RAM_CMD.setWriteAddress).toBe(0x53);
    expect(RAM_CMD.writeData).toBe(0x54);
    expect(RAM_ACK_CMD).toBe(0x21);
  });

  it("stellt Flash und Execute NICHT bereit", () => {
    // 0x55/0x56 (Flash) und 0x57 (Execute) sind absichtlich nicht angebunden:
    // Flash überlebt den Power-Cycle, ein Fehler ist dann nicht mehr durch
    // Aus- und Einschalten zu beheben. Dieser Test hält die Grenze fest.
    const values = Object.values(RAM_CMD) as number[];
    expect(values).not.toContain(0x55);
    expect(values).not.toContain(0x56);
    expect(values).not.toContain(0x57);
    expect(values).not.toContain(0x58); // Freetribe-Loader
  });
});

// ─── validateRamRange: der eigentliche Schutz ───────────────────────────────

describe("validateRamRange", () => {
  it("erlaubt einen Bereich mitten im DDR2-Fenster", () => {
    expect(validateRamRange(0xc00a80f0, 0x20c).ok).toBe(true);
  });

  it("erlaubt genau die untere Grenze", () => {
    expect(validateRamRange(DDR2_BASE, 1).ok).toBe(true);
  });

  it("lehnt den Boot-Loader-Bereich ab — der Weg zum toten Gerät", () => {
    const res = validateRamRange(0x80000000, 4);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/Boot-Loader|DDR2/);
  });

  it("lehnt Adressen unter dem DDR2-Fenster ab", () => {
    expect(validateRamRange(0x00000000, 4).ok).toBe(false);
    expect(validateRamRange(DDR2_BASE - 1, 1).ok).toBe(false);
  });

  it("lehnt Adressen ab dem Ende des Fensters ab", () => {
    expect(validateRamRange(DDR2_END, 1).ok).toBe(false);
  });

  it("lehnt einen Bereich ab, der über das Fenster hinausragt", () => {
    // Startadresse gültig, Ende nicht — der klassische Off-by-Bereich.
    const res = validateRamRange(DDR2_END - 4, 16);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/Ende/);
  });

  it("lehnt unsinnige Längen ab", () => {
    expect(validateRamRange(DDR2_BASE, 0).ok).toBe(false);
    expect(validateRamRange(DDR2_BASE, -8).ok).toBe(false);
    expect(validateRamRange(DDR2_BASE, 1.5).ok).toBe(false);
    expect(validateRamRange(DDR2_BASE, Number.NaN).ok).toBe(false);
  });

  it("lehnt unsinnige Adressen ab", () => {
    expect(validateRamRange(Number.NaN, 4).ok).toBe(false);
    expect(validateRamRange(1.5, 4).ok).toBe(false);
    expect(validateRamRange(-1, 4).ok).toBe(false);
  });
});

// ─── Adress-Karte ───────────────────────────────────────────────────────────

describe("E2_RAM_MAP", () => {
  it("führt die verifizierten Hacktribe-Adressen", () => {
    // Quelle: hacktribe_ram_and_formats.md §1, gegen ht_sysex.py verifiziert.
    expect(findRamMapEntry("ifxPreset")).toMatchObject({ base: 0xc00a80f0, stride: 0x20c, count: 96 });
    expect(findRamMapEntry("mfxPreset")).toMatchObject({ base: 0xc00b4f30, stride: 0x20c, count: 32 });
    expect(findRamMapEntry("fxEditBuffer")).toMatchObject({ base: 0xc03478a8, stride: 0x72, count: 0x21 });
    expect(findRamMapEntry("groove")).toMatchObject({ base: 0xc0143b00, stride: 0x140, count: 96 });
  });

  it("liegt vollständig im erlaubten Fenster — sonst wäre die Karte selbst gefährlich", () => {
    for (const e of E2_RAM_MAP) {
      const last = addressForSlot(e, e.count - 1);
      expect(validateRamRange(e.base, e.size).ok).toBe(true);
      expect(validateRamRange(last, e.size).ok).toBe(true);
    }
  });

  it("hat eindeutige Schlüssel", () => {
    expect(new Set(E2_RAM_MAP.map((e) => e.key)).size).toBe(E2_RAM_MAP.length);
  });

  it("liefert undefined für unbekannte Schlüssel", () => {
    expect(findRamMapEntry("gibtsNicht")).toBeUndefined();
  });
});

describe("addressForSlot", () => {
  it("rechnet base + stride * index", () => {
    const ifx = findRamMapEntry("ifxPreset")!;
    expect(addressForSlot(ifx, 0)).toBe(0xc00a80f0);
    expect(addressForSlot(ifx, 1)).toBe(0xc00a80f0 + 0x20c);
    expect(addressForSlot(ifx, 95)).toBe(0xc00a80f0 + 0x20c * 95);
  });

  it("begrenzt den Index auf die Slot-Anzahl", () => {
    const mfx = findRamMapEntry("mfxPreset")!;
    expect(addressForSlot(mfx, -5)).toBe(mfx.base);
    expect(addressForSlot(mfx, 999)).toBe(mfx.base + mfx.stride * 31);
  });

  it("trifft für den FX-Edit-Buffer den MFX-Slot 0x20", () => {
    const buf = findRamMapEntry("fxEditBuffer")!;
    // Slot = part*2 + ifxSlot; 0x20 ist laut Doku das Master-FX.
    expect(addressForSlot(buf, 0x20)).toBe(buf.base + 0x72 * 0x20);
  });
});

// ─── Little-Endian-Kodierung ────────────────────────────────────────────────

describe("u32le / readU32le", () => {
  it("kodiert little-endian", () => {
    expect(u32le(0xc00a80f0)).toEqual([0xf0, 0x80, 0x0a, 0xc0]);
    expect(u32le(0)).toEqual([0, 0, 0, 0]);
  });

  it("ist ein Round-Trip", () => {
    for (const v of [0, 1, 0x20c, 0xc00a80f0, 0xffffffff]) {
      expect(readU32le(u32le(v))).toBe(v >>> 0);
    }
  });

  it("liest ab einem Offset", () => {
    const bytes = [0, 0, ...u32le(0xdeadbeef)];
    expect(readU32le(bytes, 2)).toBe(0xdeadbeef);
  });
});

describe("encodeAddrLen", () => {
  it("baut die 8 Bytes addr_le32 ‖ len_le32", () => {
    const body = encodeAddrLen(0xc00a80f0, 0x20c);
    expect(body).toHaveLength(8);
    expect(readU32le(body, 0)).toBe(0xc00a80f0);
    expect(readU32le(body, 4)).toBe(0x20c);
  });
});

// ─── Frame-Bau ──────────────────────────────────────────────────────────────

describe("Frame-Bau", () => {
  it("baut die Leseanfrage mit Kommando 0x52 und 7-bit-kodiertem Rumpf", () => {
    const frame = buildRamReadRequest(0xc00a80f0, 0x20c);
    expect(frame[0]).toBe(0xf0);
    expect(frame[1]).toBe(0x42);
    expect(frame[6]).toBe(RAM_CMD.read);
    expect(frame[frame.length - 1]).toBe(0xf7);

    // 8 Nutzbytes → 7-bit: 1 voller Block (8 B) + Rest 1 B + Header = 10 B.
    const payload = frame.subarray(7, frame.length - 1);
    expect(payload).toHaveLength(10);
    const decoded = decode7Bit(payload);
    expect(readU32le(decoded, 0)).toBe(0xc00a80f0);
    expect(readU32le(decoded, 4)).toBe(0x20c);
  });

  it("respektiert den Global-Channel im Kopf", () => {
    expect(buildRamReadRequest(DDR2_BASE, 4, { globalChannel: 9 })[2]).toBe(0x39);
  });

  it("baut die Adress-Setzung mit 0x53", () => {
    const frame = buildRamWriteAddress(DDR2_BASE, 16);
    expect(frame[6]).toBe(RAM_CMD.setWriteAddress);
    const decoded = decode7Bit(frame.subarray(7, frame.length - 1));
    expect(readU32le(decoded, 4)).toBe(16);
  });

  it("baut den Datenframe mit 0x54 und überträgt die Bytes verlustfrei", () => {
    const data = Uint8Array.from([0x00, 0x7f, 0x80, 0xff, 0x42]);
    const frame = buildRamWriteData(data);
    expect(frame[6]).toBe(RAM_CMD.writeData);
    // Der Codec muss auch Bytes über 0x7F unversehrt durchbringen — genau dafür
    // ist die 7↔8-Bit-Kodierung da.
    expect(Array.from(decode7Bit(frame.subarray(7, frame.length - 1)).subarray(0, data.length)))
      .toEqual(Array.from(data));
  });
});

// ─── Antworten ──────────────────────────────────────────────────────────────

describe("parseRamResponse", () => {
  it("erkennt einen Datenblock und dekodiert ihn", () => {
    const payload = Uint8Array.from([1, 2, 3, 0x80, 0xff]);
    const frame = buildFrame(RAM_CMD.read, encode7Bit(payload));
    const res = parseRamResponse(frame);
    expect(res?.kind).toBe("data");
    if (res?.kind === "data") {
      expect(Array.from(res.data.subarray(0, payload.length))).toEqual(Array.from(payload));
    }
  });

  it("erkennt das ACK eines Writes", () => {
    expect(parseRamResponse(buildFrame(RAM_ACK_CMD))?.kind).toBe("ack");
  });

  it("meldet ein unbekanntes Kommando statt zu raten", () => {
    const res = parseRamResponse(buildFrame(0x7e));
    expect(res?.kind).toBe("unknown");
    if (res?.kind === "unknown") expect(res.cmd).toBe(0x7e);
  });

  it("liefert null für Fremdnachrichten", () => {
    // Kein Korg-Sysex → nicht unsere Antwort.
    expect(parseRamResponse([0xf0, 0x7d, 0x01, 0x02, 0xf7])).toBeNull();
    expect(parseRamResponse([0x90, 60, 100])).toBeNull();
  });
});

// ─── Chunking ───────────────────────────────────────────────────────────────

describe("splitRamWrite", () => {
  it("teilt ein 524-B-FX-Preset in Häppchen mit eigener Adresse", () => {
    const data = new Uint8Array(0x20c);
    const chunks = splitRamWrite(0xc00a80f0, data);
    expect(chunks).toHaveLength(3); // 256 + 256 + 12
    expect(chunks.map((c) => c.bytes.length)).toEqual([0x100, 0x100, 0x0c]);
    expect(chunks.map((c) => c.addr)).toEqual([
      0xc00a80f0, 0xc00a80f0 + 0x100, 0xc00a80f0 + 0x200,
    ]);
  });

  it("gibt für kleine Daten genau ein Häppchen", () => {
    const chunks = splitRamWrite(DDR2_BASE, new Uint8Array(4));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ addr: DDR2_BASE });
  });

  it("verliert kein Byte", () => {
    const data = Uint8Array.from({ length: 700 }, (_, i) => i & 0xff);
    const chunks = splitRamWrite(DDR2_BASE, data);
    const joined = chunks.flatMap((c) => Array.from(c.bytes));
    expect(joined).toEqual(Array.from(data));
  });

  it("benutzt die Hacktribe-Häppchengröße als Default", () => {
    // 0x100 ist die Grenze, an der Hacktribes Editor Presets aufteilt.
    expect(RAM_WRITE_CHUNK).toBe(0x100);
  });

  it("fällt bei unsinniger Häppchengröße auf den Default zurück", () => {
    const chunks = splitRamWrite(DDR2_BASE, new Uint8Array(0x300), 0);
    expect(chunks.map((c) => c.bytes.length)).toEqual([0x100, 0x100, 0x100]);
  });
});

describe("splitRamRead", () => {
  it("deckt die volle Länge ab", () => {
    const parts = splitRamRead(DDR2_BASE, 0x20c);
    expect(parts.reduce((n, p) => n + p.len, 0)).toBe(0x20c);
    expect(parts[0].addr).toBe(DDR2_BASE);
    expect(parts[parts.length - 1].addr).toBe(DDR2_BASE + 0x200);
  });

  it("gibt für kurze Längen ein Stück", () => {
    expect(splitRamRead(DDR2_BASE, 8)).toEqual([{ addr: DDR2_BASE, len: 8 }]);
  });
});

// ─── Hex-Ein-/Ausgabe ───────────────────────────────────────────────────────

describe("parseHexBytes", () => {
  it("liest Leerzeichen-getrennte Bytes", () => {
    const res = parseHexBytes("00 7F 80 FF");
    expect(res.ok).toBe(true);
    if (res.ok) expect(Array.from(res.bytes)).toEqual([0x00, 0x7f, 0x80, 0xff]);
  });

  it("verträgt 0x-Präfixe, Kommas und Zeilenumbrüche", () => {
    const res = parseHexBytes("0x01, 0x02\n0x03");
    expect(res.ok).toBe(true);
    if (res.ok) expect(Array.from(res.bytes)).toEqual([1, 2, 3]);
  });

  it("meldet einen Tippfehler statt zu werfen", () => {
    const res = parseHexBytes("00 GG");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/Hex/);
  });

  it("meldet ein halbes Byte", () => {
    const res = parseHexBytes("00 1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/Ungerade/);
  });

  it("meldet leere Eingabe", () => {
    expect(parseHexBytes("   ").ok).toBe(false);
  });
});

describe("parseAddress", () => {
  it("liest Hex mit und ohne Präfix", () => {
    expect(parseAddress("0xC00A80F0")).toEqual({ ok: true, addr: 0xc00a80f0 });
    expect(parseAddress("C00A80F0")).toEqual({ ok: true, addr: 0xc00a80f0 });
  });

  it("liest reine Dezimalzahlen dezimal", () => {
    expect(parseAddress("100")).toEqual({ ok: true, addr: 100 });
  });

  it("meldet Unsinn", () => {
    expect(parseAddress("").ok).toBe(false);
    expect(parseAddress("zzz").ok).toBe(false);
  });
});

describe("formatHexDump", () => {
  it("schreibt Adress-Spalte und 16 Bytes pro Zeile", () => {
    const bytes = Uint8Array.from({ length: 20 }, (_, i) => i);
    const lines = formatHexDump(bytes, 0xc0000000).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^C0000000 {2}00 01 02/);
    expect(lines[1]).toMatch(/^C0000010 {2}10 11 12 13$/);
  });

  it("liefert für leere Eingabe einen leeren String", () => {
    expect(formatHexDump(new Uint8Array(0))).toBe("");
  });
});

// ─── Verifikation ───────────────────────────────────────────────────────────

describe("verifyRamWrite", () => {
  it("bestätigt identische Bytes", () => {
    const a = Uint8Array.from([1, 2, 3]);
    expect(verifyRamWrite(a, Uint8Array.from([1, 2, 3]))).toEqual({
      ok: true, firstDiff: -1, diffCount: 0,
    });
  });

  it("nennt Position und Anzahl der Abweichungen", () => {
    const res = verifyRamWrite(
      Uint8Array.from([1, 2, 3, 4]),
      Uint8Array.from([1, 9, 3, 8]),
    );
    expect(res.ok).toBe(false);
    expect(res.firstDiff).toBe(1);
    expect(res.diffCount).toBe(2);
  });

  it("erkennt unterschiedliche Längen", () => {
    const res = verifyRamWrite(Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2]));
    expect(res.ok).toBe(false);
    // diffCount -1 markiert „Länge passt nicht" — ein anderer Fehler als
    // abweichende Bytes und im UI auch anders zu melden.
    expect(res.diffCount).toBe(-1);
  });
});
