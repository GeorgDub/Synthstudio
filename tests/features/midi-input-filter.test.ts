/**
 * midi-input-filter.test.ts — v3.269.0
 *
 * Deckt den MIDI-Eingangsfilter ab: die reine Entscheidungslogik
 * (`utils/midiInputFilter.ts`) und den Store samt Persistenz
 * (`store/useMidiInputFilterStore.ts`).
 *
 * Leitfall aus der Praxis: Korg Electribe und ein Fader-Controller hängen
 * gleichzeitig am Rechner. Auf der Korg wird gespielt, ihr Rückkanal soll
 * Synthstudio nicht verstellen — der Controller muss weiter durchkommen.
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock (Node-Environment hat keinen) ────────────────────────
function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => store[k] ?? null,
    setItem: (k: string, v: string): void => { store[k] = v; },
    removeItem: (k: string): void => { delete store[k]; },
    clear: (): void => { store = {}; },
  };
}
const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

import {
  allClassesEnabled,
  classifyMidiStatus,
  countBlockedClasses,
  describeMidiClass,
  isDeviceMuted,
  labelForMidiClass,
  MIDI_MESSAGE_CLASSES,
  shouldPassMidiMessage,
  toggleMutedDeviceName,
  type MidiInputFilterState,
} from "@/utils/midiInputFilter";
import {
  __reloadMidiInputFilterForTests,
  __resetMidiInputFilterForTests,
  getMidiInputFilterState,
  resetMidiInputFilter,
  setMidiInputClassEnabled,
  setMidiInputDeviceMuted,
  setMidiInputListenAll,
  setMidiInputMasterMute,
  toggleMidiInputClass,
  toggleMidiInputDeviceMute,
} from "@/store/useMidiInputFilterStore";

const STORAGE_KEY = "synthstudio:midi-input-filter:v1";

function baseState(patch: Partial<MidiInputFilterState> = {}): MidiInputFilterState {
  return {
    masterMute: false,
    listenAllInputs: true,
    mutedDeviceNames: [],
    classes: allClassesEnabled(),
    ...patch,
  };
}

// ─── classifyMidiStatus ─────────────────────────────────────────────────────

describe("classifyMidiStatus", () => {
  it("ordnet die Kanalnachrichten ihrer Klasse zu — unabhängig vom Kanal", () => {
    // Low-Nibble = Kanal und darf die Klassifikation nie beeinflussen.
    expect(classifyMidiStatus(0x90)).toBe("note");
    expect(classifyMidiStatus(0x9f)).toBe("note");
    expect(classifyMidiStatus(0x80)).toBe("note");
    expect(classifyMidiStatus(0xb3)).toBe("cc");
    expect(classifyMidiStatus(0xc0)).toBe("programChange");
    expect(classifyMidiStatus(0xe7)).toBe("pitchBend");
  });

  it("fasst beide Aftertouch-Arten zusammen", () => {
    expect(classifyMidiStatus(0xa0)).toBe("aftertouch"); // polyphon
    expect(classifyMidiStatus(0xd0)).toBe("aftertouch"); // channel
  });

  it("zählt Realtime und Song-Position zu Clock, Sysex separat", () => {
    for (const s of [0xf8, 0xfa, 0xfb, 0xfc, 0xfe, 0xff, 0xf1, 0xf2, 0xf3, 0xf6]) {
      expect(classifyMidiStatus(s)).toBe("clock");
    }
    expect(classifyMidiStatus(0xf0)).toBe("sysex");
    expect(classifyMidiStatus(0xf7)).toBe("sysex");
  });

  it("liefert null für Data-Bytes und Müll", () => {
    expect(classifyMidiStatus(0x00)).toBeNull();
    expect(classifyMidiStatus(0x7f)).toBeNull(); // höchstes Data-Byte
    expect(classifyMidiStatus(-1)).toBeNull();
    expect(classifyMidiStatus(0x100)).toBeNull();
    expect(classifyMidiStatus(Number.NaN)).toBeNull();
  });
});

// ─── shouldPassMidiMessage ──────────────────────────────────────────────────

describe("shouldPassMidiMessage", () => {
  it("lässt im Auslieferungszustand alles durch", () => {
    const st = baseState();
    for (const status of [0x90, 0xb0, 0xc0, 0xe0, 0xd0, 0xf8, 0xf0]) {
      expect(shouldPassMidiMessage(st, { status })).toBe(true);
    }
  });

  it("blockt bei masterMute ausnahmslos alles", () => {
    const st = baseState({ masterMute: true });
    expect(shouldPassMidiMessage(st, { status: 0x90 })).toBe(false);
    expect(shouldPassMidiMessage(st, { status: 0xf8 })).toBe(false);
    // Auch unbekannte Status-Bytes: Not-Aus ist Not-Aus.
    expect(shouldPassMidiMessage(st, { status: 0x00 })).toBe(false);
  });

  it("blockt ein gemutetes Gerät komplett, lässt andere Geräte durch", () => {
    const st = baseState({ mutedDeviceNames: ["Electribe 2"] });
    expect(shouldPassMidiMessage(st, { status: 0x90, deviceName: "Electribe 2" })).toBe(false);
    expect(shouldPassMidiMessage(st, { status: 0xb0, deviceName: "Electribe 2" })).toBe(false);
    expect(shouldPassMidiMessage(st, { status: 0x90, deviceName: "MIDI Mix" })).toBe(true);
  });

  it("blockt eine Klasse geräteübergreifend", () => {
    const st = baseState({ classes: { ...allClassesEnabled(), programChange: false } });
    expect(shouldPassMidiMessage(st, { status: 0xc0, deviceName: "Electribe 2" })).toBe(false);
    expect(shouldPassMidiMessage(st, { status: 0xc5, deviceName: "MIDI Mix" })).toBe(false);
    // Andere Klassen bleiben unberührt.
    expect(shouldPassMidiMessage(st, { status: 0x90 })).toBe(true);
  });

  it("löst den Leitfall: Korg stumm, Controller offen, Clock von beiden erlaubt", () => {
    const st = baseState({ mutedDeviceNames: ["Electribe 2"] });
    // Auf der Korg gespielte Note verstellt Synthstudio nicht …
    expect(shouldPassMidiMessage(st, { status: 0x90, deviceName: "Electribe 2" })).toBe(false);
    // … der Fader-Controller bedient weiter Melo-/Vocal-Lanes.
    expect(shouldPassMidiMessage(st, { status: 0xb0, deviceName: "MIDI Mix" })).toBe(true);
  });

  it("lässt unbekannte Status-Bytes durch statt sie zu verschlucken", () => {
    // Ein Filter, der Unbekanntes frisst, macht ungetestete Geräte kaputt.
    const st = baseState();
    expect(shouldPassMidiMessage(st, { status: 0x40 })).toBe(true);
    expect(shouldPassMidiMessage(st, { status: 0xf4 })).toBe(true);
  });

  it("ignoriert Groß/Kleinschreibung und Randleerzeichen im Gerätenamen", () => {
    const st = baseState({ mutedDeviceNames: ["  ELECTRIBE 2  "] });
    expect(shouldPassMidiMessage(st, { status: 0x90, deviceName: "electribe 2" })).toBe(false);
  });

  it("lässt durch, wenn der Port-Name fehlt", () => {
    // Nicht jeder Web-MIDI-Stack liefert einen Namen; ohne Namen darf nicht
    // versehentlich gemutet werden.
    const st = baseState({ mutedDeviceNames: ["Electribe 2"] });
    expect(shouldPassMidiMessage(st, { status: 0x90, deviceName: null })).toBe(true);
    expect(shouldPassMidiMessage(st, { status: 0x90 })).toBe(true);
  });
});

// ─── Hilfsfunktionen ────────────────────────────────────────────────────────

describe("isDeviceMuted", () => {
  it("erkennt exakte und normalisierte Treffer", () => {
    const st = { mutedDeviceNames: ["MIDI Mix"] };
    expect(isDeviceMuted(st, "MIDI Mix")).toBe(true);
    expect(isDeviceMuted(st, "midi mix")).toBe(true);
  });

  it("matcht NICHT unscharf — sonst würde man das falsche Gerät stummschalten", () => {
    const st = { mutedDeviceNames: ["MIDI Mix"] };
    expect(isDeviceMuted(st, "MIDIMIX")).toBe(false);
    expect(isDeviceMuted(st, "MIDI Mix 2")).toBe(false);
  });

  it("ist bei leerem/fehlendem Namen false", () => {
    const st = { mutedDeviceNames: ["MIDI Mix"] };
    expect(isDeviceMuted(st, "")).toBe(false);
    expect(isDeviceMuted(st, null)).toBe(false);
    expect(isDeviceMuted(st, undefined)).toBe(false);
  });
});

describe("toggleMutedDeviceName", () => {
  it("fügt hinzu und entfernt wieder (Round-Trip)", () => {
    const once = toggleMutedDeviceName([], "Electribe 2");
    expect(once).toEqual(["Electribe 2"]);
    expect(toggleMutedDeviceName(once, "Electribe 2")).toEqual([]);
  });

  it("entfernt auch bei abweichender Schreibweise", () => {
    expect(toggleMutedDeviceName(["Electribe 2"], "ELECTRIBE 2")).toEqual([]);
  });

  it("ignoriert leere Namen und lässt die Liste unverändert", () => {
    expect(toggleMutedDeviceName(["A"], "   ")).toEqual(["A"]);
  });
});

describe("countBlockedClasses", () => {
  it("zählt 0 im Auslieferungszustand", () => {
    expect(countBlockedClasses(allClassesEnabled())).toBe(0);
  });

  it("zählt jede geschlossene Klasse", () => {
    expect(countBlockedClasses({ ...allClassesEnabled(), note: false, clock: false })).toBe(2);
  });

  it("zählt bei komplett geschlossenem Filter alle Klassen", () => {
    const closed = Object.fromEntries(MIDI_MESSAGE_CLASSES.map((c) => [c, false]));
    expect(countBlockedClasses(closed as ReturnType<typeof allClassesEnabled>)).toBe(
      MIDI_MESSAGE_CLASSES.length,
    );
  });
});

describe("Beschriftungen", () => {
  it("liefert für jede Klasse ein nicht-leeres Label und eine Beschreibung", () => {
    for (const cls of MIDI_MESSAGE_CLASSES) {
      expect(labelForMidiClass(cls).length).toBeGreaterThan(0);
      expect(describeMidiClass(cls).length).toBeGreaterThan(0);
    }
  });
});

// ─── Store ──────────────────────────────────────────────────────────────────

describe("useMidiInputFilterStore", () => {
  beforeEach(() => {
    __resetMidiInputFilterForTests();
  });

  it("startet offen und im Multi-Input-Modus", () => {
    const st = getMidiInputFilterState();
    expect(st.masterMute).toBe(false);
    expect(st.mutedDeviceNames).toEqual([]);
    expect(countBlockedClasses(st.classes)).toBe(0);
    // Ohne Multi-Input könnte man Korg und Controller nicht parallel fahren.
    expect(st.listenAllInputs).toBe(true);
  });

  it("schaltet Klassen um und wieder zurück", () => {
    toggleMidiInputClass("programChange");
    expect(getMidiInputFilterState().classes.programChange).toBe(false);
    toggleMidiInputClass("programChange");
    expect(getMidiInputFilterState().classes.programChange).toBe(true);
  });

  it("schaltet Geräte per Name stumm und wieder frei", () => {
    toggleMidiInputDeviceMute("Electribe 2");
    expect(getMidiInputFilterState().mutedDeviceNames).toEqual(["Electribe 2"]);
    toggleMidiInputDeviceMute("electribe 2");
    expect(getMidiInputFilterState().mutedDeviceNames).toEqual([]);
  });

  it("setDeviceMuted ist idempotent", () => {
    setMidiInputDeviceMuted("Electribe 2", true);
    setMidiInputDeviceMuted("Electribe 2", true);
    expect(getMidiInputFilterState().mutedDeviceNames).toEqual(["Electribe 2"]);
    setMidiInputDeviceMuted("Electribe 2", false);
    expect(getMidiInputFilterState().mutedDeviceNames).toEqual([]);
  });

  it("persistiert nach localStorage und liest beim Laden zurück", () => {
    setMidiInputMasterMute(true);
    setMidiInputClassEnabled("clock", false);
    toggleMidiInputDeviceMute("Electribe 2");

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.masterMute).toBe(true);
    expect(parsed.classes.clock).toBe(false);
    expect(parsed.mutedDeviceNames).toEqual(["Electribe 2"]);
  });

  it("reset hebt Filter auf, behält aber die Multi-Input-Wahl", () => {
    setMidiInputListenAll(false);
    setMidiInputMasterMute(true);
    setMidiInputClassEnabled("note", false);
    toggleMidiInputDeviceMute("Electribe 2");

    resetMidiInputFilter();

    const st = getMidiInputFilterState();
    expect(st.masterMute).toBe(false);
    expect(st.mutedDeviceNames).toEqual([]);
    expect(countBlockedClasses(st.classes)).toBe(0);
    // Der Multi-Input-Schalter beschreibt die Verkabelung, nicht den Filter —
    // ein Reset des Filters darf ihn nicht mit umlegen.
    expect(st.listenAllInputs).toBe(false);
  });

  it("liest Persistiertes beim Laden wieder ein", () => {
    setMidiInputMasterMute(true);
    setMidiInputClassEnabled("clock", false);
    toggleMidiInputDeviceMute("Electribe 2");

    __reloadMidiInputFilterForTests();

    const st = getMidiInputFilterState();
    expect(st.masterMute).toBe(true);
    expect(st.classes.clock).toBe(false);
    expect(st.mutedDeviceNames).toEqual(["Electribe 2"]);
  });

  it("fällt bei kaputtem localStorage-Inhalt auf Defaults zurück statt zu werfen", () => {
    localStorage.setItem(STORAGE_KEY, "{nicht: json");
    expect(() => __reloadMidiInputFilterForTests()).not.toThrow();
    const st = getMidiInputFilterState();
    expect(st.masterMute).toBe(false);
    expect(countBlockedClasses(st.classes)).toBe(0);
  });

  it("ignoriert Müll in einzelnen Feldern und behält den Rest", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ masterMute: "ja", mutedDeviceNames: [1, "Korg", null], classes: { note: "nein", cc: false } }),
    );
    __reloadMidiInputFilterForTests();

    const st = getMidiInputFilterState();
    expect(st.masterMute).toBe(false);       // nur echtes true zählt
    expect(st.mutedDeviceNames).toEqual(["Korg"]); // Nicht-Strings raus
    expect(st.classes.note).toBe(true);      // "nein" ist kein Boolean → Default
    expect(st.classes.cc).toBe(false);       // echtes false wird übernommen
  });
});
