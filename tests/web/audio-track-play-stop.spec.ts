/**
 * tests/web/audio-track-play-stop.spec.ts (TASK-256, smoke für TASK-245)
 *
 * Playwright-Smoke für den Per-Track Play/Stop-Button im Mixer-AudioTrackStrip.
 *
 * Geprüftes (STABILES) Verhalten — bewusst NICHT global-transport-gekoppelt:
 *   - Strip hat einen Play/Stop-Button mit testid audio-track-play-<id>.
 *   - Klick togglet aria-pressed false → true → false (per-Track-local `playing`).
 *
 * Global-Sync (TASK-261, gelandet):
 *   - Der Mixer-Strip-Button koppelt jetzt — wie die Clip-Lane (TASK-252) — an
 *     den globalen Transport: AudioTrackStrip abonniert AudioEngine.onPlayState-
 *     Change, Global-Play setzt globalPlaying → effectivePlaying=true → Button
 *     aria-pressed="true" + Toggle gesperrt (disabled). Reines UI-/State-Coupling,
 *     kein Audio-Output → headless-deterministisch (Smoke unten).
 *
 * Flake-Schutz: der Button liest component-local `playing`. Ein 1-Sample-WAV
 * würde onAudioTrackEnded quasi sofort feuern und `playing` wieder auf false
 * setzen → aria-pressed-Assertion racet. Daher erzeugen wir eine mehrsekündige
 * WAV (multiSecondWavBuffer), damit der Track während der Assertion noch läuft.
 *
 * Browser-only (kein Electron). File-Picker via setInputFiles gemockt.
 */
import { test, expect, type Page } from "@playwright/test";
import { seedActivation } from "./_seedApp";

/**
 * Erzeugt eine valide mehrsekündige Mono-WAV (8-bit, 8000 Hz). Bei `seconds=3`
 * sind das 24000 Samples — lang genug dass der Track während der Test-
 * Assertions noch spielt und onAudioTrackEnded NICHT mitten in die
 * aria-pressed-Prüfung feuert.
 */
function multiSecondWavBuffer(seconds = 3): Buffer {
  const sampleRate = 8000;
  const numSamples = sampleRate * seconds;
  const dataSize = numSamples; // 8-bit mono → 1 Byte/Sample
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);  // PCM
  buf.writeUInt16LE(1, 22);  // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate, 28); // byte rate
  buf.writeUInt16LE(1, 32);  // block align
  buf.writeUInt16LE(8, 34);  // bits per sample
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  // Silence (8-bit unsigned mid = 128) reicht für die UI-Smoke.
  buf.fill(128, 44);
  return buf;
}

async function gotoMixer(page: Page) {
  await seedActivation(page);
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
  await page.getByRole("tab", { name: "Mixer" }).click();
  await expect(page.getByText("Mixer", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
}

async function addAudioTrack(page: Page, fileName: string) {
  const fileInput = page.locator('input[type="file"][accept*="audio"]');
  await fileInput.setInputFiles({
    name: fileName,
    mimeType: "audio/wav",
    buffer: multiSecondWavBuffer(3),
  });
  const strip = page.locator('[data-testid="audio-track-strip"]').first();
  await expect(strip).toBeVisible({ timeout: 10_000 });
  return strip;
}

test.describe("Per-Track Play/Stop im AudioTrackStrip (TASK-245)", () => {
  test("Strip hat einen Play/Stop-Button (testid audio-track-play-<id>)", async ({ page }) => {
    await gotoMixer(page);
    const strip = await addAudioTrack(page, "playstop-1.wav");
    const trackId = await strip.getAttribute("data-track-id");
    expect(trackId).toBeTruthy();
    const playBtn = strip.locator(`[data-testid="audio-track-play-${trackId}"]`);
    await expect(playBtn).toBeVisible();
    // Initial: nicht spielend
    await expect(playBtn).toHaveAttribute("aria-pressed", "false");
  });

  test("Klick togglet den Per-Track-Playing-State (false → true → false)", async ({ page }) => {
    await gotoMixer(page);
    const strip = await addAudioTrack(page, "playstop-2.wav");
    const trackId = await strip.getAttribute("data-track-id");
    const playBtn = strip.locator(`[data-testid="audio-track-play-${trackId}"]`);

    await expect(playBtn).toHaveAttribute("aria-pressed", "false");
    // Play
    await playBtn.click();
    await expect(playBtn).toHaveAttribute("aria-pressed", "true");
    // Stop (Toggle zurück)
    await playBtn.click();
    await expect(playBtn).toHaveAttribute("aria-pressed", "false");
  });

  // TASK-261 ist gelandet: AudioTrackStrip abonniert AudioEngine.onPlayState-
  // Change (wie die Clip-Lane via TASK-252). Globaler Transport-Play setzt
  // globalPlaying → effectivePlaying=true; der Mixer-Strip-Play-Button spiegelt
  // das (aria-pressed) und sein Toggle ist gesperrt (disabled). Reines UI-/State-
  // Coupling — kein Audio-Output nötig, daher headless-deterministisch.
  test("Global-Play koppelt den Mixer-Per-Track-Button (TASK-261-Kopplung)", async ({ page }) => {
    await gotoMixer(page);
    const strip = await addAudioTrack(page, "playstop-global.wav");
    const trackId = await strip.getAttribute("data-track-id");
    const playBtn = strip.locator(`[data-testid="audio-track-play-${trackId}"]`);

    // Ausgangslage: nicht spielend, Toggle frei.
    await expect(playBtn).toHaveAttribute("aria-pressed", "false");
    await expect(playBtn).toBeEnabled();

    // Globaler Transport-Play. Der Toolbar-Button (App-Level, auf allen Tabs
    // sichtbar) trägt title "Play (Space)"; der Strip-eigene Button trägt
    // "Play (nur dieser Track)" → wir disambiguieren über das (Space)-Präfix,
    // damit der Locator NICHT den Strip-Button trifft.
    const globalPlay = page.locator('button[title^="Play (Space)"]').first();
    await expect(globalPlay).toBeVisible();
    await globalPlay.click();

    // Kopplung: effectivePlaying=true → Strip-Button zeigt playing + ist gesperrt.
    await expect(playBtn).toHaveAttribute("aria-pressed", "true");
    await expect(playBtn).toBeDisabled();

    // Globaler Stop entkoppelt wieder (Toolbar-Button heißt jetzt "Stop …").
    const globalStop = page.locator('button[title^="Stop (Space)"]').first();
    await globalStop.click();
    await expect(playBtn).toHaveAttribute("aria-pressed", "false");
    await expect(playBtn).toBeEnabled();
  });
});
