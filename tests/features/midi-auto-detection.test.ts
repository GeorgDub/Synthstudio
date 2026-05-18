/**
 * tests/features/midi-auto-detection.test.ts (v3.24.0)
 *
 * Tests fuer Hardware-Auto-Detection-Pfad:
 *   - detectTemplateFromDeviceName Pure-Helper
 *   - detectTemplatesFromDeviceList (Listen-Dedupe + Never-Filter)
 *   - Never-List Persistenz (localStorage)
 *   - Auto-Detection Master-Toggle
 *   - dispatchTemplateSuggestion (gated by Toggle + Never-List)
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  detectTemplateFromDeviceName,
  detectTemplatesFromDeviceList,
  isAutoDetectionEnabled,
  setAutoDetectionEnabled,
  addToNeverList,
  isInNeverList,
  removeFromNeverList,
  loadNeverList,
  clearNeverList,
  dispatchTemplateSuggestion,
  MIDI_TEMPLATE_SUGGESTED_EVENT,
  DEVICE_NAME_PATTERNS,
  type MidiTemplateSuggestedDetail,
} from "../../client/src/utils/midiDeviceDetection";
import { listTemplateIds } from "../../client/src/utils/midiTemplates";

beforeEach(() => {
  // Frische localStorage-Welt pro Test (Vitest-jsdom)
  window.localStorage.clear();
});

describe("midiDeviceDetection — detectTemplateFromDeviceName", () => {
  it("erkennt nanoKONTROL2 case-insensitive", () => {
    const m = detectTemplateFromDeviceName("nanoKONTROL2");
    expect(m).not.toBeNull();
    expect(m!.templateId).toBe("nanokontrol2");
    expect(m!.deviceName).toBe("nanoKONTROL2");
  });

  it("case-insensitive Match (lowercase Variante)", () => {
    const m = detectTemplateFromDeviceName("nanokontrol2");
    expect(m).not.toBeNull();
    expect(m!.templateId).toBe("nanokontrol2");
  });

  it("erkennt Launchpad MK2 + MK3 + Mini MK3", () => {
    expect(detectTemplateFromDeviceName("Launchpad MK2")?.templateId).toBe("launchpad-mk2");
    expect(detectTemplateFromDeviceName("Launchpad MK3")?.templateId).toBe("launchpad-mk2");
    expect(detectTemplateFromDeviceName("Launchpad Mini MK3")?.templateId).toBe("launchpad-mk2");
  });

  it("erkennt Push 2", () => {
    expect(detectTemplateFromDeviceName("Ableton Push 2")?.templateId).toBe("push-2");
    expect(detectTemplateFromDeviceName("Push 2")?.templateId).toBe("push-2");
  });

  it("erkennt MPC One + MPC Live", () => {
    expect(detectTemplateFromDeviceName("Akai MPC One")?.templateId).toBe("mpc-one");
    expect(detectTemplateFromDeviceName("MPC Live II")?.templateId).toBe("mpc-one");
  });

  it("erkennt Maschine Mikro", () => {
    expect(detectTemplateFromDeviceName("Maschine Mikro MK3")?.templateId).toBe("maschine-mikro");
  });

  it("erkennt MPK Mini MK3", () => {
    expect(detectTemplateFromDeviceName("MPK Mini MK3")?.templateId).toBe("mpk-mini-mk3");
  });

  it("erkennt X-Touch Mini + XTOUCH MINI Schreibweise", () => {
    expect(detectTemplateFromDeviceName("X-TOUCH MINI")?.templateId).toBe("behringer-x-touch-mini");
    expect(detectTemplateFromDeviceName("XTOUCH MINI")?.templateId).toBe("behringer-x-touch-mini");
  });

  it("erkennt padKONTROL + Volca Beats + Electribe 2", () => {
    expect(detectTemplateFromDeviceName("padKONTROL")?.templateId).toBe("korg-padkontrol");
    expect(detectTemplateFromDeviceName("Volca Beats")?.templateId).toBe("korg-volca-beats");
    expect(detectTemplateFromDeviceName("Electribe 2")?.templateId).toBe("korg-electribe-2");
    expect(detectTemplateFromDeviceName("electribe sampler")?.templateId).toBe("korg-electribe-2");
  });

  it("erkennt Roland TR-8 + Behringer RD-8", () => {
    expect(detectTemplateFromDeviceName("TR-8S")?.templateId).toBe("roland-tr-8");
    expect(detectTemplateFromDeviceName("Roland TR-8")?.templateId).toBe("roland-tr-8");
    expect(detectTemplateFromDeviceName("Behringer RD-8")?.templateId).toBe("roland-tr-8");
  });

  it("erkennt BeatStep Pro + Digitakt", () => {
    expect(detectTemplateFromDeviceName("Arturia BeatStep Pro")?.templateId).toBe("arturia-beatstep-pro");
    expect(detectTemplateFromDeviceName("Elektron Digitakt")?.templateId).toBe("elektron-digitakt");
  });

  it("Unknown device returns null", () => {
    expect(detectTemplateFromDeviceName("Random USB Device 1234")).toBeNull();
    expect(detectTemplateFromDeviceName("Bluetooth MIDI")).toBeNull();
  });

  it("null / undefined / empty / whitespace-only liefern null", () => {
    expect(detectTemplateFromDeviceName(null)).toBeNull();
    expect(detectTemplateFromDeviceName(undefined)).toBeNull();
    expect(detectTemplateFromDeviceName("")).toBeNull();
    expect(detectTemplateFromDeviceName("   ")).toBeNull();
  });

  it("trimmt whitespace bevor Match versucht wird", () => {
    const m = detectTemplateFromDeviceName("   nanoKONTROL2   ");
    expect(m).not.toBeNull();
    expect(m!.deviceName).toBe("nanoKONTROL2");
  });

  it("DEVICE_NAME_PATTERNS verweisen nur auf existierende Template-IDs", () => {
    const validIds = new Set(listTemplateIds());
    DEVICE_NAME_PATTERNS.forEach(entry => {
      expect(validIds.has(entry.templateId)).toBe(true);
    });
  });
});

describe("midiDeviceDetection — detectTemplatesFromDeviceList", () => {
  it("filtert null/unbekannte Devices raus", () => {
    const matches = detectTemplatesFromDeviceList([
      "nanoKONTROL2",
      "Random Device",
      null,
      undefined,
      "Push 2",
    ]);
    expect(matches).toHaveLength(2);
    expect(matches.map(m => m.templateId).sort()).toEqual(["nanokontrol2", "push-2"]);
  });

  it("dedupliziert wenn Device 2× erscheint (Input + Output mit gleichem Namen)", () => {
    const matches = detectTemplatesFromDeviceList([
      "nanoKONTROL2",
      "nanoKONTROL2", // Output-Eintrag desselben Geräts
    ]);
    expect(matches).toHaveLength(1);
  });

  it("Never-List verhindert dass Device gemeldet wird", () => {
    const neverList = new Set(["nanoKONTROL2"]);
    const matches = detectTemplatesFromDeviceList([
      "nanoKONTROL2",
      "Push 2",
    ], neverList);
    expect(matches).toHaveLength(1);
    expect(matches[0].templateId).toBe("push-2");
  });

  it("liefert leeres Array wenn keine Devices matchen", () => {
    expect(detectTemplatesFromDeviceList(["foo", "bar"])).toEqual([]);
    expect(detectTemplatesFromDeviceList([])).toEqual([]);
  });
});

describe("midiDeviceDetection — Never-List Persistenz", () => {
  it("addToNeverList persistiert in localStorage", () => {
    addToNeverList("nanoKONTROL2");
    expect(isInNeverList("nanoKONTROL2")).toBe(true);
    // Frischer Load liest aus localStorage
    const list = loadNeverList();
    expect(list.has("nanoKONTROL2")).toBe(true);
  });

  it("removeFromNeverList entfernt Eintrag", () => {
    addToNeverList("Push 2");
    expect(isInNeverList("Push 2")).toBe(true);
    removeFromNeverList("Push 2");
    expect(isInNeverList("Push 2")).toBe(false);
  });

  it("clearNeverList loescht alles", () => {
    addToNeverList("A");
    addToNeverList("B");
    clearNeverList();
    expect(loadNeverList().size).toBe(0);
  });

  it("korrupter localStorage-Inhalt liefert leere Liste (defensiv)", () => {
    window.localStorage.setItem("synthstudio:midi-auto-detect:never:v1", "{invalid json");
    expect(loadNeverList().size).toBe(0);
  });

  it("non-array JSON-Inhalt liefert leere Liste", () => {
    window.localStorage.setItem("synthstudio:midi-auto-detect:never:v1", JSON.stringify({ foo: "bar" }));
    expect(loadNeverList().size).toBe(0);
  });
});

describe("midiDeviceDetection — Auto-Detection Toggle", () => {
  it("Default ist ON (true)", () => {
    expect(isAutoDetectionEnabled()).toBe(true);
  });

  it("setAutoDetectionEnabled(false) persistiert und wirkt", () => {
    setAutoDetectionEnabled(false);
    expect(isAutoDetectionEnabled()).toBe(false);
  });

  it("setAutoDetectionEnabled(true) re-enabled", () => {
    setAutoDetectionEnabled(false);
    setAutoDetectionEnabled(true);
    expect(isAutoDetectionEnabled()).toBe(true);
  });
});

describe("midiDeviceDetection — dispatchTemplateSuggestion", () => {
  function withListener(fn: (received: MidiTemplateSuggestedDetail[]) => void) {
    const received: MidiTemplateSuggestedDetail[] = [];
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<MidiTemplateSuggestedDetail>).detail;
      if (detail) received.push(detail);
    };
    window.addEventListener(MIDI_TEMPLATE_SUGGESTED_EVENT, handler);
    try {
      fn(received);
    } finally {
      window.removeEventListener(MIDI_TEMPLATE_SUGGESTED_EVENT, handler);
    }
  }

  it("feuert CustomEvent mit korrektem Detail", () => {
    withListener(received => {
      const ok = dispatchTemplateSuggestion({
        deviceName: "nanoKONTROL2",
        templateId: "nanokontrol2",
        displayName: "Korg nanoKONTROL2",
      });
      expect(ok).toBe(true);
      expect(received).toHaveLength(1);
      expect(received[0].deviceName).toBe("nanoKONTROL2");
      expect(received[0].templateId).toBe("nanokontrol2");
      expect(received[0].displayName).toBe("Korg nanoKONTROL2");
    });
  });

  it("NO-OP wenn Auto-Detection disabled", () => {
    setAutoDetectionEnabled(false);
    withListener(received => {
      const ok = dispatchTemplateSuggestion({
        deviceName: "nanoKONTROL2",
        templateId: "nanokontrol2",
        displayName: "Korg nanoKONTROL2",
      });
      expect(ok).toBe(false);
      expect(received).toHaveLength(0);
    });
  });

  it("NO-OP wenn Device in Never-List", () => {
    addToNeverList("nanoKONTROL2");
    withListener(received => {
      const ok = dispatchTemplateSuggestion({
        deviceName: "nanoKONTROL2",
        templateId: "nanokontrol2",
        displayName: "Korg nanoKONTROL2",
      });
      expect(ok).toBe(false);
      expect(received).toHaveLength(0);
    });
  });

  it("End-to-End: Detection → Dispatch fuer mehrere Devices", () => {
    withListener(received => {
      const matches = detectTemplatesFromDeviceList(["nanoKONTROL2", "Push 2"]);
      matches.forEach(m => dispatchTemplateSuggestion(m));
      expect(received).toHaveLength(2);
      expect(received.map(r => r.templateId).sort()).toEqual(["nanokontrol2", "push-2"]);
    });
  });
});
