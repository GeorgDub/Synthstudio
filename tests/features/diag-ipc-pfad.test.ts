/**
 * Synthstudio – diag-ipc-pfad.test.ts
 *
 * Der Renderer schickt nur eine Sitzungs-KENNUNG, nie einen Pfad. Den Pfad
 * baut der Hauptprozess selbst unter `userData/diagnose`.
 *
 * Ein Log, das der Renderer irgendwohin schreiben lassen könnte, wäre ein
 * Schreib-Primitiv über die ganze Platte — und zwar eines, das in jeder
 * Sitzung mitläuft.
 */
import { describe, it, expect } from "vitest";
import { diagSessionDateiname } from "../../electron/ipcValidators";

describe("diagSessionDateiname", () => {
  it("nimmt eine gewöhnliche Sitzungskennung an", () => {
    expect(diagSessionDateiname("2026-08-11T20-15-03")).toBe(
      "session-2026-08-11T20-15-03.jsonl"
    );
  });

  it("weist Pfadwechsel ab", () => {
    expect(diagSessionDateiname("../../etc/passwd")).toBeNull();
    expect(diagSessionDateiname("a/b")).toBeNull();
    expect(diagSessionDateiname("a\\b")).toBeNull();
  });

  it("weist Leeres und Übergrosses ab", () => {
    expect(diagSessionDateiname("")).toBeNull();
    expect(diagSessionDateiname("x".repeat(200))).toBeNull();
  });

  it("weist alles ab, was nicht Buchstabe, Ziffer, Punkt, Strich ist", () => {
    // Auch NUL und Doppelpunkt — auf Windows öffnet „a:b" einen alternativen
    // Datenstrom statt einer Datei.
    expect(diagSessionDateiname("a:b")).toBeNull();
    expect(diagSessionDateiname("a\0b")).toBeNull();
    expect(diagSessionDateiname("a b")).toBeNull();
  });
});
