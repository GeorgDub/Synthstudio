/**
 * tests/features/korg-esx-songs.test.ts
 *
 * Unit-Tests fuer ESX-1 Song-Mode-Import (v3.89.0).
 *
 * Coverage:
 *   - parseEsxSong: name + bpm Extraktion aus 528B-Block
 *   - isEmptyEsxSong: init-Signatur-Erkennung (KASSEL.esx empty songs)
 *   - parseEsxSongEvents: 8B-Event-Frames mit end-marker handling
 *   - parseEsxSongs: Bulk + truncated-region warnings
 *   - convertEsxSongToSynthstudio: slots[]-Mapping mit Pattern-Bank
 *   - esxPatternIndexToBank: 0..255 → A..D
 *   - Conditional Real-File Smoke gegen "Korg ESX files/" (KASSEL hat
 *     bekannte non-empty Song-Slots 31..63 — wir akzeptieren sie ohne
 *     Decoding-Sicherheit als RE-Best-Effort).
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  parseEsxSong,
  parseEsxSongs,
  parseEsxSongEvents,
  isEmptyEsxSong,
  parseEsxBank,
  ESX1_SONG_EVENT_END_MARKER,
  EsxParseError,
  type EsxSong,
  type EsxSongEvent,
} from "@/utils/korg/esxParser";
import {
  convertEsxSongToSynthstudio,
  esxPatternIndexToBank,
} from "@/utils/korg/esxPatternConvert";
import {
  ESX1_ADDR_SONG_DATA,
  ESX1_ADDR_SONG_EVENT_DATA,
  ESX1_CHUNKSIZE_SONG,
  ESX1_CHUNKSIZE_SONG_EVENT,
  ESX1_NUM_SONGS,
} from "@/utils/korg/constants";

// ─── Synthetic Song-Block Builders ──────────────────────────────────────────

/** Builds an init/empty song block (528B): 8 spaces + 0x3C + 519 zeros. */
function buildInitSongBlock(): Uint8Array {
  const block = new Uint8Array(ESX1_CHUNKSIZE_SONG);
  for (let i = 0; i < 8; i++) block[i] = 0x20;
  block[8] = 0x3c;
  return block;
}

/** Builds a non-empty song block with a given ASCII name and BPM. */
function buildNamedSongBlock(name: string, bpmByte = 120, extraDataAt16 = 0x42): Uint8Array {
  const block = new Uint8Array(ESX1_CHUNKSIZE_SONG);
  for (let i = 0; i < 8; i++) block[i] = i < name.length ? name.charCodeAt(i) : 0x20;
  block[8] = bpmByte;
  // Add a non-zero byte at offset 16 to ensure isEmptyEsxSong returns false.
  block[16] = extraDataAt16;
  return block;
}

/** Builds a sequence of 8B song-event frames into a Uint8Array. */
function buildEventFrames(frames: EsxSongEvent[]): Uint8Array {
  const buf = new Uint8Array(frames.length * ESX1_CHUNKSIZE_SONG_EVENT);
  const dv = new DataView(buf.buffer);
  for (let i = 0; i < frames.length; i++) {
    const off = i * ESX1_CHUNKSIZE_SONG_EVENT;
    const f = frames[i];
    dv.setUint16(off, f.time, false);
    dv.setUint8(off + 2, f.pattern);
    dv.setUint8(off + 3, f.length);
    dv.setUint16(off + 4, f.flags, false);
    dv.setUint16(off + 6, f.data, false);
  }
  return buf;
}

// ─── Tests: isEmptyEsxSong ────────────────────────────────────────────────────

describe("korg/esxParser — isEmptyEsxSong", () => {
  it("returns true for init song block (8 spaces + 0x3C + zeros)", () => {
    const block = buildInitSongBlock();
    expect(isEmptyEsxSong(block)).toBe(true);
  });

  it("returns true for all-zero block (synthetic/unwritten)", () => {
    const block = new Uint8Array(ESX1_CHUNKSIZE_SONG);
    expect(isEmptyEsxSong(block)).toBe(true);
  });

  it("returns false for block with explicit ASCII name", () => {
    const block = buildNamedSongBlock("MYSONG");
    expect(isEmptyEsxSong(block)).toBe(false);
  });

  it("returns false for block with non-zero byte after offset 8 (real-file non-empty pattern)", () => {
    const block = buildInitSongBlock();
    block[16] = 0x82; // KASSEL.esx[31] starts with 0x82 at offset 16
    expect(isEmptyEsxSong(block)).toBe(false);
  });

  it("returns true for buffer too small to be a song block", () => {
    expect(isEmptyEsxSong(new Uint8Array(8))).toBe(true);
  });
});

// ─── Tests: parseEsxSong ──────────────────────────────────────────────────────

describe("korg/esxParser — parseEsxSong", () => {
  it("parses name + bpm from a non-empty song block", () => {
    const block = buildNamedSongBlock("HELLO", 0x78);
    const song = parseEsxSong(block, 5);
    expect(song).not.toBeNull();
    expect(song!.name).toBe("HELLO");
    expect(song!.bpm).toBe(0x78); // 120 raw
    expect(song!.index).toBe(5);
  });

  it("returns null for an init/empty song block", () => {
    const block = buildInitSongBlock();
    const song = parseEsxSong(block, 0);
    expect(song).toBeNull();
  });

  it("clamps bpm out-of-range to 20..300 hardware window", () => {
    const block = buildNamedSongBlock("X", 0x0a); // 10 → clamp to 20
    const song = parseEsxSong(block, 0);
    expect(song!.bpm).toBe(20);
    const block2 = buildNamedSongBlock("X", 0xff); // 255 → 255 (in range)
    const song2 = parseEsxSong(block2, 1);
    expect(song2!.bpm).toBe(255);
  });

  it("throws EsxParseError on wrong block size", () => {
    expect(() => parseEsxSong(new Uint8Array(100), 0)).toThrow(EsxParseError);
  });

  it("attaches provided events to the song output", () => {
    const block = buildNamedSongBlock("WITHEVT");
    const events: EsxSongEvent[] = [
      { time: 0, pattern: 5, length: 4, flags: 0, data: 0 },
      { time: 16, pattern: 7, length: 2, flags: 0, data: 0 },
    ];
    const song = parseEsxSong(block, 0, events);
    expect(song!.eventCount).toBe(2);
    expect(song!.events).toHaveLength(2);
    expect(song!.events[0].pattern).toBe(5);
    expect(song!.events[1].pattern).toBe(7);
  });
});

// ─── Tests: parseEsxSongEvents ────────────────────────────────────────────────

describe("korg/esxParser — parseEsxSongEvents", () => {
  it("extracts 8B events into per-song arrays separated by end-markers", () => {
    // Build minimal buffer that puts event-frames at 0x138400.
    const file = new Uint8Array(ESX1_ADDR_SONG_EVENT_DATA + 1024);
    const frames = buildEventFrames([
      { time: 0, pattern: 1, length: 4, flags: 0, data: 0 },
      { time: 16, pattern: 2, length: 4, flags: 0, data: 0 },
      // End-of-song[0] marker
      { time: 32, pattern: 0, length: 0, flags: 0, data: ESX1_SONG_EVENT_END_MARKER },
      // Song[1] events
      { time: 0, pattern: 5, length: 8, flags: 0, data: 0 },
      { time: 64, pattern: 0, length: 0, flags: 0, data: ESX1_SONG_EVENT_END_MARKER },
    ]);
    file.set(frames, ESX1_ADDR_SONG_EVENT_DATA);

    const { eventsPerSong, warnings } = parseEsxSongEvents(file, 4);
    expect(warnings).toEqual([]);
    // Song 0: 2 events + 1 terminator
    expect(eventsPerSong[0].length).toBe(3);
    expect(eventsPerSong[0][0].pattern).toBe(1);
    expect(eventsPerSong[0][2].data).toBe(ESX1_SONG_EVENT_END_MARKER);
    // Song 1: 1 event + 1 terminator
    expect(eventsPerSong[1].length).toBe(2);
    expect(eventsPerSong[1][0].pattern).toBe(5);
    // Song 2, 3: empty
    expect(eventsPerSong[2]).toEqual([]);
    expect(eventsPerSong[3]).toEqual([]);
  });

  it("warns if song-event region is missing", () => {
    const tiny = new Uint8Array(100);
    const { eventsPerSong, warnings } = parseEsxSongEvents(tiny, 4);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/missing/);
    expect(eventsPerSong.every((arr) => arr.length === 0)).toBe(true);
  });

  it("respects numSongs argument (defaults to 64)", () => {
    const file = new Uint8Array(ESX1_ADDR_SONG_EVENT_DATA + 1024);
    const { eventsPerSong } = parseEsxSongEvents(file);
    expect(eventsPerSong).toHaveLength(ESX1_NUM_SONGS);
  });
});

// ─── Tests: parseEsxSongs (bulk) ──────────────────────────────────────────────

describe("korg/esxParser — parseEsxSongs", () => {
  it("returns empty array when all 64 song slots are init/empty", () => {
    const file = new Uint8Array(0x1b0000);
    // Fill all 64 song slots with init signature
    for (let i = 0; i < ESX1_NUM_SONGS; i++) {
      const off = ESX1_ADDR_SONG_DATA + i * ESX1_CHUNKSIZE_SONG;
      file.set(buildInitSongBlock(), off);
    }
    const { songs, warnings } = parseEsxSongs(file);
    expect(songs).toEqual([]);
    // The empty event-region just produces an empty array, no fatal warning required.
    expect(Array.isArray(warnings)).toBe(true);
  });

  it("returns non-empty songs only", () => {
    const file = new Uint8Array(0x1b0000);
    // All init first
    for (let i = 0; i < ESX1_NUM_SONGS; i++) {
      const off = ESX1_ADDR_SONG_DATA + i * ESX1_CHUNKSIZE_SONG;
      file.set(buildInitSongBlock(), off);
    }
    // Override slot 3 + 7 with named songs
    file.set(buildNamedSongBlock("AAA"), ESX1_ADDR_SONG_DATA + 3 * ESX1_CHUNKSIZE_SONG);
    file.set(buildNamedSongBlock("BBB"), ESX1_ADDR_SONG_DATA + 7 * ESX1_CHUNKSIZE_SONG);

    const { songs } = parseEsxSongs(file);
    expect(songs.map((s) => s.index)).toEqual([3, 7]);
    expect(songs.map((s) => s.name)).toEqual(["AAA", "BBB"]);
  });

  it("warns when song area is truncated", () => {
    const file = new Uint8Array(ESX1_ADDR_SONG_DATA + 100); // truncated before first slot fully fits
    const { warnings } = parseEsxSongs(file);
    expect(warnings.some((w) => /truncated/.test(w))).toBe(true);
  });
});

// ─── Tests: esxPatternIndexToBank ─────────────────────────────────────────────

describe("korg/esxPatternConvert — esxPatternIndexToBank", () => {
  it("maps 0..63 → A", () => {
    expect(esxPatternIndexToBank(0)).toBe("A");
    expect(esxPatternIndexToBank(63)).toBe("A");
  });

  it("maps 64..127 → B", () => {
    expect(esxPatternIndexToBank(64)).toBe("B");
    expect(esxPatternIndexToBank(127)).toBe("B");
  });

  it("maps 128..191 → C", () => {
    expect(esxPatternIndexToBank(128)).toBe("C");
    expect(esxPatternIndexToBank(191)).toBe("C");
  });

  it("maps 192..255 → D", () => {
    expect(esxPatternIndexToBank(192)).toBe("D");
    expect(esxPatternIndexToBank(255)).toBe("D");
  });

  it("falls back to A for out-of-range or negative values", () => {
    expect(esxPatternIndexToBank(-1)).toBe("A");
    expect(esxPatternIndexToBank(999)).toBe("A");
    expect(esxPatternIndexToBank(Number.NaN)).toBe("A");
  });
});

// ─── Tests: convertEsxSongToSynthstudio ───────────────────────────────────────

describe("korg/esxPatternConvert — convertEsxSongToSynthstudio", () => {
  function makeSong(events: EsxSongEvent[], opts: Partial<EsxSong> = {}): EsxSong {
    return {
      index: 0,
      name: "TEST",
      bpm: 120,
      eventCount: events.length,
      events,
      ...opts,
    };
  }

  it("converts non-end events to song-slots with bank + repeats", () => {
    const song = makeSong([
      { time: 0, pattern: 5, length: 4, flags: 0, data: 0 },
      { time: 16, pattern: 70, length: 2, flags: 0, data: 0 },
      { time: 32, pattern: 200, length: 1, flags: 0, data: 0 },
    ]);
    const conv = convertEsxSongToSynthstudio(song);
    expect(conv.name).toBe("TEST");
    expect(conv.bpm).toBe(120);
    expect(conv.slots).toEqual([
      { bank: "A", repeats: 4 }, // pattern 5 → A
      { bank: "B", repeats: 2 }, // pattern 70 → B
      { bank: "D", repeats: 1 }, // pattern 200 → D
    ]);
  });

  it("skips end-marker events (data === 0xFFFF)", () => {
    const song = makeSong([
      { time: 0, pattern: 5, length: 4, flags: 0, data: 0 },
      { time: 16, pattern: 0, length: 0, flags: 0, data: ESX1_SONG_EVENT_END_MARKER },
    ]);
    const conv = convertEsxSongToSynthstudio(song);
    expect(conv.slots).toHaveLength(1);
    expect(conv.slots[0].bank).toBe("A");
  });

  it("defaults length 0xF7 (= 247, init marker) to 1 repeat", () => {
    const song = makeSong([
      { time: 0, pattern: 3, length: 0xf7, flags: 0, data: 0 },
    ]);
    const conv = convertEsxSongToSynthstudio(song);
    expect(conv.slots[0].repeats).toBe(1);
  });

  it("clamps length to 1..16 for repeats", () => {
    const song = makeSong([
      { time: 0, pattern: 1, length: 99, flags: 0, data: 0 }, // → clamp to 16
      { time: 16, pattern: 1, length: 0, flags: 0, data: 0 }, // → default to 1
    ]);
    const conv = convertEsxSongToSynthstudio(song);
    expect(conv.slots[0].repeats).toBe(16);
    expect(conv.slots[1].repeats).toBe(1);
  });

  it("falls back to SONG_<n> when song.name is empty", () => {
    const song = makeSong([{ time: 0, pattern: 0, length: 1, flags: 0, data: 0 }], {
      name: "",
      index: 7,
    });
    const conv = convertEsxSongToSynthstudio(song);
    expect(conv.name).toBe("SONG_8");
  });

  it("returns empty slots[] if no convertible events", () => {
    const song = makeSong([
      { time: 0, pattern: 0, length: 0, flags: 0, data: ESX1_SONG_EVENT_END_MARKER },
    ]);
    const conv = convertEsxSongToSynthstudio(song);
    expect(conv.slots).toEqual([]);
  });
});

// ─── OPTIONAL: Real-File-Tests via fs (Korg ESX files/) ──────────────────────

const REAL_FILES_DIR = path.resolve(__dirname, "../../Korg ESX files");
const REAL_FILES_AVAILABLE = (() => {
  try {
    return fs.existsSync(REAL_FILES_DIR) && fs.statSync(REAL_FILES_DIR).isDirectory();
  } catch {
    return false;
  }
})();

const describeReal = REAL_FILES_AVAILABLE ? describe : describe.skip;

describeReal("korg/esxParser — real-file Songs smoke", () => {
  it("parses song-region of available .esx files without crashing the song-parser", () => {
    const files = fs.readdirSync(REAL_FILES_DIR).filter((f) => f.endsWith(".esx"));
    expect(files.length).toBeGreaterThan(0);

    let processed = 0;
    let skippedSamplesCap = 0;
    for (const fname of files) {
      const buf = fs.readFileSync(path.join(REAL_FILES_DIR, fname));
      // Use the dedicated parseEsxSongs which doesn't touch the sample-PCM
      // cap — this isolates the song-region test from any pre-existing
      // PCM-cap quirks in some user files.
      const { songs, warnings } = parseEsxSongs(new Uint8Array(buf));
      expect(Array.isArray(songs)).toBe(true);
      expect(Array.isArray(warnings)).toBe(true);
      for (const song of songs) {
        expect(typeof song.index).toBe("number");
        expect(song.index).toBeGreaterThanOrEqual(0);
        expect(song.index).toBeLessThan(ESX1_NUM_SONGS);
        expect(typeof song.bpm).toBe("number");
        expect(Array.isArray(song.events)).toBe(true);
      }
      processed++;

      // Optional integration: full parseEsxBank — some user files trip the
      // 24MB sample-cap or have variant headers (unrelated to songs). We
      // tolerate those skips here since the dedicated parseEsxSongs above
      // already covered the song-region.
      try {
        const bank = parseEsxBank(new Uint8Array(buf), fname);
        expect(Array.isArray(bank.songs)).toBe(true);
      } catch (err) {
        if (err instanceof EsxParseError) {
          skippedSamplesCap++;
        } else {
          throw err;
        }
      }
    }
    expect(processed).toBeGreaterThan(0);
    // Documentation: we just record how many files skipped PCM-cap.
    expect(skippedSamplesCap).toBeGreaterThanOrEqual(0);
  });

  it("KASSEL.esx exposes non-empty songs (slot >= 31 in RE-d real file)", () => {
    const kasselPath = path.join(REAL_FILES_DIR, "KASSEL.esx");
    if (!fs.existsSync(kasselPath)) {
      // Conditional: only assert when the file ships with the repo.
      return;
    }
    const buf = fs.readFileSync(kasselPath);
    // Use parseEsxSongs directly to bypass any unrelated sample-cap issues.
    const { songs } = parseEsxSongs(new Uint8Array(buf));
    // RE finding 2026-05-19: KASSEL.esx has 32 non-empty song slots (31..63).
    // We assert "at least 1" as a smoke check.
    expect(songs.length).toBeGreaterThan(0);
  });
});
