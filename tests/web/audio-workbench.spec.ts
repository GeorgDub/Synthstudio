/**
 * tests/web/audio-workbench.spec.ts
 *
 * Playwright Smoke-Tests für die AudioWorkbench-Welle v1.43–v1.49:
 *   v1.43 WB-TRIM   — inline Trim+Normalize Panels
 *   v1.44 WB-SELECT — Drag-to-select Region auf Canvas
 *   v1.45 WB-UNDO   — Undo-Stack + Ctrl+Z
 *   v1.48 WB-PLAY   — Play/Stop Buffer-Vorschau
 *   v1.49 WB-CUT    — Cut entfernt markierte Region
 *
 * Coverage:
 *   - Navigation: Tools-Tab → Workbench-Sub-Tab
 *   - Drop-Bereich sichtbar (vor Buffer-Load)
 *   - Nach Buffer-Load: Play/Undo/Trim/Cut/Reverse/Normalize/Fade-Buttons sichtbar
 *   - Trim-Button öffnet inline Panel (nicht prompt())
 *   - Normalize-Button öffnet inline Panel mit dB-Preset-Buttons
 *
 * HINWEIS: decodeAudioData braucht eine echte WAV. Wir nutzen einen minimalen
 * aber gültigen 44.1kHz 16-bit Mono Buffer mit ~512 Samples (Stille).
 */
import { test, expect, type Page } from "@playwright/test";
import { seedActivation } from "./_seedApp";

/** Erzeugt eine gültige 44.1kHz 16-bit Mono WAV-Datei (512 Samples, Stille). */
function silentWavBuffer(): Buffer {
  const sampleRate = 44100;
  const numSamples = 512;
  const numChannels = 1;
  const bytesPerSample = 2;
  const dataLength = numSamples * numChannels * bytesPerSample;
  const buf = Buffer.alloc(44 + dataLength);

  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataLength, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
  buf.writeUInt16LE(numChannels * bytesPerSample, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataLength, 40);
  // Data block bleibt 0 (Stille)

  return buf;
}

async function gotoWorkbench(page: Page) {
  await seedActivation(page);
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
  await page.getByRole("tab", { name: "Tools" }).click();
  // Workbench-Sub-Tab in der Tools-Ansicht
  await page.getByRole("button", { name: /🎚 Workbench/ }).click();
  // Header der Workbench
  await expect(page.getByText("Audio Workbench", { exact: true })).toBeVisible({ timeout: 10_000 });
}

test.describe("AudioWorkbench Smoke-Tests (v1.43–v1.49)", () => {
  test("navigation: Tools-Tab → Workbench-Sub-Tab zeigt Drop-Area", async ({ page }) => {
    await gotoWorkbench(page);
    // Drop-Area-Text
    await expect(page.getByText(/Audio-Datei hierher ziehen/)).toBeVisible();
  });

  test("nach Audio-Load: Vorschau-Toolbar + Edit-Toolbar mit allen Buttons sichtbar", async ({ page }) => {
    await gotoWorkbench(page);

    // File-Input für Audio (Workbench-spezifisch — Mixer hat seine eigene)
    const fileInputs = page.locator('input[type="file"][accept*="audio"]');
    const wbInput = fileInputs.last(); // Workbench-Input ist der letzte gemountete
    await wbInput.setInputFiles({
      name: "test.wav",
      mimeType: "audio/wav",
      buffer: silentWavBuffer(),
    });

    // Vorschau-Toolbar (v1.48)
    await expect(page.getByRole("button", { name: /▶ Play/ })).toBeVisible({ timeout: 10_000 });

    // Edit-Toolbar Buttons (v1.43+)
    await expect(page.getByRole("button", { name: /⟲ Undo/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /✂ Trim/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /✕ Cut/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /↩ Reverse/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /📈 Normalize/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /↗ Fade In/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /↘ Fade Out/ })).toBeVisible();
  });

  test("Trim-Button öffnet inline-Panel (kein prompt())", async ({ page }) => {
    await gotoWorkbench(page);
    const wbInput = page.locator('input[type="file"][accept*="audio"]').last();
    await wbInput.setInputFiles({
      name: "test.wav",
      mimeType: "audio/wav",
      buffer: silentWavBuffer(),
    });

    await page.getByRole("button", { name: /✂ Trim/ }).click();

    // Inline-Panel zeigt sich (nicht prompt() → kein dialog event)
    await expect(page.getByRole("button", { name: /Trim anwenden/ })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/Auswahl:/)).toBeVisible();
  });

  test("Normalize-Button öffnet inline-Panel mit dB-Preset-Buttons", async ({ page }) => {
    await gotoWorkbench(page);
    const wbInput = page.locator('input[type="file"][accept*="audio"]').last();
    await wbInput.setInputFiles({
      name: "test.wav",
      mimeType: "audio/wav",
      buffer: silentWavBuffer(),
    });

    await page.getByRole("button", { name: /📈 Normalize/ }).click();

    // dB-Preset-Buttons sichtbar (v1.43)
    await expect(page.getByRole("button", { name: /^0 dB$/ })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: /^-1 dB$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^-3 dB$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^-6 dB$/ })).toBeVisible();
  });

  test("Cut-Button ist initial disabled (keine Selection)", async ({ page }) => {
    await gotoWorkbench(page);
    const wbInput = page.locator('input[type="file"][accept*="audio"]').last();
    await wbInput.setInputFiles({
      name: "test.wav",
      mimeType: "audio/wav",
      buffer: silentWavBuffer(),
    });

    const cutBtn = page.getByRole("button", { name: /✕ Cut/ });
    await expect(cutBtn).toBeVisible();
    // Disabled wenn keine Selection
    await expect(cutBtn).toBeDisabled();
  });

  test("Undo-Button ist initial disabled (leerer Stack)", async ({ page }) => {
    await gotoWorkbench(page);
    const wbInput = page.locator('input[type="file"][accept*="audio"]').last();
    await wbInput.setInputFiles({
      name: "test.wav",
      mimeType: "audio/wav",
      buffer: silentWavBuffer(),
    });

    const undoBtn = page.getByRole("button", { name: /⟲ Undo/ });
    await expect(undoBtn).toBeDisabled();
  });

  test("nach Reverse: Undo-Button enabled mit Count (1)", async ({ page }) => {
    await gotoWorkbench(page);
    const wbInput = page.locator('input[type="file"][accept*="audio"]').last();
    await wbInput.setInputFiles({
      name: "test.wav",
      mimeType: "audio/wav",
      buffer: silentWavBuffer(),
    });

    // Reverse anwenden → Undo-Stack füllt sich
    await page.getByRole("button", { name: /↩ Reverse/ }).click();

    const undoBtn = page.getByRole("button", { name: /⟲ Undo/ });
    await expect(undoBtn).toBeEnabled();
    await expect(undoBtn).toContainText("(1)");
  });
});
