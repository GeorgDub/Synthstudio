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
 * Global-Entkopplung (TASK-267 — SUPERSEDES TASK-252):
 *   - Der per-Lane-Button ist NICHT mehr während Global-Play gesperrt. Jede Lane
 *     ist unabhängig vom globalen Transport start-/stoppbar. Global-Play spiegelt
 *     sich zwar im Button (aria-pressed=true), aber der Button bleibt ENABLED und
 *     ein Klick stoppt NUR diese eine Lane — der globale Transport läuft weiter.
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

  // TASK-267 SUPERSEDES TASK-252: Die Lane ist vom globalen Transport ENTKOPPELT.
  // Der per-Lane-Button bleibt während Global-Play ENABLED, und ein Klick stoppt
  // NUR diese eine Lane — der globale Transport läuft dabei weiter. User-
  // Anforderung: „Die Audio lanes sollen auch separat im Sequenzer gestartet und
  // gestoppt werden und nicht nur global." Reines UI-/State-Coupling — kein
  // Audio-Output nötig, daher headless-deterministisch.
  test("Lane-Stop während Global-Play stoppt nur diese Lane, Button bleibt enabled (TASK-267)", async ({ page }) => {
    await seedAndOpen(page);
    await addAudioTrackViaMixer(page, "clip-globalsync.wav");
    await page.getByRole("tab", { name: "Sequencer" }).click();

    const lane = page.locator('[data-testid^="audio-clip-lane-"][data-track-id]').first();
    await expect(lane).toBeVisible({ timeout: 10_000 });
    const trackId = await lane.getAttribute("data-track-id");
    const playBtn = lane.locator(`[data-testid="audio-clip-lane-play-${trackId}"]`);

    // Ausgangslage: nicht spielend, Toggle frei.
    await expect(playBtn).toHaveAttribute("aria-pressed", "false");
    await expect(playBtn).toBeEnabled();

    // Globaler Transport-Play. Der Toolbar-Button trägt title "Play (Space) …";
    // der Lane-eigene Button trägt "Play (nur dieser Clip)" → wir disambiguieren
    // explizit über das (Space)-Präfix, damit der Locator NICHT die Lane trifft.
    const globalPlay = page.locator('button[title^="Play (Space)"]').first();
    await expect(globalPlay).toBeVisible();
    await globalPlay.click();

    // Engine startet die (nicht-gemutete) Lane → Button spiegelt playing.
    // ENTSCHEIDEND (TASK-267): Der Button bleibt ENABLED — nicht mehr gesperrt.
    await expect(playBtn).toHaveAttribute("aria-pressed", "true");
    await expect(playBtn).toBeEnabled();

    // Lane-Stop WÄHREND Global läuft: stoppt nur diese eine Voice.
    await playBtn.click();
    await expect(playBtn).toHaveAttribute("aria-pressed", "false");
    // Der globale Transport wurde NICHT angefasst — der Toolbar-Button steht
    // weiterhin auf "Stop (Space) …" (kein zweiter Global-Press ausgelöst).
    await expect(page.locator('button[title^="Stop (Space)"]').first()).toBeVisible();

    // Globaler Stop räumt den lokalen State wieder ab.
    const globalStop = page.locator('button[title^="Stop (Space)"]').first();
    await globalStop.click();
    await expect(playBtn).toHaveAttribute("aria-pressed", "false");
    await expect(playBtn).toBeEnabled();
  });

  // TASK-268-FOLLOWUP: Der Insert-FX-Einstieg ist jetzt auch an der Clip-Lane.
  // AKZEPTANZKRITERIUM ist NICHT nur "Panel öffnet", sondern SHARED STATE: das
  // Lane-Panel und der Mixer-Strip-Panel teilen denselben track.fx-State derselben
  // Lane (kein local state). Wir setzen den "Filter"-Enable-Toggle im Lane-Panel
  // und assert'en, dass der Strip-Panel-Toggle denselben Wert spiegelt.
  //
  // Warum der Filter-Enable-Toggle (role=switch) und kein Slider: die FxPanelBody-
  // Knob-Slider haben weder aria-label noch testid — der Toggle ist als
  // role="switch" mit Name "Filter" deterministisch + pure DOM (headless-safe).
  // DEFAULT_CHANNEL_FX.filterEnabled ist `false`; toggeln→true und in BEIDEN
  // Panels true zu lesen beweist Sharing (nicht Zufall mit dem Default).
  test("Lane-FX-Panel teilt denselben State wie der Mixer-Strip (TASK-268-FOLLOWUP)", async ({ page }) => {
    await seedAndOpen(page);
    await addAudioTrackViaMixer(page, "clip-fx-shared.wav");

    // Track-ID aus dem Strip greifen (selbe Lane in Mixer + Sequencer).
    const strip = page.locator('[data-testid="audio-track-strip"][data-track-id]').first();
    await expect(strip).toBeVisible({ timeout: 10_000 });
    const trackId = await strip.getAttribute("data-track-id");
    expect(trackId).toBeTruthy();

    // ── Sequencer: Lane-FX öffnen ───────────────────────────────────────────
    await page.getByRole("tab", { name: "Sequencer" }).click();
    const lane = page.locator(`[data-testid="audio-clip-lane-${trackId}"][data-track-id]`);
    await expect(lane).toBeVisible({ timeout: 10_000 });

    const laneFxToggle = page.locator(`[data-testid="audio-clip-lane-fx-toggle-${trackId}"]`);
    await expect(laneFxToggle).toHaveAttribute("aria-pressed", "false");
    await laneFxToggle.click();
    const lanePanel = page.locator(`[data-testid="audio-clip-lane-fx-panel-${trackId}"]`);
    await expect(lanePanel).toBeVisible();

    // Filter-Enable-Toggle im Lane-Panel (default-Tab "filter", default false).
    const laneFilterSwitch = lanePanel.getByRole("switch", { name: /^Filter/ });
    await expect(laneFilterSwitch).toHaveAttribute("aria-checked", "false");
    await laneFilterSwitch.click();
    await expect(laneFilterSwitch).toHaveAttribute("aria-checked", "true");

    // ── Mixer: Strip-FX öffnen → muss den im Lane gesetzten Wert spiegeln ─────
    await page.getByRole("tab", { name: "Mixer" }).click();
    const stripFxToggle = page.locator(`[data-testid="audio-track-fx-toggle-${trackId}"]`);
    await expect(stripFxToggle).toBeVisible({ timeout: 10_000 });
    await stripFxToggle.click();
    const stripPanel = page.locator(`[data-testid="audio-track-fx-panel-${trackId}"]`);
    await expect(stripPanel).toBeVisible();

    // SHARED STATE: der Strip-Panel-Filter-Toggle zeigt true (im Lane gesetzt).
    const stripFilterSwitch = stripPanel.getByRole("switch", { name: /^Filter/ });
    await expect(stripFilterSwitch).toHaveAttribute("aria-checked", "true");

    // Gegenrichtung: im Strip ausschalten → zurück im Sequencer ist es aus.
    await stripFilterSwitch.click();
    await expect(stripFilterSwitch).toHaveAttribute("aria-checked", "false");

    await page.getByRole("tab", { name: "Sequencer" }).click();
    // fxOpen ist component-local (ephemer, wie der Strip) → beim Tab-Wechsel
    // unmountet die Lane und der Toggle ist wieder zu. Re-öffnen; die FX-WERTE
    // (track.fx) überleben den Tab-Wechsel im Store — das ist der Beweis.
    const laneFxToggle2 = page.locator(`[data-testid="audio-clip-lane-fx-toggle-${trackId}"]`);
    await expect(laneFxToggle2).toBeVisible({ timeout: 10_000 });
    await laneFxToggle2.click();
    const lanePanel2 = page.locator(`[data-testid="audio-clip-lane-fx-panel-${trackId}"]`);
    await expect(lanePanel2).toBeVisible();
    await expect(lanePanel2.getByRole("switch", { name: /^Filter/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });
});
