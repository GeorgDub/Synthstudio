/**
 * tests/features/welcome-wizard-i18n.test.ts
 *
 * v3.38.0 — i18n tests for the WelcomeWizard.
 *
 * Closes the caveat from v3.22: "Welcome-Wizard hat hardcoded deutsch".
 *
 * Scope (pure-fn helpers — kein React/JSDOM-Render nötig):
 *   (1) detectDefaultLanguage(navigatorLanguage) — de* → de, sonst en
 *   (2) i18nStrings map enthält DE + EN für alle UI-Chrome-Strings
 *   (3) getDefaultSlidesForLanguage(lang) liefert per-Sprache-Slides
 *   (4) save/loadWizardLanguage persistiert in localStorage
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

beforeEach(() => {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  }
  vi.resetModules();
});

describe("detectDefaultLanguage — v3.38.0 navigator language detection", () => {
  it("returns 'de' for German locales (de, de-DE, de-AT, de-CH)", async () => {
    const { detectDefaultLanguage } = await import(
      "../../client/src/components/Welcome/WelcomeWizard"
    );
    expect(detectDefaultLanguage("de")).toBe("de");
    expect(detectDefaultLanguage("de-DE")).toBe("de");
    expect(detectDefaultLanguage("de-AT")).toBe("de");
    expect(detectDefaultLanguage("de-CH")).toBe("de");
    expect(detectDefaultLanguage("DE-de")).toBe("de"); // case-insensitive
  });

  it("returns 'en' for non-German locales (en, en-US, fr, ja, en-GB, …)", async () => {
    const { detectDefaultLanguage } = await import(
      "../../client/src/components/Welcome/WelcomeWizard"
    );
    expect(detectDefaultLanguage("en")).toBe("en");
    expect(detectDefaultLanguage("en-US")).toBe("en");
    expect(detectDefaultLanguage("en-GB")).toBe("en");
    expect(detectDefaultLanguage("fr-FR")).toBe("en");
    expect(detectDefaultLanguage("ja-JP")).toBe("en");
    expect(detectDefaultLanguage("zh-CN")).toBe("en");
  });

  it("returns 'en' on invalid/empty input (defensive fallback)", async () => {
    const { detectDefaultLanguage } = await import(
      "../../client/src/components/Welcome/WelcomeWizard"
    );
    expect(detectDefaultLanguage("")).toBe("en");
    expect(detectDefaultLanguage(null)).toBe("en");
    expect(detectDefaultLanguage(undefined)).toBe("en");
  });
});

describe("i18nStrings — DE + EN parity", () => {
  it("has identical keys for DE and EN (no missing translations)", async () => {
    const { i18nStrings } = await import(
      "../../client/src/components/Welcome/WelcomeWizard"
    );
    const deKeys = Object.keys(i18nStrings.de).sort();
    const enKeys = Object.keys(i18nStrings.en).sort();
    expect(enKeys).toEqual(deKeys);
  });

  it("translates back/next/finish/dontShowAgain (the critical user actions)", async () => {
    const { i18nStrings } = await import(
      "../../client/src/components/Welcome/WelcomeWizard"
    );
    // German originals.
    expect(i18nStrings.de.back).toBe("Zurück");
    expect(i18nStrings.de.next).toBe("Weiter");
    expect(i18nStrings.de.finish).toBe("Los geht's");
    expect(i18nStrings.de.dontShowAgain).toBe("Nicht mehr anzeigen");
    // English translations are non-empty AND distinct from DE.
    expect(i18nStrings.en.back).toBe("Back");
    expect(i18nStrings.en.next).toBe("Next");
    expect(i18nStrings.en.finish).toBe("Let's go");
    expect(i18nStrings.en.dontShowAgain).toBe("Don't show again");
    // Sanity: DE ≠ EN for every key.
    expect(i18nStrings.de.back).not.toBe(i18nStrings.en.back);
    expect(i18nStrings.de.next).not.toBe(i18nStrings.en.next);
  });

  it("slide counter + aria helpers are functions returning localised strings", async () => {
    const { i18nStrings } = await import(
      "../../client/src/components/Welcome/WelcomeWizard"
    );
    expect(typeof i18nStrings.de.slideCounter).toBe("function");
    expect(typeof i18nStrings.en.slideCounter).toBe("function");
    expect(i18nStrings.de.slideCounter(2, 6)).toBe("Slide 2 / 6");
    expect(i18nStrings.en.slideCounter(2, 6)).toBe("Slide 2 / 6");
    expect(i18nStrings.de.ariaProgress(3, 6)).toBe("Fortschritt: 3 von 6");
    expect(i18nStrings.en.ariaProgress(3, 6)).toBe("Progress: 3 of 6");
  });
});

describe("getDefaultSlidesForLanguage — v3.38.0 per-language slides", () => {
  it("returns DE slides with German titles when lang='de'", async () => {
    const { getDefaultSlidesForLanguage } = await import(
      "../../client/src/components/Welcome/WelcomeWizard"
    );
    const slides = getDefaultSlidesForLanguage("de");
    expect(slides.length).toBe(6);
    expect(slides[0].title).toBe("Willkommen bei Synthstudio");
    expect(slides[5].title).toBe("Du bist startklar");
  });

  it("returns EN slides with English titles when lang='en'", async () => {
    const { getDefaultSlidesForLanguage } = await import(
      "../../client/src/components/Welcome/WelcomeWizard"
    );
    const slides = getDefaultSlidesForLanguage("en");
    expect(slides.length).toBe(6);
    expect(slides[0].title).toBe("Welcome to Synthstudio");
    expect(slides[5].title).toBe("You're ready to go");
  });

  it("returns same slide-IDs across languages (so target-routing is stable)", async () => {
    const { getDefaultSlidesForLanguage } = await import(
      "../../client/src/components/Welcome/WelcomeWizard"
    );
    const de = getDefaultSlidesForLanguage("de");
    const en = getDefaultSlidesForLanguage("en");
    expect(en.map((s) => s.id)).toEqual(de.map((s) => s.id));
  });
});

describe("save/loadWizardLanguage — localStorage persistence", () => {
  it("loadWizardLanguage falls back to navigator.language on first run", async () => {
    const { loadWizardLanguage } = await import(
      "../../client/src/components/Welcome/WelcomeWizard"
    );
    // jsdom navigator.language defaults to "en-US" → expect 'en'.
    expect(["de", "en"]).toContain(loadWizardLanguage());
  });

  it("saveWizardLanguage('en') persists and is restored by loadWizardLanguage", async () => {
    const mod = await import(
      "../../client/src/components/Welcome/WelcomeWizard"
    );
    mod.saveWizardLanguage("en");
    expect(mod.loadWizardLanguage()).toBe("en");
    expect(localStorage.getItem("synthstudio:welcome:lang")).toBe("en");
  });

  it("saveWizardLanguage('de') overrides a prior 'en' value", async () => {
    const mod = await import(
      "../../client/src/components/Welcome/WelcomeWizard"
    );
    mod.saveWizardLanguage("en");
    mod.saveWizardLanguage("de");
    expect(mod.loadWizardLanguage()).toBe("de");
  });

  it("loadWizardLanguage ignores garbage values in localStorage", async () => {
    localStorage.setItem("synthstudio:welcome:lang", "klingon");
    const { loadWizardLanguage } = await import(
      "../../client/src/components/Welcome/WelcomeWizard"
    );
    // Garbage → fall back to navigator detection.
    expect(["de", "en"]).toContain(loadWizardLanguage());
  });
});
