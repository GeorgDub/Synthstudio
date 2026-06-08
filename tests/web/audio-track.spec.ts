/**
 * tests/web/audio-track.spec.ts
 *
 * Playwright Smoke-Tests für TASK-102 / F3 – Audio-Track Mixer-UI (v1.16.0).
 *
 * Coverage:
 *   - Mixer header has [+ Audio Track] button (sichtbar + clickable + Counter)
 *   - Adding an audio track via mock file shows a new strip
 *   - Strip has fader, pan, mute, solo, sync-mode dropdown
 *   - Remove button removes the strip
 *
 * Browser-only — pure-web flow (kein Electron). Filepicker wird via Playwright
 * `setInputFiles()` gemockt.
 *
 * HINWEIS: Da der Vitest-Lauf in jsdom keine Web-Audio-API hat, prüft dieser
 * Test KEINE Audio-Wiedergabe — nur die UI-Affordances. Real-Audio-Tests
 * leben in `tests/features/audio-track.test.ts`.
 */
import { test, expect, type Page } from "@playwright/test";
import { seedActivation } from "./_seedApp";
import path from "path";

// Pfad zu einer kleinen Test-Audio-Datei (falls vorhanden), sonst inline WAV-Header
const FIXTURE_WAV = path.resolve("tests/fixtures/sine-440.wav");

/** Erzeugt eine valide minimal-WAV-Datei (1 Sample, 8-bit mono) als Buffer. */
function tinyWavBuffer(): Buffer {
  // 44-Byte RIFF Header + 1 Byte data
  const buf = Buffer.alloc(45);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(37, 4); // file size - 8
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(8000, 24); // sample rate
  buf.writeUInt32LE(8000, 28); // byte rate
  buf.writeUInt16LE(1, 32); // block align
  buf.writeUInt16LE(8, 34); // bits per sample
  buf.write("data", 36);
  buf.writeUInt32LE(1, 40); // data size
  buf.writeUInt8(128, 44); // 1 silence sample (8-bit unsigned mid)
  return buf;
}

async function gotoMixer(page: Page) {
  await seedActivation(page);
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
  await page.getByRole("tab", { name: "Mixer" }).click();
  // Header der Mixer-Ansicht erkennt man am "Mixer"-Label
  await expect(page.getByText("Mixer", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
}

test.describe("Audio-Track Mixer-UI (TASK-102 / F3)", () => {
  test("Mixer header has [+ Audio Track] button", async ({ page }) => {
    await gotoMixer(page);

    const btn = page.getByRole("button", { name: /Audio Track hinzuf/i });
    await expect(btn).toBeVisible({ timeout: 10_000 });
    // Counter "(0/8)" muss enthalten sein
    await expect(btn).toContainText("/8");
  });

  test("Adding an audio track via mock file shows a new strip", async ({ page }) => {
    await gotoMixer(page);

    // Per Hidden-File-Input direkt setzen (umgeht den nativen Picker)
    const fileInput = page.locator('input[type="file"][accept*="audio"]');
    // Hidden-Input via setInputFiles — Playwright triggert onChange ohne dass das
    // Element sichtbar sein muss.
    await fileInput.setInputFiles({
      name: "vocals.wav",
      mimeType: "audio/wav",
      buffer: tinyWavBuffer(),
    });

    // Strip mit testid muss erscheinen
    const strip = page.locator('[data-testid="audio-track-strip"]').first();
    await expect(strip).toBeVisible({ timeout: 10_000 });
    // Name kommt vom Filename-Stem ("vocals")
    await expect(strip).toContainText(/vocals/i);
  });

  test("Strip has fader, pan, mute, solo, sync-mode dropdown", async ({ page }) => {
    await gotoMixer(page);

    const fileInput = page.locator('input[type="file"][accept*="audio"]');
    await fileInput.setInputFiles({
      name: "guitar.wav",
      mimeType: "audio/wav",
      buffer: tinyWavBuffer(),
    });

    const strip = page.locator('[data-testid="audio-track-strip"]').first();
    await expect(strip).toBeVisible({ timeout: 10_000 });

    // Fader (Volume range)
    await expect(strip.getByLabel("Volume")).toBeVisible();
    // Pan
    await expect(strip.getByLabel("Pan")).toBeVisible();
    // Mute
    await expect(strip.getByRole("button", { name: "Mute" })).toBeVisible();
    // Solo
    await expect(strip.getByRole("button", { name: "Solo" })).toBeVisible();
    // Sync Mode Dropdown
    await expect(strip.getByLabel("Sync Mode")).toBeVisible();
    // Reverb / Delay Sends
    await expect(strip.getByLabel("Reverb Send")).toBeVisible();
    await expect(strip.getByLabel("Delay Send")).toBeVisible();
  });

  test("Remove button removes the strip", async ({ page }) => {
    await gotoMixer(page);

    const fileInput = page.locator('input[type="file"][accept*="audio"]');
    await fileInput.setInputFiles({
      name: "drums-loop.wav",
      mimeType: "audio/wav",
      buffer: tinyWavBuffer(),
    });

    const strip = page.locator('[data-testid="audio-track-strip"]').first();
    await expect(strip).toBeVisible({ timeout: 10_000 });

    const closeBtn = strip.getByRole("button", { name: "Close" });
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();

    // v3.144: Remove nutzt den CUSTOM ConfirmDialog (useConfirm), KEIN natives
    // window.confirm → im Modal auf "Entfernen" klicken (nicht page.once("dialog")).
    await page.getByTestId("confirm-dialog-confirm").click();

    // Strip verschwindet
    await expect(page.locator('[data-testid="audio-track-strip"]')).toHaveCount(0, { timeout: 5000 });
  });

  test("Sync Mode dropdown switches to Stretch and shows BPM input", async ({ page }) => {
    await gotoMixer(page);

    const fileInput = page.locator('input[type="file"][accept*="audio"]');
    await fileInput.setInputFiles({
      name: "stem.wav",
      mimeType: "audio/wav",
      buffer: tinyWavBuffer(),
    });

    const strip = page.locator('[data-testid="audio-track-strip"]').first();
    await expect(strip).toBeVisible({ timeout: 10_000 });

    const select = strip.getByLabel("Sync Mode");
    await select.selectOption("stretch");

    // Original-BPM Input erscheint
    await expect(strip.getByLabel("Original BPM")).toBeVisible({ timeout: 3000 });
  });
});

// ─── TASK-121: Time-Stretch Counter + Banner ──────────────────────────────────

test.describe("TimeStretch Counter + Banner (TASK-121)", () => {
  test("Counter is hidden when no audio tracks exist", async ({ page }) => {
    await gotoMixer(page);
    await expect(page.locator('[data-testid="timestretch-counter"]')).toHaveCount(0);
  });

  test("Counter appears (neutral color) after adding one free track", async ({ page }) => {
    await gotoMixer(page);

    const fileInput = page.locator('input[type="file"][accept*="audio"]');
    await fileInput.setInputFiles({
      name: "track1.wav",
      mimeType: "audio/wav",
      buffer: tinyWavBuffer(),
    });

    const strip = page.locator('[data-testid="audio-track-strip"]').first();
    await expect(strip).toBeVisible({ timeout: 10_000 });

    const counter = page.locator('[data-testid="timestretch-counter"]');
    await expect(counter).toBeVisible();
    await expect(counter).toContainText("Time-Stretch: 0/4");
    // Neutral color (text-text-dim) when count < MAX-1
    await expect(counter).toHaveClass(/text-text-dim/);
  });

  test("Counter turns red (text-accent-danger) when 4/4 timestretch tracks active", async ({
    page,
  }) => {
    await gotoMixer(page);

    // Add 4 tracks
    for (let i = 0; i < 4; i++) {
      const fileInput = page.locator('input[type="file"][accept*="audio"]');
      await fileInput.setInputFiles({
        name: `ts-${i}.wav`,
        mimeType: "audio/wav",
        buffer: tinyWavBuffer(),
      });
      await expect(
        page.locator('[data-testid="audio-track-strip"]').nth(i),
      ).toBeVisible({ timeout: 10_000 });
    }

    // Switch each track's Sync Mode to "timestretch"
    const strips = page.locator('[data-testid="audio-track-strip"]');
    for (let i = 0; i < 4; i++) {
      const select = strips.nth(i).getByLabel("Sync Mode");
      // option "timestretch" may not be disabled before limit hit
      await select.selectOption("timestretch");
    }

    const counter = page.locator('[data-testid="timestretch-counter"]');
    await expect(counter).toContainText("Time-Stretch: 4/4");
    await expect(counter).toHaveClass(/text-accent-danger/);
  });

  test("5th track shows banner + disabled timestretch option when limit reached", async ({
    page,
  }) => {
    await gotoMixer(page);

    // 4 tracks → switch all to timestretch
    for (let i = 0; i < 4; i++) {
      const fileInput = page.locator('input[type="file"][accept*="audio"]');
      await fileInput.setInputFiles({
        name: `lim-${i}.wav`,
        mimeType: "audio/wav",
        buffer: tinyWavBuffer(),
      });
      await expect(
        page.locator('[data-testid="audio-track-strip"]').nth(i),
      ).toBeVisible({ timeout: 10_000 });
    }
    const strips = page.locator('[data-testid="audio-track-strip"]');
    for (let i = 0; i < 4; i++) {
      await strips.nth(i).getByLabel("Sync Mode").selectOption("timestretch");
    }

    // Add 5th track (stays "free")
    const fileInput = page.locator('input[type="file"][accept*="audio"]');
    await fileInput.setInputFiles({
      name: "fifth.wav",
      mimeType: "audio/wav",
      buffer: tinyWavBuffer(),
    });
    await expect(strips.nth(4)).toBeVisible({ timeout: 10_000 });

    // Banner visible in 5th strip
    const banner = strips.nth(4).locator('[data-testid="timestretch-limit-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Max 4 Time-Stretch-Tracks");

    // Option "timestretch" inside the 5th dropdown is disabled
    const optDisabled = await strips
      .nth(4)
      .locator('select[aria-label="Sync Mode"] option[value="timestretch"]')
      .evaluate((el) => (el as HTMLOptionElement).disabled);
    expect(optDisabled).toBe(true);
  });
});

// FIXTURE_WAV used only if available — referenced to satisfy linter when not used
void FIXTURE_WAV;
