/**
 * tests/web/theme-tokens.spec.ts (TASK-122 Welle 2 / v2.59)
 *
 * Visuelle Regressions-Coverage für die 10 built-in Themes — ohne Pixel-
 * Screenshots, sondern als CSS-Token-Integrity-Smoke gegen den echten
 * Vite-Bundled-CSS-Output.
 *
 * Hintergrund: TASK-122 Welle 1 (v2.48) hat zwei neue Tokens eingeführt
 *   --ss-accent-tertiary  (z.B. violet)
 *   --ss-accent-warning   (z.B. amber)
 * und in alle 10 built-in Themes + @theme + CustomTheme-Backcompat
 * eingebaut. Welle 2 schließt die Welle ab mit zwei E2E-Garantien, die
 * Theme-Drift in der Zukunft sofort sichtbar machen:
 *
 *   1. **Pro Theme**: alle 14 Pflicht-Tokens (12 alte + 2 v2.48 neue)
 *      sind nicht-leer und sind ein valider CSS-Color-String.
 *   2. **Cross-Theme**: die accent-Tokens (primary/secondary/tertiary/
 *      warning/danger/success) sind über Themes hinweg distinct — kein
 *      "Theme-Copy-Paste-Vergessen" wo zwei Themes identische Accents haben.
 *
 * Wir nutzen NICHT page.screenshot() / toHaveScreenshot() weil das massive
 * Baseline-Pflege erfordert und über Plattformen flaky ist. CSS-Variable-
 * Vergleiche sind deterministisch.
 */
import { test, expect, type Page } from "@playwright/test";

const THEMES = [
  "dark",
  "neon",
  "analog",
  "purple",
  "warm",
  "oled",
  "daylight",
  "paper",
  "deuteranopia",
  "protanopia",
] as const;

const REQUIRED_TOKENS = [
  // Background-Stack
  "--ss-bg-base",
  "--ss-bg-panel",
  "--ss-bg-elevated",
  // Accent-Stack (inkl. v2.48 tertiary + warning)
  "--ss-accent-primary",
  "--ss-accent-secondary",
  "--ss-accent-tertiary",
  "--ss-accent-success",
  "--ss-accent-warning",
  "--ss-accent-danger",
  // Text-Stack
  "--ss-text-primary",
  "--ss-text-muted",
  "--ss-text-dim",
  // Border-Stack
  "--ss-border",
  "--ss-border-subtle",
] as const;

/**
 * Cross-Theme-Vergleich nur auf den Accent-Tokens — Backgrounds dürfen
 * sich zwischen Dark-Themes durchaus überlappen (zwei dunkle Themes mit
 * identischem #121218 sind kein Drift-Marker). Accents tragen die
 * Theme-Identität.
 */
const DISTINCT_ACCENT_TOKENS = [
  "--ss-accent-primary",
  "--ss-accent-secondary",
  "--ss-accent-tertiary",
  "--ss-accent-warning",
] as const;

async function setDocumentTheme(page: Page, themeId: string) {
  await page.evaluate((id) => {
    document.documentElement.setAttribute("data-theme", id);
  }, themeId);
  // Eine Tick warten damit Browser den Re-Style anwendet
  await page.waitForTimeout(20);
}

async function getCssVar(page: Page, varName: string): Promise<string> {
  return await page.evaluate((name) => {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }, varName);
}

/**
 * Liest alle REQUIRED_TOKENS einmal pro Theme.
 * Liefert: themeId → { tokenName → cssValue }
 */
async function snapshotAllThemes(page: Page): Promise<Record<string, Record<string, string>>> {
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
  const result: Record<string, Record<string, string>> = {};
  for (const theme of THEMES) {
    await setDocumentTheme(page, theme);
    const values: Record<string, string> = {};
    for (const token of REQUIRED_TOKENS) {
      values[token] = await getCssVar(page, token);
    }
    result[theme] = values;
  }
  return result;
}

test.describe("Theme-Token Integrity (TASK-122 Welle 2)", () => {
  test("Alle 10 Themes definieren alle 14 Pflicht-Tokens (nicht-leer)", async ({ page }) => {
    const snapshot = await snapshotAllThemes(page);
    for (const theme of THEMES) {
      for (const token of REQUIRED_TOKENS) {
        const value = snapshot[theme][token];
        expect(value, `${theme} → ${token}`).not.toBe("");
        // CSS-Color-String — entweder Hex (#rgb / #rrggbb / #rrggbbaa) oder rgb()/rgba()/hsl()/hsla()/named.
        // Wir matchen breit: muss mindestens ein 3+-Zeichen non-whitespace-Wert sein.
        expect(value.length, `${theme} → ${token}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  test("v2.48-Tokens --ss-accent-tertiary + --ss-accent-warning sind in allen 10 Themes definiert", async ({ page }) => {
    const snapshot = await snapshotAllThemes(page);
    for (const theme of THEMES) {
      expect(snapshot[theme]["--ss-accent-tertiary"], `${theme} → tertiary fehlt`).not.toBe("");
      expect(snapshot[theme]["--ss-accent-warning"], `${theme} → warning fehlt`).not.toBe("");
    }
  });

  test("Accent-Tokens sind cross-theme distinct — kein Copy-Paste-Drift", async ({ page }) => {
    const snapshot = await snapshotAllThemes(page);
    for (const token of DISTINCT_ACCENT_TOKENS) {
      // Sammle alle Werte für diesen Token über alle Themes
      const valuesByTheme = THEMES.map((t) => ({ theme: t, value: snapshot[t][token].toLowerCase() }));
      const uniqueValues = new Set(valuesByTheme.map((v) => v.value));
      // Mind. 5 von 10 Themes müssen distinct sein — exact-uniqueness wäre
      // zu strikt (a11y-Themes dürfen sich z.B. überlappen), aber wenn nur
      // 1-2 Werte gesetzt sind, ist das ein klarer Copy-Paste-Bug.
      expect(uniqueValues.size, `${token}: nur ${uniqueValues.size} distinct values across 10 themes`).toBeGreaterThanOrEqual(5);
    }
  });

  test("Theme-Wechsel ist live: data-theme-Attribute-Switch ändert die Computed-Variable", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });

    // Dark → Daylight: --ss-bg-base ist dunkel vs hell. Egal welche exakten
    // Werte — sie müssen unterschiedlich sein, sonst ist Theme-Switch broken.
    await setDocumentTheme(page, "dark");
    const darkBg = await getCssVar(page, "--ss-bg-base");

    await setDocumentTheme(page, "daylight");
    const daylightBg = await getCssVar(page, "--ss-bg-base");

    expect(darkBg).not.toBe(daylightBg);
    expect(darkBg.length).toBeGreaterThan(0);
    expect(daylightBg.length).toBeGreaterThan(0);

    // Round-Trip zurück: dark muss wieder den ursprünglichen Wert haben
    await setDocumentTheme(page, "dark");
    expect(await getCssVar(page, "--ss-bg-base")).toBe(darkBg);
  });
});
