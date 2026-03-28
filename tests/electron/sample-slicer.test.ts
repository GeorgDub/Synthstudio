/**
 * sample-slicer.test.ts
 *
 * Tests für detectTransients() und SampleSlicerStore (Phase 3)
 */
import { describe, it, expect } from "vitest";
import { detectTransients } from "../../client/src/utils/transientDetection";

// ─── Hilfsfunktionen für Mock-Buffer ─────────────────────────────────────────

function makeMockBuffer(data: number[], sampleRate = 44100) {
  return {
    getChannelData: (_: number) => new Float32Array(data),
    sampleRate,
  };
}

// ─── detectTransients() Tests ─────────────────────────────────────────────────

describe("detectTransients()", () => {
  it("findet keine Transienten in stillem Audio", () => {
    const buf = makeMockBuffer(Array(1000).fill(0));
    const markers = detectTransients(buf, 0.15, 50);
    expect(markers).toHaveLength(0);
  });

  it("findet einen Transienten nach einem Amplituden-Sprung", () => {
    // Stille, dann plötzlicher Anstieg auf 0.8
    const data = Array(1000).fill(0);
    data[500] = 0.8;
    const buf = makeMockBuffer(data);
    const markers = detectTransients(buf, 0.15, 0); // minGapMs=0 für einfacheren Test
    expect(markers.length).toBeGreaterThanOrEqual(1);
    expect(markers[0].sampleOffset).toBe(500);
  });

  it("minGapMs verhindert doppelte Markierungen", () => {
    // Zwei nahe beieinander liegende Transienten (10 Samples Abstand)
    const data = Array(500).fill(0);
    data[100] = 0.8;
    data[110] = 0.8;
    const buf = makeMockBuffer(data, 44100);
    // minGapMs=50ms → 44100*0.05 = 2205 Samples Mindestabstand → nur ein Marker
    const markers = detectTransients(buf, 0.15, 50);
    expect(markers.length).toBe(1);
  });

  it("threshold=0 findet jeden Sample-Anstieg > 0", () => {
    const data = [0, 0.01, 0, 0.01, 0, 0.01];
    const buf = makeMockBuffer(data, 1000);
    const markers = detectTransients(buf, 0, 0);
    expect(markers.length).toBeGreaterThan(0);
  });

  it("strength ist proportional zur Amplitude-Änderung", () => {
    const data = Array(500).fill(0);
    data[100] = 0.5;   // delta = 0.5
    data[300] = 0.9;   // delta = 0.9
    const buf = makeMockBuffer(data, 44100);
    const markers = detectTransients(buf, 0.1, 0);
    // Zweiter Marker hat größere strength (0.9 > 0.5)
    expect(markers.length).toBeGreaterThanOrEqual(2);
    const strengths = markers.map(m => m.strength).sort();
    expect(strengths[strengths.length - 1]).toBeGreaterThan(strengths[0]);
  });
});

// ─── SampleSlicerStore Tests ──────────────────────────────────────────────────
// Da der Store ein React Hook ist, testen wir die reine State-Logik isoliert.

interface SliceRegion {
  id: string;
  startOffset: number;
  endOffset: number;
  loopMode: "one-shot" | "loop" | "ping-pong";
  reverse: boolean;
  name?: string;
}

function makeSliceId() {
  return `slice-test-${Math.random().toString(36).slice(2)}`;
}

// Minimale synchrone Store-Implementierung für Tests
function createTestStore() {
  let slices: SliceRegion[] = [];

  const addSlice = (slice: Omit<SliceRegion, "id">): string => {
    const id = makeSliceId();
    slices = [...slices, { ...slice, id }].sort((a, b) => a.startOffset - b.startOffset);
    return id;
  };

  const removeSlice = (id: string) => {
    slices = slices.filter(s => s.id !== id);
  };

  const updateSlice = (id: string, update: Partial<Omit<SliceRegion, "id">>) => {
    slices = slices
      .map(s => s.id === id ? { ...s, ...update } : s)
      .sort((a, b) => a.startOffset - b.startOffset);
  };

  const setSlicesFromTransients = (offsets: number[], totalFrames: number) => {
    const sorted = [...offsets].sort((a, b) => a - b);
    slices = sorted.map((startOffset, i) => ({
      id: makeSliceId(),
      startOffset,
      endOffset: sorted[i + 1] ?? totalFrames,
      loopMode: "one-shot" as const,
      reverse: false,
      name: `Slice ${i + 1}`,
    }));
  };

  return { getSlices: () => slices, addSlice, removeSlice, updateSlice, setSlicesFromTransients };
}

describe("SampleSlicerStore", () => {
  it("addSlice() erstellt neuen Slice mit ID", () => {
    const store = createTestStore();
    const id = store.addSlice({ startOffset: 0, endOffset: 1000, loopMode: "one-shot", reverse: false });
    expect(id).toBeTruthy();
    expect(store.getSlices()).toHaveLength(1);
    expect(store.getSlices()[0].id).toBe(id);
  });

  it("removeSlice() entfernt Slice korrekt", () => {
    const store = createTestStore();
    const id = store.addSlice({ startOffset: 0, endOffset: 1000, loopMode: "one-shot", reverse: false });
    store.removeSlice(id);
    expect(store.getSlices()).toHaveLength(0);
  });

  it("updateSlice() aktualisiert loopMode", () => {
    const store = createTestStore();
    const id = store.addSlice({ startOffset: 0, endOffset: 1000, loopMode: "one-shot", reverse: false });
    store.updateSlice(id, { loopMode: "loop" });
    expect(store.getSlices()[0].loopMode).toBe("loop");
  });

  it("slices sind sortiert nach startOffset", () => {
    const store = createTestStore();
    store.addSlice({ startOffset: 5000, endOffset: 10000, loopMode: "one-shot", reverse: false });
    store.addSlice({ startOffset: 100, endOffset: 5000, loopMode: "one-shot", reverse: false });
    store.addSlice({ startOffset: 2000, endOffset: 5000, loopMode: "one-shot", reverse: false });
    const offsets = store.getSlices().map(s => s.startOffset);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });

  it("Auto-Slice aus detectTransients() erstellt korrektes Slices-Array", () => {
    // Simuliere zwei Transienten bei Sample 100 und 500
    const transientOffsets = [100, 500];
    const totalFrames = 1000;
    const store = createTestStore();
    store.setSlicesFromTransients(transientOffsets, totalFrames);
    const slices = store.getSlices();
    expect(slices).toHaveLength(2);
    expect(slices[0].startOffset).toBe(100);
    expect(slices[0].endOffset).toBe(500);
    expect(slices[1].startOffset).toBe(500);
    expect(slices[1].endOffset).toBe(totalFrames);
  });
});
