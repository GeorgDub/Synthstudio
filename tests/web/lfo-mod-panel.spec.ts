/**
 * lfo-mod-panel.spec.ts — TASK-257-FOLLOWUP
 *
 * UI-State-Smoke für das LFO/Mod-Panel (TASK-257-FOLLOWUP). Reiner UI-Pfad,
 * KEINE Audio-Output-Asserts → headless-tauglich (CI_HEADLESS=1).
 *
 * Test 1: Tools-Tab → LFO/Mod-Sub-Tab öffnet das Panel.
 * Test 2: "+ LFO" erzeugt eine LFO-Zeile, danach "+ Route" eine Route-Zeile.
 */
import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("synthstudio:license:v1", JSON.stringify({ status: "pro", trialStartedAt: Date.now(), licenseKey: "PLAY", activatedEmail: "e2e@test.local" }));
      window.localStorage.setItem("synthstudio:welcome:v1", JSON.stringify({ seen: true, dismissed: true, seenAt: Date.now() }));
      // Frischer Modulations-Store je Run (kein verwaister State aus früheren Läufen).
      window.localStorage.removeItem("ss-lfo-mod:v1");
    } catch { /* */ }
  });
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
});

test("LFO/Mod-Panel ist über den Tools-Tab erreichbar", async ({ page }) => {
  await page.getByRole("tab", { name: /^Tools$/ }).click();
  await page.getByTestId("tools-tab-lfomod").click();
  await expect(page.getByTestId("lfomod-panel")).toBeVisible();
  // Leerzustand: noch keine LFO.
  await expect(page.getByTestId("lfomod-lfo-row")).toHaveCount(0);
});

test('"+ LFO" und "+ Route" erzeugen je eine Zeile', async ({ page }) => {
  await page.getByRole("tab", { name: /^Tools$/ }).click();
  await page.getByTestId("tools-tab-lfomod").click();
  await expect(page.getByTestId("lfomod-panel")).toBeVisible();

  // + LFO → eine LFO-Zeile.
  await page.getByTestId("lfomod-add-lfo").click();
  await expect(page.getByTestId("lfomod-lfo-row")).toHaveCount(1);

  // Mit vorhandener LFO + Default-Parts ist "+ Route" klickbar.
  const addRoute = page.getByTestId("lfomod-add-route");
  await expect(addRoute).toBeEnabled();
  await addRoute.click();
  await expect(page.getByTestId("lfomod-route-row")).toHaveCount(1);
});

test("LFO-Zeile zeigt eine Kurven-Vorschau (Canvas mit Maßen + aria-label)", async ({
  page,
}) => {
  await page.getByRole("tab", { name: /^Tools$/ }).click();
  await page.getByTestId("tools-tab-lfomod").click();
  await expect(page.getByTestId("lfomod-panel")).toBeVisible();

  await page.getByTestId("lfomod-add-lfo").click();
  await expect(page.getByTestId("lfomod-lfo-row")).toHaveCount(1);

  // Deterministische, statische Asserts (keine Pixel/Playhead-Position):
  // Canvas vorhanden, mit erwarteten Maßen + A11y-Label.
  const canvas = page.getByTestId("lfomod-curve-canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("aria-label", "LFO-Kurven-Vorschau");
  await expect(canvas).toHaveAttribute("width", "200");
  await expect(canvas).toHaveAttribute("height", "48");
});

test("Mod-Matrix: je Quelltyp eine Route anlegen → in eigener Gruppe sichtbar (TASK-270)", async ({
  page,
}) => {
  await page.getByRole("tab", { name: /^Tools$/ }).click();
  await page.getByTestId("tools-tab-lfomod").click();
  await expect(page.getByTestId("lfomod-panel")).toBeVisible();

  // Eine LFO für die lfo-Route (Sub-Select braucht eine Quelle).
  await page.getByTestId("lfomod-add-lfo").click();
  await expect(page.getByTestId("lfomod-lfo-row")).toHaveCount(1);

  // Alle drei Quelltyp-Gruppen sind initial vorhanden (auch leer).
  await expect(page.getByTestId("lfomod-group-lfo")).toBeVisible();
  await expect(page.getByTestId("lfomod-group-macro")).toBeVisible();
  await expect(page.getByTestId("lfomod-group-env")).toBeVisible();

  // Je Quelltyp eine Route über den gruppen-eigenen "+"-Button anlegen.
  await page.getByTestId("lfomod-add-route-lfo").click();
  await page.getByTestId("lfomod-add-route-macro").click();
  await page.getByTestId("lfomod-add-route-env").click();

  // Drei Routen-Zeilen gesamt.
  await expect(page.getByTestId("lfomod-route-row")).toHaveCount(3);

  // Jede Gruppe enthält genau ihre eine Zeile.
  await expect(
    page.getByTestId("lfomod-group-lfo").getByTestId("lfomod-route-row"),
  ).toHaveCount(1);
  await expect(
    page.getByTestId("lfomod-group-macro").getByTestId("lfomod-route-row"),
  ).toHaveCount(1);
  await expect(
    page.getByTestId("lfomod-group-env").getByTestId("lfomod-route-row"),
  ).toHaveCount(1);
});
