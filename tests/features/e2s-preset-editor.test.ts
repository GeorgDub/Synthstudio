// @vitest-environment jsdom
/**
 * Synthstudio – e2s-preset-editor.test.ts
 *
 * Der Feld-Editor für IFX/MFX-Presets war gebaut und verdrahtet, hatte aber
 * keinen einzigen Test. Er ist auch nicht der Grund, warum „FX Live Control
 * gar nichts tut" — das war das RAM-Lesen, das an der Antwort mit cmd 0x54
 * scheiterte (siehe `korg-ram-antwortrahmen.test.ts`). Der Editor bekam
 * schlicht nie Daten.
 *
 * ☠ Die Eigenschaft, an der hier alles hängt: **nur die adressierten Bytes
 * ändern.** Ein 0x20C-Preset enthält reichlich Bytes, deren Bedeutung niemand
 * kennt. Wer sie beim Schreiben „aufräumt", schickt Müll ins Gerät — und ein
 * kaputtes FX-Preset klingt einfach nur schlecht, ohne dass die Ursache
 * sichtbar wird. Deshalb wird hier nicht geprüft, ob der richtige Wert
 * ankommt, sondern ob AUSSER ihm nichts angefasst wurde.
 *
 * Das Layout selbst ist am 2026-08-11 am Gerät bestätigt: an 0xC00A80F0 stand
 * `\0Punch`, der Name liegt also bei Offset 0x01.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { E2sPresetEditor } from "../../client/src/components/E2sDevice/E2sPresetEditor";
import {
  IFX_PRESET_SIZE,
  decodeIfxPreset,
} from "../../client/src/utils/korg/e2FxPreset";
import {
  getE2sPresetState,
  __resetE2sPresetForTests,
} from "../../client/src/store/useE2sPresetStore";

/**
 * Ein Preset, dessen unbekannte Bytes ein MUSTER tragen statt Nullen.
 *
 * Gegen einen Blob aus lauter Nullen würde eine ungewollte Änderung nur dann
 * auffallen, wenn sie zufällig einen Wert ungleich 0 schreibt. Das Muster
 * macht jede Berührung sichtbar.
 */
function preset(): Uint8Array {
  const b = new Uint8Array(IFX_PRESET_SIZE);
  for (let i = 0; i < b.length; i++) b[i] = (i * 7) & 0x7f;
  "TESTFX".split("").forEach((c, i) => (b[0x001 + i] = c.charCodeAt(0)));
  b[0x001 + 6] = 0;
  b[0x12a] = 1; // IFX1
  b[0x174] = 1; // IFX2
  b[0x1be] = 1; // MFX
  return b;
}

function backupAnlegen(bytes: Uint8Array) {
  return { kind: "ifx" as const, index: 0, bytes, id: 1 };
}

/** Die Bytes, die der Editor über den Store zurückgelegt hat. */
function ausStore(): Uint8Array | null {
  return getE2sPresetState().backups.find(b => b.id === 1)?.bytes ?? null;
}

function abweichungen(a: Uint8Array, b: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) out.push(i);
  return out;
}

function zeige(bytes: Uint8Array) {
  const b = backupAnlegen(bytes);
  // Der Editor legt sein Ergebnis über updateBackupBytes im Store ab; damit er
  // dort etwas zu ersetzen hat, muss das Backup schon drin sein.
  getE2sPresetState().backups.push(b);
  render(
    React.createElement(E2sPresetEditor, { backup: b, onClose: () => {} })
  );
  return b;
}

beforeEach(() => __resetE2sPresetForTests());
afterEach(cleanup);

describe("E2sPresetEditor — nicht-destruktives Editieren", () => {
  it("ändert beim Verstellen eines Parameters genau ein Byte", () => {
    const vorher = preset();
    zeige(vorher);

    const regler = screen.getByTestId("e2s-ifx-ifx1-p0") as HTMLInputElement;
    fireEvent.change(regler, { target: { value: "42" } });

    const nachher = ausStore();
    expect(nachher).toBeTruthy();
    const diff = abweichungen(vorher, nachher!);
    expect(diff).toHaveLength(1);
    expect(nachher![diff[0]]).toBe(42);
  });

  it("fasst beim Umbenennen nur das Namensfeld an", () => {
    const vorher = preset();
    zeige(vorher);

    fireEvent.change(screen.getByTestId("e2s-ifx-name"), {
      target: { value: "NEUERNAME" },
    });

    const nachher = ausStore()!;
    expect(abweichungen(vorher, nachher).every(i => i >= 0x01 && i < 0x10)).toBe(
      true
    );
    expect(decodeIfxPreset(nachher).name).toBe("NEUERNAME");
  });

  it("bleibt beim Typwechsel innerhalb des eigenen Slots", () => {
    // setIfxPresetDevice lädt die Vorgaben des neuen Typs und räumt
    // überzählige Parameter des alten ab. Was es NICHT darf: in einen anderen
    // Slot langen — dort stünden danach Werte, die niemand angefasst hat.
    const vorher = preset();
    zeige(vorher);

    fireEvent.change(screen.getByTestId("e2s-ifx-ifx1-device"), {
      target: { value: "2" },
    });

    const nachher = ausStore()!;
    expect(nachher[0x12a]).toBe(2);
    // IFX2 beginnt bei 0x174 — davor ist Schluss.
    expect(abweichungen(vorher, nachher).every(i => i < 0x174)).toBe(true);
  });

  it("lässt die Bytes des Backups selbst unangetastet", () => {
    // Der Editor arbeitet auf Kopien. Sonst wäre das Backup nach dem ersten
    // Schieberegler kein Backup mehr — und genau darauf stützt sich das
    // Zurückschreiben nach einem misslungenen Versuch.
    const vorher = preset();
    const original = Uint8Array.from(vorher);
    zeige(vorher);

    fireEvent.change(screen.getByTestId("e2s-ifx-ifx1-p0"), {
      target: { value: "99" },
    });

    expect(Array.from(vorher)).toEqual(Array.from(original));
  });

  it("verstellt Pre- und Post-Level unabhängig voneinander", () => {
    // ★ Zwei Änderungen hintereinander sind nur dann eine echte Probe, wenn
    // die zweite auf dem ERGEBNIS der ersten aufsetzt. In der App leistet das
    // der Store: das Panel rendert die Backup-Liste, der Editor bekommt das
    // aktualisierte Backup als Prop. Ohne dieses Nachziehen rechnet die zweite
    // Änderung wieder vom Original aus und überschreibt die erste — was hier
    // zuerst wie ein Produktfehler aussah und keiner war.
    const vorher = preset();
    const b = backupAnlegen(vorher);
    getE2sPresetState().backups.push(b);
    const { rerender } = render(
      React.createElement(E2sPresetEditor, { backup: b, onClose: () => {} })
    );

    fireEvent.change(screen.getByTestId("e2s-ifx-ifx1-pre"), {
      target: { value: "10" },
    });
    const nachPre = ausStore()!;
    expect(abweichungen(vorher, nachPre)).toHaveLength(1);

    rerender(
      React.createElement(E2sPresetEditor, {
        backup: { ...b, bytes: nachPre },
        onClose: () => {},
      })
    );
    fireEvent.change(screen.getByTestId("e2s-ifx-ifx1-post"), {
      target: { value: "20" },
    });

    // Zwei Änderungen, zwei Bytes — der zweite Regler darf den ersten nicht
    // zurücksetzen.
    expect(abweichungen(vorher, ausStore()!)).toHaveLength(2);
  });
});
