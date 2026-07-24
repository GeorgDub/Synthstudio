/**
 * tests/features/startup-picker.test.ts
 *
 * v3.292: Startup-Projekt-Picker — beim Start wird nichts automatisch geladen,
 * der User wählt neu / laden / letztes öffnen.
 */
import { describe, it, expect } from "vitest";
import {
  shouldShowStartupPicker,
  lastProjectLabel,
} from "@/components/Startup/startupPicker";

describe("shouldShowStartupPicker", () => {
  it("zeigt den Picker im Normalfall (kein Wizard, kein File-Open)", () => {
    expect(shouldShowStartupPicker({ welcomeWizardOpen: false })).toBe(true);
  });

  it("unterdrückt bei offenem Welcome-Wizard (First-Run hat Vorrang)", () => {
    expect(shouldShowStartupPicker({ welcomeWizardOpen: true })).toBe(false);
  });

  it("unterdrückt wenn Projekt via Datei/CLI geöffnet wurde", () => {
    expect(
      shouldShowStartupPicker({ welcomeWizardOpen: false, openedViaFile: true })
    ).toBe(false);
  });

  it("unterdrückt wenn in dieser Session schon gezeigt", () => {
    expect(
      shouldShowStartupPicker({ welcomeWizardOpen: false, alreadyShown: true })
    ).toBe(false);
  });
});

describe("lastProjectLabel", () => {
  it("liefert den getrimmten Namen eines echten letzten Projekts", () => {
    expect(lastProjectLabel({ projectName: "  Mein Track  " })).toBe("Mein Track");
  });

  it("null bei fehlendem/leerem Cache", () => {
    expect(lastProjectLabel(null)).toBe(null);
    expect(lastProjectLabel(undefined)).toBe(null);
    expect(lastProjectLabel({ projectName: "   " })).toBe(null);
  });

  it("null beim leeren Default-Projekt ('Neues Projekt')", () => {
    expect(lastProjectLabel({ projectName: "Neues Projekt" })).toBe(null);
  });
});
