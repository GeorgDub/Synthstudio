import type { Page } from "@playwright/test";

/**
 * Seedet License (Pro) + Welcome-dismissed in localStorage VOR dem ersten
 * page.goto. Ohne diesen Seed deckt das Activation/Welcome-Modal die UI ab und
 * jede Tab-/Button-Interaktion läuft in einen 30s-Timeout (Element „resolved"
 * aber nie visible/stable). Muss VOR page.goto("/") aufgerufen werden, da
 * addInitScript nur für nachfolgende Navigationen greift.
 *
 * Dateiname mit "_"-Präfix + kein ".spec.ts"-Suffix → von Playwrights testMatch
 * (Glob auf .spec.ts) ignoriert, also kein eigener Test.
 */
export async function seedActivation(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem(
        "synthstudio:license:v1",
        JSON.stringify({ status: "pro", trialStartedAt: Date.now(), licenseKey: "PLAY", activatedEmail: "e2e@test.local" }),
      );
      window.localStorage.setItem(
        "synthstudio:welcome:v1",
        JSON.stringify({ seen: true, dismissed: true, seenAt: Date.now() }),
      );
    } catch { /* */ }
  });
}
