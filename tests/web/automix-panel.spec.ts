/**
 * automix-panel.spec.ts — v3.269
 *
 * Das AutoMix-Panel (LUFS-Gain-Staging) war vollständig gebaut, aber NIRGENDS
 * gemountet (verwaister Code, kein User-Zugang). Jetzt im Tools-Tab "Auto-Mix".
 *
 * Test 1: Panel rendert + Channel-Zeilen (mount + channels-Prop aus Parts).
 * Test 2: Audible-LUFS — eine Channel hörbar machen (Wavetable + Arp im
 *         channel-Modus treibt sie kontinuierlich) → das Panel misst eine
 *         endliche LUFS-Zahl (Measurement-Pipeline läuft durch das Mount).
 */
import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("synthstudio:license:v1", JSON.stringify({ status: "pro", trialStartedAt: Date.now(), licenseKey: "PLAY", activatedEmail: "e2e@test.local" }));
      window.localStorage.setItem("synthstudio:welcome:v1", JSON.stringify({ seen: true, dismissed: true, seenAt: Date.now() }));
    } catch { /* */ }
  });
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
});

test("AutoMix-Panel ist erreichbar und listet die Channels", async ({ page }) => {
  await page.getByRole("tab", { name: /^Tools$/ }).click();
  await page.getByRole("button", { name: /Auto-Mix/ }).click();
  await expect(page.getByTestId("automix-panel")).toBeVisible();
  await expect(page.getByText("Smart Auto-Mix")).toBeVisible();
  // Mindestens eine Channel-Zeile (gemessen-Span existiert pro Part).
  const measured = page.locator('[data-testid^="automix-measured-"]');
  expect(await measured.count()).toBeGreaterThan(0);
});

test("AutoMix misst endliche LUFS für eine hörbare Channel", async ({ page }) => {
  // Arp im channel-Modus auf den ersten Part richten (kontinuierliche Quelle).
  await page.getByRole("tab", { name: /^Tools$/ }).click();
  await page.getByRole("button", { name: "Inaktiv" }).click();
  await page.getByTestId("arp-output-channel").click();
  const target = page.getByTestId("arp-target-part");
  const partId = (await target.locator("option").evaluateAll((opts) =>
    (opts as HTMLOptionElement[]).map((o) => o.value).filter((v) => v !== ""),
  ))[0];
  expect(partId).toBeTruthy();

  // Ziel-Part hörbar machen (Wavetable-Synth) + als Arp-Ziel wählen.
  await page.getByRole("tab", { name: /^Sequencer$/ }).click();
  await page.getByTestId(`channel-source-type-${partId}`).click();
  await page.getByTestId(`channel-source-type-option-${partId}-wavetable`).click();
  await page.getByRole("tab", { name: /^Tools$/ }).click();
  await target.selectOption(partId);

  // Abspielen, dann AutoMix öffnen (Panel mountet → enableAutoMixAnalysis).
  await page.getByRole("tab", { name: /^Sequencer$/ }).click();
  await page.locator('button[title^="Play"]').first().click();
  await page.getByRole("tab", { name: /^Tools$/ }).click();
  await page.getByRole("button", { name: /Auto-Mix/ }).click();
  await expect(page.getByTestId("automix-panel")).toBeVisible();

  // Auf eine endliche Messung warten (Default-Messfenster + Polling).
  const measured = page.getByTestId(`automix-measured-${partId}`);
  await expect(measured).not.toHaveText("–", { timeout: 12_000 });
  const txt = (await measured.textContent())?.trim() ?? "";
  console.log("AutoMix measured LUFS for", partId, "=", txt);
  expect(Number.isFinite(Number(txt))).toBe(true);
});
