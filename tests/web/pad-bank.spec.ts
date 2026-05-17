/**
 * tests/web/pad-bank.spec.ts (TASK-201)
 *
 * Playwright-Smoke für das Custom Pad-Bank-Feature (v2.78–v2.82).
 *
 * Gegenstand der Coverage:
 *   • UI öffnen (Ctrl+M → MidiSettings-Modal → "Custom Pad-Bank" aufklappen)
 *   • Default-Slots: 16 perf-pad-Slots erscheinen
 *   • Slot-Kind ändern (perf-pad → macro / action), data-Attribute reflektieren
 *     den neuen Kind
 *   • Slot entfernen + Slot hinzufügen
 *   • Reset auf 16 perf-pad-Defaults
 *   • Persistenz: ein veränderter Slot überlebt page.reload() (v2.80
 *     localStorage-Persistenz via savePadBankSlots).
 *
 * NICHT abgedeckt (bewusst out-of-scope für diesen Web-Smoke):
 *   • Auto-Learn-Flow: braucht echte MIDI-Hardware oder ein WebMIDI-Mock —
 *     der "Start Auto-Learn"-Button ist disabled wenn midi.isEnabled=false,
 *     was im Web-Test-Lauf der Default ist. Für die Auto-Learn-Mechanik
 *     gibt es Unit-Coverage in tests/features/midi-auto-learn.test.ts.
 *   • MIDI-Pad → Performance-Pad-Mapping (v2.78 KORG): ebenfalls Hardware-
 *     gebunden — Unit-Coverage in tests/features.
 *   • .synth-File Round-Trip (v2.81 padBank-Feld): zu invasiv für einen
 *     Smoke (FileSystem-IPC + Project-Restore) und in
 *     tests/features/project-serializer.test.ts schon abgedeckt.
 *
 * Browser-only: läuft via pnpm test:web gegen den Vite-Dev-Server.
 */
import { test, expect, type Page } from "@playwright/test";

const PAD_BANK_STORAGE_KEY = "ss-pad-bank:v1";

/**
 * Default-localStorage-State leeren bevor jeder Test rennt, damit jeder Test
 * mit den 16 perf-pad-Defaults startet. addInitScript läuft VOR dem ersten
 * JS-Eval auf der Seite → der loadPadBankSlots()-Call in useState liest dann
 * garantiert nichts Vorbelegtes.
 */
async function clearPadBankStorage(page: Page) {
  await page.addInitScript((key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }, PAD_BANK_STORAGE_KEY);
}

/**
 * Bewusst KEIN Ctrl+M — der Shortcut feuert in dieser App-Konfig zwei
 * Handler gleichzeitig (kb:action open-midi + onToggleMidiSettings), was
 * SettingsPanel UND MidiSettings parallel öffnet und Click-Capture stört.
 * Stattdessen: gezielt den 🎹-Quick-Button in der Topbar klicken — der
 * öffnet SettingsPanel mit initialSection "midi-cc". Von dort führt der
 * "Advanced-MIDI-Banner"-Öffnen-Button zur vollen MidiSettings-Modal.
 */
async function openPadBankBuilder(page: Page) {
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });

  // SettingsPanel via 🎹-Topbar-Button öffnen.
  // Der Button hat keinen Accessible-Name ausser dem Emoji; wir suchen via
  // title-Attribut "MIDI-Einstellungen (Ctrl+M)".
  const midiQuickButton = page.locator('button[title="MIDI-Einstellungen (Ctrl+M)"]');
  await expect(midiQuickButton).toBeVisible({ timeout: 5_000 });
  await midiQuickButton.click();

  // In manchen SettingsPanel-Mount-Pfaden landet active auf "design" statt
  // "midi-cc" (initialSection-Prop-Mismatch). Wir klicken zur Sicherheit
  // immer explizit auf "CC-Zuweisungen" in der Sidebar.
  const ccSectionTab = page.getByRole("button", { name: /CC-Zuweisungen/ });
  await expect(ccSectionTab).toBeVisible({ timeout: 5_000 });
  await ccSectionTab.click();

  // Im SettingsPanel midi-cc-Section: der "Erweiterte MIDI-Einstellungen"-
  // Banner-Button öffnet die volle MidiSettings-Modal.
  const banner = page.getByTestId("advanced-midi-open");
  await expect(banner).toBeVisible({ timeout: 5_000 });
  await banner.click();

  // Jetzt ist das volle MidiSettings-Modal offen
  await expect(page.getByText("MIDI-Einstellungen", { exact: true })).toBeVisible({
    timeout: 5_000,
  });

  // Auf den CC-Mapping-Tab wechseln, dort lebt der Pad-Bank-Builder
  await page.getByRole("button", { name: /CC-Mapping/i }).click();

  // "Custom Pad-Bank" Toggle aufklappen
  const toggle = page.getByTestId("pad-bank-toggle");
  await expect(toggle).toBeVisible();
  await toggle.click();

  // Builder-Panel ist jetzt sichtbar
  await expect(page.getByTestId("pad-bank-builder")).toBeVisible();
}

test.describe("Custom Pad-Bank UI-Smoke (TASK-201)", () => {
  test.beforeEach(async ({ page }) => {
    await clearPadBankStorage(page);
  });

  test("zeigt 16 Default Perf-Pad-Slots", async ({ page }) => {
    await openPadBankBuilder(page);

    // 16 Slots erwartet (defaultPadBankSlots())
    const rows = page.locator('[data-testid^="pad-bank-slot-row-"]');
    await expect(rows).toHaveCount(16);

    // Jeder Default-Slot ist perf-pad
    for (let i = 0; i < 16; i++) {
      const row = page.getByTestId(`pad-bank-slot-row-${i}`);
      await expect(row).toHaveAttribute("data-pad-bank-slot-kind", "perf-pad");
      await expect(row).toHaveAttribute("data-pad-bank-slot-param", String(i));
    }
  });

  test("Slot-Kind von perf-pad auf macro ändern setzt data-Attribut + param-Default", async ({
    page,
  }) => {
    await openPadBankBuilder(page);

    // Slot #3 (idx=2) auf "macro" umschalten
    await page.getByTestId("pad-bank-slot-kind-2").selectOption("macro");

    const row = page.getByTestId("pad-bank-slot-row-2");
    await expect(row).toHaveAttribute("data-pad-bank-slot-kind", "macro");
    // updatePadBankSlot setzt bei kind-change perf-pad→macro param =
    // Math.min(7, index) → bei idx=2 ist das "2"
    await expect(row).toHaveAttribute("data-pad-bank-slot-param", "2");
  });

  test("Slot-Kind auf action setzt einen valide Action-Key als Default-Param", async ({
    page,
  }) => {
    await openPadBankBuilder(page);

    await page.getByTestId("pad-bank-slot-kind-0").selectOption("action");

    const row = page.getByTestId("pad-bank-slot-row-0");
    await expect(row).toHaveAttribute("data-pad-bank-slot-kind", "action");
    // Erster CHAIN_BUILDER_ACTIONS-Key — nicht-leer, nicht numerisch
    const param = await row.getAttribute("data-pad-bank-slot-param");
    expect(param).toBeTruthy();
    expect(param!.length).toBeGreaterThan(0);
  });

  test("Remove-Slot reduziert Anzahl um 1", async ({ page }) => {
    await openPadBankBuilder(page);

    await expect(page.locator('[data-testid^="pad-bank-slot-row-"]')).toHaveCount(16);
    await page.getByTestId("pad-bank-slot-remove-0").click();
    await expect(page.locator('[data-testid^="pad-bank-slot-row-"]')).toHaveCount(15);
  });

  test("Add-Slot erhöht Anzahl um 1, neuer Slot ist perf-pad", async ({ page }) => {
    await openPadBankBuilder(page);

    await expect(page.locator('[data-testid^="pad-bank-slot-row-"]')).toHaveCount(16);
    await page.getByTestId("pad-bank-add-slot").click();

    const rows = page.locator('[data-testid^="pad-bank-slot-row-"]');
    await expect(rows).toHaveCount(17);

    // Neuer Slot ist Index 16 — addPadBankSlot appendet { kind: "perf-pad",
    // param: String(Math.min(15, prev.length)) }
    const newRow = page.getByTestId("pad-bank-slot-row-16");
    await expect(newRow).toHaveAttribute("data-pad-bank-slot-kind", "perf-pad");
  });

  test("Reset-Button stellt 16 perf-pad-Defaults wieder her", async ({ page }) => {
    await openPadBankBuilder(page);

    // Erst mal kaputt machen: 5 Slots löschen + einen auf macro ändern
    for (let i = 0; i < 5; i++) {
      await page.getByTestId("pad-bank-slot-remove-0").click();
    }
    await page.getByTestId("pad-bank-slot-kind-0").selectOption("macro");

    await expect(page.locator('[data-testid^="pad-bank-slot-row-"]')).toHaveCount(11);

    // Reset
    await page.getByTestId("pad-bank-reset").click();

    // 16 perf-pad-Slots zurück
    await expect(page.locator('[data-testid^="pad-bank-slot-row-"]')).toHaveCount(16);
    for (let i = 0; i < 16; i++) {
      await expect(page.getByTestId(`pad-bank-slot-row-${i}`)).toHaveAttribute(
        "data-pad-bank-slot-kind",
        "perf-pad",
      );
    }
  });

  test("Persistenz: geänderte Slots überleben page.reload() (v2.80 localStorage)", async ({
    page,
  }) => {
    await openPadBankBuilder(page);

    // Slot #5 (idx=4) auf "macro" stellen
    await page.getByTestId("pad-bank-slot-kind-4").selectOption("macro");
    await expect(page.getByTestId("pad-bank-slot-row-4")).toHaveAttribute(
      "data-pad-bank-slot-kind",
      "macro",
    );

    // Slot #1 (idx=0) entfernen → ab jetzt 15 Slots, neuer idx=3 ist der
    // alte idx=4 ("macro")
    await page.getByTestId("pad-bank-slot-remove-0").click();
    await expect(page.locator('[data-testid^="pad-bank-slot-row-"]')).toHaveCount(15);
    await expect(page.getByTestId("pad-bank-slot-row-3")).toHaveAttribute(
      "data-pad-bank-slot-kind",
      "macro",
    );

    // localStorage muss jetzt befüllt sein (savePadBankSlots-useEffect)
    const rawAfter = await page.evaluate((key) => window.localStorage.getItem(key), PAD_BANK_STORAGE_KEY);
    expect(rawAfter).not.toBeNull();
    const parsedAfter = JSON.parse(rawAfter!);
    expect(parsedAfter).toHaveLength(15);
    expect(parsedAfter[3]).toMatchObject({ kind: "macro" });

    // Reload — WICHTIG: bevor goto wir den clearPadBankStorage-Init-Script
    // NICHT erneut registrieren wollen (sonst würde er localStorage cleanen).
    // Da addInitScript per Page-Lifecycle persistiert, müssen wir explizit
    // einen "harten" reload machen ohne neuen Init-Script — aber die Page
    // wird mit der bereits-gespeicherten init-script wieder gerendert. Das
    // würde den Storage wieder löschen!
    //
    // Workaround: localStorage direkt in einem Pre-Reload-Hook explizit
    // wieder schreiben — das Init-Script läuft VOR dem ersten Eval und
    // räumt auf, danach läuft unser Eval und schreibt zurück.
    await page.addInitScript(({ key, payload }) => {
      try {
        window.localStorage.setItem(key, payload);
      } catch {
        /* ignore */
      }
    }, { key: PAD_BANK_STORAGE_KEY, payload: rawAfter! });

    await page.reload();

    // Modal & Builder wieder öffnen (gleicher Pfad wie openPadBankBuilder,
    // hier inline weil wir mitten in einem Test sind und die Helper-Funktion
    // einen page.goto macht — den brauchen wir nach reload() nicht).
    await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
    await page.locator('button[title="MIDI-Einstellungen (Ctrl+M)"]').click();
    await page.getByRole("button", { name: /CC-Zuweisungen/ }).click();
    await page.getByTestId("advanced-midi-open").click();
    await expect(page.getByText("MIDI-Einstellungen", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /CC-Mapping/i }).click();
    await page.getByTestId("pad-bank-toggle").click();

    // Erwartet: 15 Slots, idx=3 weiterhin macro
    await expect(page.locator('[data-testid^="pad-bank-slot-row-"]')).toHaveCount(15);
    await expect(page.getByTestId("pad-bank-slot-row-3")).toHaveAttribute(
      "data-pad-bank-slot-kind",
      "macro",
    );
  });
});
