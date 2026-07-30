/**
 * Pegel-Anzeige: dBFS-Umrechnung (client/src/utils/audioEdit.ts → toDbfs)
 *
 * Die Funktion ist klein, aber ihr Zweck ist eine Anzeige — und dort ist der
 * interessante Teil nicht die Formel, sondern was bei Stille und bei
 * Übersteuerung passiert. `log10(0)` ergibt minus unendlich und stünde sonst
 * als „-Infinity" in der Oberfläche.
 */
import { describe, it, expect } from "vitest";
import { toDbfs } from "@/utils/audioEdit";

describe("toDbfs", () => {
  it("rechnet Vollausschlag auf 0 dB", () => {
    expect(toDbfs(1)).toBe("0.0");
  });

  it("rechnet die halbe Amplitude auf rund −6 dB", () => {
    expect(toDbfs(0.5)).toBe("-6.0");
  });

  it("rechnet ein Zehntel auf −20 dB", () => {
    expect(toDbfs(0.1)).toBe("-20.0");
  });

  it("zeigt bei Stille ein Unendlich-Zeichen statt -Infinity", () => {
    expect(toDbfs(0)).toBe("-∞");
  });

  it("behandelt unhörbar Leises ebenfalls als Stille", () => {
    // Unterhalb dessen, was 16 Bit auflösen können — eine Zahl wie „-312.4"
    // wäre in der Anzeige nur Rauschen.
    expect(toDbfs(1e-20)).toBe("-∞");
  });

  it("weist negative und ungültige Werte ab, statt NaN zu zeigen", () => {
    expect(toDbfs(-0.5)).toBe("-∞");
    expect(toDbfs(Number.NaN)).toBe("-∞");
    expect(toDbfs(Number.POSITIVE_INFINITY)).toBe("-∞");
  });

  it("zeigt Übersteuerung als positiven Wert an", () => {
    // Nicht abschneiden: dass ein Sample über 0 dBFS liegt, ist genau die
    // Information, die man sehen will.
    expect(toDbfs(2)).toBe("6.0");
  });

  it("erlaubt eine feinere Auflösung", () => {
    expect(toDbfs(0.5, 2)).toBe("-6.02");
  });
});
