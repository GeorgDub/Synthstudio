/**
 * tests/web/audio-clip-lane.spec.ts (TASK-256, smoke für TASK-246)
 *
 * Playwright-Smoke für die Continuous Audio-Clip-Lane im Sequencer
 * (AudioClipLane + AudioClipLaneList).
 *
 * Geprüftes (STABILES) Verhalten:
 *   - Lane-Liste (audio-clip-lane-list) rendert NUR wenn ein Audio-Track
 *     existiert; ohne Track ist sie abwesend.
 *   - Pro Track erscheint eine Lane (audio-clip-lane-<id>).
 *   - M / S / Play-Buttons existieren + sind klickbar.
 *   - Mute/Solo togglen aria-pressed (store-gebunden → race-frei).
 *   - Play togglet den per-Lane-local `playing`-State (false → true → false).
 *
 * NICHT geprüft (gehört TASK-252 / parallele Backend-Session):
 *   - Kopplung des Lane-Play-States an den globalen Transport. Skip unten.
 *
 * Flake-Schutz: mehrsekündige WAV (sonst feuert onAudioTrackEnded mitten in
 * die Play-Toggle-Assertion → aria-pressed racet).
 *
 * Browser-only (kein Electron).
 */
import { test, expect, type Page } from "@playwright/test";
import { seedActivation } from "./_seedApp";

function multiSecondWavBuffer(seconds = 3): Buffer {
  const sampleRate = 8000;
  const numSamples = sampleRate * seconds;
  const dataSize = numSamples;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate, 28);
  buf.writeUInt16LE(1, 32);
  buf.writeUInt16LE(8, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  buf.fill(128, 44);
  return buf;
}

async function seedAndOpen(page: Page) {
  await seedActivation(page);
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
}

async function addAudioTrackViaMixer(page: Page, fileName: string) {
  await page.getByRole("tab", { name: "Mixer" }).click();
  await expect(page.getByText("Mixer", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  const fileInput = page.locator('input[type="file"][accept*="audio"]');
  await fileInput.setInputFiles({
    name: fileName,
    mimeType: "audio/wav",
    buffer: multiSecondWavBuffer(3),
  });
  await expect(page.locator('[data-testid="audio-track-strip"]').first()).toBeVisible({ timeout: 10_000 });
}

test.describe("Continuous Audio-Clip-Lane im Sequencer (TASK-246)", () => {
  test("Lane-Liste ist abwesend solange kein Audio-Track existiert", async ({ page }) => {
    await seedAndOpen(page);
    await page.getByRole("tab", { name: "Sequencer" }).click();
    await expect(page.locator('[data-testid="audio-clip-lane-list"]')).toHaveCount(0);
  });

  test("Lane rendert im Sequencer wenn ein Audio-Track existiert", async ({ page }) => {
    await seedAndOpen(page);
    await addAudioTrackViaMixer(page, "clip-render.wav");
    await page.getByRole("tab", { name: "Sequencer" }).click();

    const list = page.locator('[data-testid="audio-clip-lane-list"]');
    await expect(list).toBeVisible({ timeout: 10_000 });
    const lane = page.locator('[data-testid^="audio-clip-lane-"][data-track-id]').first();
    await expect(lane).toBeVisible();
  });

  test("M / S / Play-Buttons existieren + sind klickbar (Mute/Solo togglen aria-pressed)", async ({ page }) => {
    await seedAndOpen(page);
    await addAudioTrackViaMixer(page, "clip-buttons.wav");
    await page.getByRole("tab", { name: "Sequencer" }).click();

    const lane = page.locator('[data-testid^="audio-clip-lane-"][data-track-id]').first();
    await expect(lane).toBeVisible({ timeout: 10_000 });
    const trackId = await lane.getAttribute("data-track-id");
    expect(trackId).toBeTruthy();

    const muteBtn = lane.locator(`[data-testid="audio-clip-lane-mute-${trackId}"]`);
    const soloBtn = lane.locator(`[data-testid="audio-clip-lane-solo-${trackId}"]`);
    const playBtn = lane.locator(`[data-testid="audio-clip-lane-play-${trackId}"]`);

    await expect(muteBtn).toBeVisible();
    await expect(soloBtn).toBeVisible();
    await expect(playBtn).toBeVisible();

    // Mute toggle (store-gebunden → race-frei)
    await expect(muteBtn).toHaveAttribute("aria-pressed", "false");
    await muteBtn.click();
    await expect(muteBtn).toHaveAttribute("aria-pressed", "true");
    await muteBtn.click();
    await expect(muteBtn).toHaveAttribute("aria-pressed", "false");

    // Solo toggle
    await expect(soloBtn).toHaveAttribute("aria-pressed", "false");
    await soloBtn.click();
    await expect(soloBtn).toHaveAttribute("aria-pressed", "true");
    await soloBtn.click();
    await expect(soloBtn).toHaveAttribute("aria-pressed", "false");
  });

  test("Per-Lane Play togglet den lokalen playing-State (false → true → false)", async ({ page }) => {
    await seedAndOpen(page);
    await addAudioTrackViaMixer(page, "clip-play.wav");
    await page.getByRole("tab", { name: "Sequencer" }).click();

    const lane = page.locator('[data-testid^="audio-clip-lane-"][data-track-id]').first();
    await expect(lane).toBeVisible({ timeout: 10_000 });
    const trackId = await lane.getAttribute("data-track-id");
    const playBtn = lane.locator(`[data-testid="audio-clip-lane-play-${trackId}"]`);

    await expect(playBtn).toHaveAttribute("aria-pressed", "false");
    await playBtn.click();
    await expect(playBtn).toHaveAttribute("aria-pressed", "true");
    await playBtn.click();
    await expect(playBtn).toHaveAttribute("aria-pressed", "false");
  });

  // Wartet auf TASK-252-Verhalten: derzeit ist die Lane-WaveformDisplay an das
  // per-Lane-local `playing` gebunden (isPlaying={playing}), NICHT an den
  // globalen Transport. Erst nach TASK-252 koppelt der globale Play-Button den
  // Lane-Play-State. Vorher würde ein scharfes Assert brechen.
  test.skip("Global-Play aktiviert die Lane-Wiedergabe (wartet auf TASK-252-Verhalten)", async () => {
    // Intentionally empty — siehe Begründung oben.
  });
});
