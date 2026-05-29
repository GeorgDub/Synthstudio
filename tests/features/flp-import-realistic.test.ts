/**
 * tests/features/flp-import-realistic.test.ts
 *
 * Realistischer Synthese-Test für utils/flpImport.ts (Option C).
 *
 * Baut eine .flp-ähnliche Byte-Sequenz mit Event-Reihenfolge die FL Studio
 * typischerweise produziert: Version-String, mehrere Channels mit Names,
 * mehrere Patterns mit Names + Colors, gemischte BYTE/WORD/DWORD/DATA Events,
 * NotesEvents mit hohen Tick-Positions.
 *
 * Quellen: monadgroup/PyFLP, community-reverse-engineered FLP docs.
 *
 * Ziel: prüfen dass unser Parser robust durch realistische FLP-Event-Soup
 * läuft und nur die Events extrahiert die er kennt (NewPattern + NotesEvent).
 */
import { describe, it, expect } from "vitest";
import { parseFlp, flpPositionToStep, flpVelocityToUnit } from "../../client/src/utils/flpImport";

// ─── Event-Builders ───────────────────────────────────────────────────────────

function byteEvent(id: number, val: number): Uint8Array {
  return new Uint8Array([id, val]);
}

function wordEvent(id: number, val: number): Uint8Array {
  const buf = new Uint8Array(3);
  buf[0] = id;
  buf[1] = val & 0xff;
  buf[2] = (val >> 8) & 0xff;
  return buf;
}

function dwordEvent(id: number, val: number): Uint8Array {
  const buf = new Uint8Array(5);
  buf[0] = id;
  const view = new DataView(buf.buffer);
  view.setUint32(1, val, true);
  return buf;
}

function dataEvent(id: number, payload: Uint8Array): Uint8Array {
  const lenBytes: number[] = [];
  let n = payload.length;
  do {
    let b = n & 0x7f;
    n >>= 7;
    if (n > 0) b |= 0x80;
    lenBytes.push(b);
  } while (n > 0);
  const out = new Uint8Array(1 + lenBytes.length + payload.length);
  out[0] = id;
  out.set(lenBytes, 1);
  out.set(payload, 1 + lenBytes.length);
  return out;
}

function textEvent(id: number, str: string): Uint8Array {
  // FL Studio nutzt UTF-16LE für Strings ab v6+, mit null-terminator.
  // Wir bauen das hier auch so damit's realistisch ist.
  const utf16 = new Uint8Array(str.length * 2 + 2);
  for (let i = 0; i < str.length; i++) {
    utf16[i * 2] = str.charCodeAt(i) & 0xff;
    utf16[i * 2 + 1] = (str.charCodeAt(i) >> 8) & 0xff;
  }
  // null-terminator bleibt 0
  return dataEvent(id, utf16);
}

function buildNote(opts: {
  position: number;
  channel: number;
  duration: number;
  key: number;
  velocity: number;
  flags?: number;
  pan?: number;
  finePitch?: number;
}): Uint8Array {
  const buf = new Uint8Array(24);
  const view = new DataView(buf.buffer);
  view.setUint32(0, opts.position, true);
  view.setUint16(4, opts.flags ?? 0, true);
  view.setUint16(6, opts.channel, true);
  view.setUint32(8, opts.duration, true);
  view.setUint8(12, opts.key);
  view.setUint8(13, opts.finePitch ?? 0x80); // FL default = 128 (center)
  view.setUint8(14, 0);
  view.setUint8(15, 0x80); // release
  view.setUint8(16, 0); // midi channel
  view.setUint8(17, opts.pan ?? 0x40); // pan = 64 = center
  view.setUint8(18, opts.velocity);
  view.setUint8(19, 0x80); // mod x
  view.setUint8(20, 0x80); // mod y
  return buf;
}

function concatBytes(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

function buildFlp(opts: { ppq?: number; events?: Uint8Array[] }): ArrayBuffer {
  const ppq = opts.ppq ?? 96;
  const events = opts.events ?? [];

  const headerBuf = new Uint8Array(14);
  const headerView = new DataView(headerBuf.buffer);
  headerBuf.set([0x46, 0x4c, 0x68, 0x64], 0);
  headerView.setUint32(4, 6, true);
  headerView.setUint16(8, 0, true); // format=0 (full song)
  headerView.setUint16(10, 4, true); // 4 channels
  headerView.setUint16(12, ppq, true);

  const eventsBlob = concatBytes(events);
  const dataHeader = new Uint8Array(8);
  const dataView = new DataView(dataHeader.buffer);
  dataHeader.set([0x46, 0x4c, 0x64, 0x74], 0);
  dataView.setUint32(4, eventsBlob.length, true);

  const total = new Uint8Array(headerBuf.length + dataHeader.length + eventsBlob.length);
  total.set(headerBuf, 0);
  total.set(dataHeader, headerBuf.length);
  total.set(eventsBlob, headerBuf.length + dataHeader.length);
  return total.buffer.slice(total.byteOffset, total.byteOffset + total.byteLength);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("FLP-Import realistic synthetic FL-Studio output", () => {
  /**
   * Baut eine realistische Event-Sequenz wie FL Studio sie ausgibt:
   * - Version-String
   * - Globale BPM/PPQ
   * - 4 Channels (Kick, Snare, HiHat, Clap) mit Names
   * - 2 Patterns, jedes mit eigenem Namen + Color
   * - Pattern 1: klassisches 4-on-the-floor mit Hi-Hats
   * - Pattern 2: synkopiertes Pattern
   */
  function buildRealisticFlp(): ArrayBuffer {
    return buildFlp({
      ppq: 96,
      events: [
        // Globale Events
        textEvent(0xc7, "20.8.4.2576"),          // FLVersion
        byteEvent(0x1c, 0),                       // ShowInfo
        dwordEvent(0xb0, 30),                     // MainResolution
        wordEvent(0x42, 128),                     // BPM (legacy)
        dwordEvent(0x9b, 0x00bd0000),             // Tempo (DWORD)
        byteEvent(0x09, 1),                       // LoopActive
        wordEvent(0x47, 32),                      // Time-Signature numerator
        wordEvent(0x48, 4),                       // Time-Signature denominator

        // Channel 0: Kick
        wordEvent(0x40, 0),                       // NewChannel index=0
        textEvent(0xc0, "Kick"),                  // ChannelName
        dwordEvent(0x80, 0x40404040),             // ChanLevels
        byteEvent(0x02, 100),                     // ChanVol
        dwordEvent(0xbe, 0xff8800),               // Color (orange)
        dwordEvent(0x9c, 0),                      // ChanFXChannel = master

        // Channel 1: Snare
        wordEvent(0x40, 1),
        textEvent(0xc0, "Snare"),
        dwordEvent(0x80, 0x40404040),
        byteEvent(0x02, 90),
        dwordEvent(0xbe, 0x00ddff),

        // Channel 2: HiHat
        wordEvent(0x40, 2),
        textEvent(0xc0, "HiHat"),
        byteEvent(0x02, 80),
        dwordEvent(0xbe, 0x88ff88),

        // Channel 3: Clap
        wordEvent(0x40, 3),
        textEvent(0xc0, "Clap"),
        byteEvent(0x02, 95),
        dwordEvent(0xbe, 0xffff00),

        // ─── Pattern 1: "Beat 1" — 4-on-the-floor + Hi-Hats ─────────────────
        wordEvent(0x41, 1),                       // NewPattern index=1
        textEvent(0xc1, "Beat 1"),                // PatternName
        dataEvent(0xc8, new Uint8Array([0x00, 0x88, 0xff, 0x00])), // Pattern color (DATA, 4-byte payload)
        dataEvent(0xe7, concatBytes([
          // Kick auf 1, 5, 9, 13 (Steps 0, 4, 8, 12 → 0, 96, 192, 288 ticks)
          buildNote({ position: 0,   channel: 0, duration: 24, key: 36, velocity: 100 }),
          buildNote({ position: 96,  channel: 0, duration: 24, key: 36, velocity: 100 }),
          buildNote({ position: 192, channel: 0, duration: 24, key: 36, velocity: 100 }),
          buildNote({ position: 288, channel: 0, duration: 24, key: 36, velocity: 100 }),
          // Snare auf 5 + 13 (96, 288)
          buildNote({ position: 96,  channel: 1, duration: 24, key: 38, velocity: 110 }),
          buildNote({ position: 288, channel: 1, duration: 24, key: 38, velocity: 110 }),
          // HiHat 8th notes
          buildNote({ position: 0,   channel: 2, duration: 12, key: 42, velocity: 60 }),
          buildNote({ position: 48,  channel: 2, duration: 12, key: 42, velocity: 70 }),
          buildNote({ position: 96,  channel: 2, duration: 12, key: 42, velocity: 60 }),
          buildNote({ position: 144, channel: 2, duration: 12, key: 42, velocity: 70 }),
          buildNote({ position: 192, channel: 2, duration: 12, key: 42, velocity: 60 }),
          buildNote({ position: 240, channel: 2, duration: 12, key: 42, velocity: 70 }),
          buildNote({ position: 288, channel: 2, duration: 12, key: 42, velocity: 60 }),
          buildNote({ position: 336, channel: 2, duration: 12, key: 42, velocity: 70 }),
        ])),

        // ─── Pattern 2: "Beat 2" — synkopiert ───────────────────────────────
        wordEvent(0x41, 2),
        textEvent(0xc1, "Beat 2"),
        dataEvent(0xc8, new Uint8Array([0xff, 0xdd, 0x00, 0x00])),
        dataEvent(0xe7, concatBytes([
          // Kick versetzt (off-beat)
          buildNote({ position: 0,   channel: 0, duration: 24, key: 36, velocity: 120 }),
          buildNote({ position: 72,  channel: 0, duration: 24, key: 36, velocity: 90 }),
          buildNote({ position: 168, channel: 0, duration: 24, key: 36, velocity: 100 }),
          // Clap auf "& of 2" + "& of 4"
          buildNote({ position: 144, channel: 3, duration: 24, key: 39, velocity: 105 }),
          buildNote({ position: 336, channel: 3, duration: 24, key: 39, velocity: 105 }),
        ])),

        // ─── Pattern 3: leer (sollte trotzdem erkannt werden) ──────────────
        wordEvent(0x41, 3),
        textEvent(0xc1, "Empty"),

        // Random unbekannte Events am Ende
        byteEvent(0x20, 99),
        wordEvent(0x65, 4242),
        dwordEvent(0x91, 0x12345678),
      ],
    });
  }

  it("parsed Header korrekt aus realistischer FLP", () => {
    const flp = buildRealisticFlp();
    const parsed = parseFlp(flp);
    expect(parsed.header.format).toBe(0);
    expect(parsed.header.numChannels).toBe(4);
    expect(parsed.header.ppq).toBe(96);
  });

  it("findet alle 3 Patterns (auch das leere)", () => {
    const flp = buildRealisticFlp();
    const parsed = parseFlp(flp);
    expect(parsed.patterns.map(p => p.index)).toEqual([1, 2, 3]);
  });

  it("Pattern 1 hat genau 14 Notes (Kick 4 + Snare 2 + HiHat 8)", () => {
    const flp = buildRealisticFlp();
    const parsed = parseFlp(flp);
    expect(parsed.patterns[0].notes).toHaveLength(14);
  });

  it("Pattern 1 Notes auf den richtigen Channels", () => {
    const flp = buildRealisticFlp();
    const parsed = parseFlp(flp);
    const byChannel = parsed.patterns[0].notes.reduce<Record<number, number>>((acc, n) => {
      acc[n.channel] = (acc[n.channel] ?? 0) + 1;
      return acc;
    }, {});
    expect(byChannel[0]).toBe(4);  // Kick
    expect(byChannel[1]).toBe(2);  // Snare
    expect(byChannel[2]).toBe(8);  // HiHat
    expect(byChannel[3]).toBeUndefined(); // Clap nicht in Pattern 1
  });

  it("Pattern 2 hat 5 Notes mit synkopierten Positions", () => {
    const flp = buildRealisticFlp();
    const parsed = parseFlp(flp);
    const positions = parsed.patterns[1].notes.map(n => n.position).sort((a, b) => a - b);
    expect(positions).toEqual([0, 72, 144, 168, 336]);
  });

  it("Pattern 3 ist leer (Notes-Array existiert aber leer)", () => {
    const flp = buildRealisticFlp();
    const parsed = parseFlp(flp);
    expect(parsed.patterns[2].notes).toHaveLength(0);
  });

  it("ignoriert FLVersion / ChannelName / PatternName Events ohne zu crashen", () => {
    // Test prüft implizit dass varlen + text-events korrekt geparsed werden
    const flp = buildRealisticFlp();
    expect(() => parseFlp(flp)).not.toThrow();
  });

  it("Step-Conversion für Pattern 1 Kicks → Steps 0/4/8/12 bei 1 bar 16 steps", () => {
    const flp = buildRealisticFlp();
    const parsed = parseFlp(flp);
    const kickNotes = parsed.patterns[0].notes.filter(n => n.channel === 0);
    const steps = kickNotes.map(n => flpPositionToStep(n.position, parsed.header.ppq));
    expect(steps.sort((a, b) => a - b)).toEqual([0, 4, 8, 12]);
  });

  it("Step-Conversion für HiHat 8th notes → Steps 0/2/4/6/8/10/12/14", () => {
    const flp = buildRealisticFlp();
    const parsed = parseFlp(flp);
    const hihat = parsed.patterns[0].notes.filter(n => n.channel === 2);
    const steps = hihat.map(n => flpPositionToStep(n.position, parsed.header.ppq));
    expect(steps.sort((a, b) => a - b)).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
  });

  it("Velocity-Range plausibel (0-127)", () => {
    const flp = buildRealisticFlp();
    const parsed = parseFlp(flp);
    const allNotes = [...parsed.patterns[0].notes, ...parsed.patterns[1].notes];
    for (const n of allNotes) {
      expect(n.velocity).toBeGreaterThanOrEqual(0);
      expect(n.velocity).toBeLessThanOrEqual(127);
      expect(flpVelocityToUnit(n.velocity)).toBeGreaterThanOrEqual(0);
      expect(flpVelocityToUnit(n.velocity)).toBeLessThanOrEqual(1);
    }
  });

  it("Edge case: leere Patterns-Liste wenn keine NewPattern + keine Notes", () => {
    const flp = buildFlp({
      events: [
        textEvent(0xc7, "20.0.0.0"),
        byteEvent(0x09, 1),
      ],
    });
    const parsed = parseFlp(flp);
    expect(parsed.patterns).toHaveLength(0);
  });

  it("Edge case: NotesEvent ohne vorheriges NewPattern → Pattern 1 fallback", () => {
    // Manche FL-Versionen geben Notes vor NewPattern aus (für Pattern 1 default)
    const flp = buildFlp({
      events: [
        dataEvent(0xe7, buildNote({
          position: 0, channel: 0, duration: 24, key: 36, velocity: 100,
        })),
      ],
    });
    const parsed = parseFlp(flp);
    expect(parsed.patterns).toHaveLength(1);
    expect(parsed.patterns[0].index).toBe(1);
    expect(parsed.patterns[0].notes).toHaveLength(1);
  });

  it("Edge case: sehr viele Notes (256) → kein Overflow / OOM", () => {
    const notes: Uint8Array[] = [];
    for (let i = 0; i < 256; i++) {
      notes.push(buildNote({
        position: i * 12,
        channel: i % 4,
        duration: 12,
        key: 36 + (i % 12),
        velocity: 80 + (i % 48),
      }));
    }
    const flp = buildFlp({
      events: [
        wordEvent(0x41, 1),
        dataEvent(0xe7, concatBytes(notes)),
      ],
    });
    const parsed = parseFlp(flp);
    expect(parsed.patterns[0].notes).toHaveLength(256);
  });

  it("Edge case: PPQ 192 (high-res) → Step-Conversion bleibt korrekt", () => {
    const flp = buildFlp({
      ppq: 192,
      events: [
        wordEvent(0x41, 1),
        dataEvent(0xe7, concatBytes([
          buildNote({ position: 0,   channel: 0, duration: 48, key: 36, velocity: 100 }),
          buildNote({ position: 48,  channel: 0, duration: 48, key: 36, velocity: 100 }),
          buildNote({ position: 96,  channel: 0, duration: 48, key: 36, velocity: 100 }),
          buildNote({ position: 144, channel: 0, duration: 48, key: 36, velocity: 100 }),
        ])),
      ],
    });
    const parsed = parseFlp(flp);
    const steps = parsed.patterns[0].notes.map(n => flpPositionToStep(n.position, 192));
    expect(steps).toEqual([0, 1, 2, 3]);
  });

  it("Edge case: varlen-size > 127 (multi-byte length encoding)", () => {
    // Wenn payload länger als 127 Bytes ist, braucht varlen 2 Bytes
    // 200 Notes × 24 Bytes = 4800 Bytes → varlen ist 3 Bytes
    const notes: Uint8Array[] = [];
    for (let i = 0; i < 200; i++) {
      notes.push(buildNote({
        position: i * 24,
        channel: 0,
        duration: 24,
        key: 36,
        velocity: 100,
      }));
    }
    const flp = buildFlp({
      events: [
        wordEvent(0x41, 1),
        dataEvent(0xe7, concatBytes(notes)),
      ],
    });
    const parsed = parseFlp(flp);
    expect(parsed.patterns[0].notes).toHaveLength(200);
  });
});
