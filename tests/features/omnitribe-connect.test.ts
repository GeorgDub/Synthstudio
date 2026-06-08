/**
 * tests/features/omnitribe-connect.test.ts
 *
 * Coverage für describeOmniTribeConnect — die Pure-Logik hinter dem
 * sichtbaren Connect-Feedback (Synth.md: "Connect passiert nichts").
 */
import { describe, it, expect } from "vitest";
import {
  describeOmniTribeConnect,
  listMidiDevices,
  type OmniTribeConnectInput,
} from "../../client/src/utils/omnitribeConnect";

const base: OmniTribeConnectInput = {
  webMidiSupported: true,
  connected: false,
  inputNames: [],
  outputNames: [],
};

describe("describeOmniTribeConnect", () => {
  it("Happy Path: connected → ok=true mit Erfolgsmeldung", () => {
    const r = describeOmniTribeConnect({ ...base, connected: true });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/Verbunden/);
  });

  it("kein Web-MIDI → handlungsleitende Browser-Meldung", () => {
    const r = describeOmniTribeConnect({ ...base, webMidiSupported: false });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Web-MIDI/);
  });

  it("Permission verweigert → Sysex-Hinweis", () => {
    const r = describeOmniTribeConnect({ ...base, permissionDenied: true });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Sysex/);
  });

  it("keine Geräte → USB-Hinweis", () => {
    const r = describeOmniTribeConnect(base);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Keine MIDI-Geräte/);
  });

  it("Edge Case: Geräte vorhanden aber kein Match → listet Geräte auf", () => {
    const r = describeOmniTribeConnect({
      ...base,
      inputNames: ["Some Synth In"],
      outputNames: ["Some Synth Out"],
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Some Synth In/);
    expect(r.message).toMatch(/Some Synth Out/);
  });

  it("priorisiert Web-MIDI-Fehlen vor Geräte-Check", () => {
    const r = describeOmniTribeConnect({
      ...base,
      webMidiSupported: false,
      inputNames: ["X"],
    });
    expect(r.message).toMatch(/Web-MIDI/);
  });
});

describe("listMidiDevices", () => {
  it("merged In+Out, dedupliziert, sortiert", () => {
    expect(
      listMidiDevices({
        inputNames: ["Beta", "Alpha"],
        outputNames: ["Alpha", "Gamma"],
      }),
    ).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("filtert leere/whitespace-Namen", () => {
    expect(
      listMidiDevices({ inputNames: ["  ", "Real"], outputNames: [""] }),
    ).toEqual(["Real"]);
  });

  it("leere Eingabe → leeres Array", () => {
    expect(listMidiDevices({ inputNames: [], outputNames: [] })).toEqual([]);
  });
});
