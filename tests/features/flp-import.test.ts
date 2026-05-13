/**
 * tests/features/flp-import.test.ts
 *
 * Unit-Tests für utils/flpImport.ts (FLP-IMPORT).
 *
 * Wir testen den Parser mit hand-gebauten Mini-FLPs (statt einer echten FL-
 * Studio Datei) damit die Tests stabil und reproduzierbar sind. Echte FLP-
 * Dateien aus FL Studio sind binär riesig und ändern sich pro FL-Version.
 */
import { describe, it, expect } from "vitest";
import {
  parseFlp,
  parseNotesEvent,
  parseNoteRecord,
  flpPositionToStep,
  flpVelocityToUnit,
  groupNotesByChannel,
  groupNotesByBar,
  calculateBarCount,
} from "../../client/src/utils/flpImport";

// ─── Helper: Mini-FLP builder ─────────────────────────────────────────────────

function buildFlp(opts: {
  format?: number;
  numChannels?: number;
  ppq?: number;
  events?: Uint8Array[];
}): ArrayBuffer {
  const format = opts.format ?? 0;
  const numChannels = opts.numChannels ?? 1;
  const ppq = opts.ppq ?? 96;
  const events = opts.events ?? [];

  // ── Header (14 bytes) ──
  const headerBuf = new Uint8Array(14);
  const headerView = new DataView(headerBuf.buffer);
  headerBuf.set([0x46, 0x4c, 0x68, 0x64], 0); // "FLhd"
  headerView.setUint32(4, 6, true); // header size
  headerView.setUint16(8, format, true);
  headerView.setUint16(10, numChannels, true);
  headerView.setUint16(12, ppq, true);

  // ── Data chunk ──
  const eventsBlob = concatBytes(events);
  const dataHeader = new Uint8Array(8);
  const dataView = new DataView(dataHeader.buffer);
  dataHeader.set([0x46, 0x4c, 0x64, 0x74], 0); // "FLdt"
  dataView.setUint32(4, eventsBlob.length, true);

  // ── Concat ──
  const total = new Uint8Array(headerBuf.length + dataHeader.length + eventsBlob.length);
  total.set(headerBuf, 0);
  total.set(dataHeader, headerBuf.length);
  total.set(eventsBlob, headerBuf.length + dataHeader.length);
  return total.buffer.slice(total.byteOffset, total.byteOffset + total.byteLength);
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

/** Bauen eines BYTE-Events (id < 0x40). */
function byteEvent(id: number, val: number): Uint8Array {
  return new Uint8Array([id, val]);
}
/** Bauen eines WORD-Events (0x40 ≤ id < 0x80). */
function wordEvent(id: number, val: number): Uint8Array {
  const buf = new Uint8Array(3);
  buf[0] = id;
  buf[1] = val & 0xff;
  buf[2] = (val >> 8) & 0xff;
  return buf;
}
/** Bauen eines DATA-Events (id ≥ 0xC0) mit varlen-size. */
function dataEvent(id: number, payload: Uint8Array): Uint8Array {
  // varlen-encode payload.length
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

/** Bauen eines 24-Byte Note-Records. */
function buildNote(opts: { position: number; channel: number; duration: number; key: number; velocity: number }): Uint8Array {
  const buf = new Uint8Array(24);
  const view = new DataView(buf.buffer);
  view.setUint32(0, opts.position, true);   // position
  view.setUint16(4, 0, true);                // flags
  view.setUint16(6, opts.channel, true);     // channel
  view.setUint32(8, opts.duration, true);    // duration
  view.setUint8(12, opts.key);               // key
  view.setUint8(18, opts.velocity);          // velocity
  return buf;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("parseFlp — Header", () => {
  it("liest format, numChannels und ppq aus dem Header", () => {
    const flp = buildFlp({ format: 0, numChannels: 4, ppq: 96 });
    const parsed = parseFlp(flp);
    expect(parsed.header.format).toBe(0);
    expect(parsed.header.numChannels).toBe(4);
    expect(parsed.header.ppq).toBe(96);
  });

  it("wirft bei ungültiger Magic-Signatur", () => {
    const buf = new Uint8Array(14);
    buf.set([0x58, 0x58, 0x58, 0x58], 0); // "XXXX"
    expect(() => parseFlp(buf.buffer)).toThrow(/FLhd/);
  });

  it("wirft bei falscher Header-Größe", () => {
    const buf = new Uint8Array(14);
    buf.set([0x46, 0x4c, 0x68, 0x64], 0); // "FLhd"
    new DataView(buf.buffer).setUint32(4, 99, true); // wrong size
    expect(() => parseFlp(buf.buffer)).toThrow(/Header-Größe/);
  });

  it("wirft bei falscher Data-Magic", () => {
    const headerBuf = new Uint8Array(14);
    const headerView = new DataView(headerBuf.buffer);
    headerBuf.set([0x46, 0x4c, 0x68, 0x64], 0);
    headerView.setUint32(4, 6, true);
    headerView.setUint16(8, 0, true);
    headerView.setUint16(10, 1, true);
    headerView.setUint16(12, 96, true);
    const dataBad = new Uint8Array([0x58, 0x58, 0x58, 0x58, 0, 0, 0, 0]);
    const total = new Uint8Array(headerBuf.length + dataBad.length);
    total.set(headerBuf, 0);
    total.set(dataBad, headerBuf.length);
    expect(() => parseFlp(total.buffer)).toThrow(/FLdt/);
  });
});

describe("parseFlp — Pattern extraction", () => {
  it("extrahiert Pattern-Index aus NewPattern-Event", () => {
    const flp = buildFlp({
      events: [wordEvent(0x4f, 3)],
    });
    const parsed = parseFlp(flp);
    expect(parsed.patterns).toHaveLength(1);
    expect(parsed.patterns[0].index).toBe(3);
    expect(parsed.patterns[0].notes).toEqual([]);
  });

  it("extrahiert Notes-Event und assoziiert sie zum aktuellen Pattern", () => {
    const note1 = buildNote({ position: 0, channel: 0, duration: 96, key: 60, velocity: 100 });
    const note2 = buildNote({ position: 96, channel: 1, duration: 96, key: 62, velocity: 110 });
    const notesPayload = concatBytes([note1, note2]);
    const flp = buildFlp({
      events: [
        wordEvent(0x4f, 1),         // NewPattern 1
        dataEvent(0xe7, notesPayload),
      ],
    });
    const parsed = parseFlp(flp);
    expect(parsed.patterns).toHaveLength(1);
    expect(parsed.patterns[0].notes).toHaveLength(2);
    expect(parsed.patterns[0].notes[0].key).toBe(60);
    expect(parsed.patterns[0].notes[0].velocity).toBe(100);
    expect(parsed.patterns[0].notes[1].position).toBe(96);
    expect(parsed.patterns[0].notes[1].channel).toBe(1);
  });

  it("teilt Notes auf mehrere Patterns wenn mehrere NewPattern-Events kommen", () => {
    const noteA = buildNote({ position: 0, channel: 0, duration: 96, key: 36, velocity: 127 });
    const noteB = buildNote({ position: 0, channel: 0, duration: 96, key: 38, velocity: 80 });
    const flp = buildFlp({
      events: [
        wordEvent(0x4f, 1),
        dataEvent(0xe7, noteA),
        wordEvent(0x4f, 2),
        dataEvent(0xe7, noteB),
      ],
    });
    const parsed = parseFlp(flp);
    expect(parsed.patterns).toHaveLength(2);
    expect(parsed.patterns[0].index).toBe(1);
    expect(parsed.patterns[1].index).toBe(2);
    expect(parsed.patterns[0].notes[0].key).toBe(36);
    expect(parsed.patterns[1].notes[0].key).toBe(38);
  });

  it("ignoriert unbekannte Event-IDs ohne zu crashen", () => {
    const flp = buildFlp({
      events: [
        byteEvent(0x10, 42),
        wordEvent(0x50, 1234),
        wordEvent(0x4f, 1),
      ],
    });
    const parsed = parseFlp(flp);
    expect(parsed.patterns).toHaveLength(1);
    expect(parsed.patterns[0].index).toBe(1);
  });
});

describe("parseNotesEvent", () => {
  it("parsed mehrere 24-Byte Note-Records", () => {
    const n1 = buildNote({ position: 0, channel: 0, duration: 24, key: 60, velocity: 100 });
    const n2 = buildNote({ position: 24, channel: 1, duration: 24, key: 62, velocity: 120 });
    const n3 = buildNote({ position: 48, channel: 2, duration: 24, key: 64, velocity: 80 });
    const data = concatBytes([n1, n2, n3]);
    const notes = parseNotesEvent(data);
    expect(notes).toHaveLength(3);
    expect(notes[0]).toEqual({ position: 0, channel: 0, duration: 24, key: 60, velocity: 100 });
    expect(notes[2].position).toBe(48);
  });

  it("returnt leeres Array bei leerem Buffer", () => {
    expect(parseNotesEvent(new Uint8Array(0))).toEqual([]);
  });

  it("floor't auf 24-Byte-Vielfache (überschüssige Bytes ignoriert)", () => {
    const n = buildNote({ position: 0, channel: 0, duration: 24, key: 60, velocity: 100 });
    const data = concatBytes([n, new Uint8Array([1, 2, 3])]); // 24 + 3 = 27
    expect(parseNotesEvent(data)).toHaveLength(1);
  });
});

describe("parseNoteRecord", () => {
  it("liest alle Felder korrekt aus 24-Byte Record", () => {
    const note = buildNote({ position: 480, channel: 7, duration: 192, key: 36, velocity: 110 });
    const view = new DataView(note.buffer);
    const parsed = parseNoteRecord(view, 0);
    expect(parsed.position).toBe(480);
    expect(parsed.channel).toBe(7);
    expect(parsed.duration).toBe(192);
    expect(parsed.key).toBe(36);
    expect(parsed.velocity).toBe(110);
  });
});

describe("flpPositionToStep", () => {
  it("bei PPQ=96: 0 ticks → step 0", () => {
    expect(flpPositionToStep(0, 96)).toBe(0);
  });
  it("bei PPQ=96: 24 ticks → step 1 (= 1/16)", () => {
    expect(flpPositionToStep(24, 96)).toBe(1);
  });
  it("bei PPQ=96: 48 ticks → step 2", () => {
    expect(flpPositionToStep(48, 96)).toBe(2);
  });
  it("bei PPQ=96: 96 ticks → step 4 (= 1/4)", () => {
    expect(flpPositionToStep(96, 96)).toBe(4);
  });
  it("bei PPQ=192: 48 ticks → step 1 (PPQ-abhängig)", () => {
    expect(flpPositionToStep(48, 192)).toBe(1);
  });
});

describe("flpVelocityToUnit", () => {
  it("0 → 0", () => { expect(flpVelocityToUnit(0)).toBe(0); });
  it("127 → 1", () => { expect(flpVelocityToUnit(127)).toBe(1); });
  it("64 → ~0.5", () => { expect(flpVelocityToUnit(64)).toBeCloseTo(0.504, 2); });
  it("clamped wenn out-of-range", () => {
    expect(flpVelocityToUnit(200)).toBe(1);
    expect(flpVelocityToUnit(-10)).toBe(0);
  });
});

describe("groupNotesByChannel", () => {
  it("gruppiert Notes nach FL-channel-index", () => {
    const notes = [
      { position: 0, channel: 0, duration: 24, key: 60, velocity: 100 },
      { position: 24, channel: 1, duration: 24, key: 62, velocity: 100 },
      { position: 48, channel: 0, duration: 24, key: 64, velocity: 100 },
    ];
    const grouped = groupNotesByChannel(notes);
    expect(grouped.size).toBe(2);
    expect(grouped.get(0)).toHaveLength(2);
    expect(grouped.get(1)).toHaveLength(1);
  });
});

describe("groupNotesByBar", () => {
  // PPQ=96, stepCount=16 → ticksPerBar = 24 * 16 = 384
  it("Bar 0: Notes mit position 0..383", () => {
    const notes = [
      { position: 0,   channel: 0, duration: 24, key: 60, velocity: 100 },
      { position: 96,  channel: 0, duration: 24, key: 60, velocity: 100 },
      { position: 383, channel: 0, duration: 24, key: 60, velocity: 100 },
    ];
    const grouped = groupNotesByBar(notes, 96, 16);
    expect(grouped.size).toBe(1);
    expect(grouped.get(0)).toHaveLength(3);
    // Positions sollen unverändert (bar-relativ = absolute bei bar 0)
    expect(grouped.get(0)![0].position).toBe(0);
    expect(grouped.get(0)![1].position).toBe(96);
    expect(grouped.get(0)![2].position).toBe(383);
  });

  it("Bar 1: Notes mit position 384..767 — relativ neu nummeriert", () => {
    const notes = [
      { position: 384, channel: 0, duration: 24, key: 60, velocity: 100 },
      { position: 480, channel: 0, duration: 24, key: 60, velocity: 100 },
      { position: 700, channel: 0, duration: 24, key: 60, velocity: 100 },
    ];
    const grouped = groupNotesByBar(notes, 96, 16);
    expect(grouped.size).toBe(1);
    const bar1 = grouped.get(1)!;
    expect(bar1[0].position).toBe(0);    // 384 - 384
    expect(bar1[1].position).toBe(96);   // 480 - 384
    expect(bar1[2].position).toBe(316);  // 700 - 384
  });

  it("Mehrere Bars verteilt sich korrekt", () => {
    const notes = [
      { position: 0,    channel: 0, duration: 24, key: 60, velocity: 100 }, // bar 0
      { position: 384,  channel: 0, duration: 24, key: 60, velocity: 100 }, // bar 1
      { position: 768,  channel: 0, duration: 24, key: 60, velocity: 100 }, // bar 2
      { position: 1152, channel: 0, duration: 24, key: 60, velocity: 100 }, // bar 3
    ];
    const grouped = groupNotesByBar(notes, 96, 16);
    expect(grouped.size).toBe(4);
    expect(grouped.get(0)![0].position).toBe(0);
    expect(grouped.get(1)![0].position).toBe(0);
    expect(grouped.get(2)![0].position).toBe(0);
    expect(grouped.get(3)![0].position).toBe(0);
  });

  it("32-step pattern: ticksPerBar = 768", () => {
    const notes = [
      { position: 0,   channel: 0, duration: 24, key: 60, velocity: 100 }, // bar 0
      { position: 767, channel: 0, duration: 24, key: 60, velocity: 100 }, // bar 0
      { position: 768, channel: 0, duration: 24, key: 60, velocity: 100 }, // bar 1
    ];
    const grouped = groupNotesByBar(notes, 96, 32);
    expect(grouped.get(0)).toHaveLength(2);
    expect(grouped.get(1)).toHaveLength(1);
  });
});

describe("calculateBarCount", () => {
  it("leerer Array → 1", () => {
    expect(calculateBarCount([], 96, 16)).toBe(1);
  });

  it("Single Note bei position=0 → 1 bar", () => {
    expect(calculateBarCount([{ position: 0, channel: 0, duration: 24, key: 60, velocity: 100 }], 96, 16)).toBe(1);
  });

  it("Note bei position=383 → 1 bar (immer noch in bar 0)", () => {
    expect(calculateBarCount([{ position: 383, channel: 0, duration: 24, key: 60, velocity: 100 }], 96, 16)).toBe(1);
  });

  it("Note bei position=384 → 2 bars", () => {
    expect(calculateBarCount([{ position: 384, channel: 0, duration: 24, key: 60, velocity: 100 }], 96, 16)).toBe(2);
  });

  it("Drop-TesT-Beispiel: pos=2976 → 8 bars", () => {
    expect(calculateBarCount([{ position: 2976, channel: 0, duration: 24, key: 60, velocity: 100 }], 96, 16)).toBe(8);
  });
});

describe("Integration: end-to-end mini-FLP", () => {
  it("parsed Header + Pattern + Notes konsistent", () => {
    // Mini-FLP: 1 Pattern (index 1) mit 4 Notes auf Channel 0, alle 1/16 entfernt
    const notes = [
      buildNote({ position: 0,  channel: 0, duration: 24, key: 36, velocity: 100 }),
      buildNote({ position: 24, channel: 0, duration: 24, key: 36, velocity: 80  }),
      buildNote({ position: 48, channel: 0, duration: 24, key: 36, velocity: 110 }),
      buildNote({ position: 72, channel: 0, duration: 24, key: 36, velocity: 90  }),
    ];
    const flp = buildFlp({
      ppq: 96,
      events: [
        wordEvent(0x4f, 1),
        dataEvent(0xe7, concatBytes(notes)),
      ],
    });
    const parsed = parseFlp(flp);
    expect(parsed.header.ppq).toBe(96);
    expect(parsed.patterns).toHaveLength(1);
    expect(parsed.patterns[0].notes).toHaveLength(4);

    // Steps: 0, 1, 2, 3
    const steps = parsed.patterns[0].notes.map(n => flpPositionToStep(n.position, parsed.header.ppq));
    expect(steps).toEqual([0, 1, 2, 3]);
  });
});
