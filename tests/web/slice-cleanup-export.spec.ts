/**
 * slice-cleanup-export.spec.ts — v3.300.0
 *
 * Smoke für die zwei Wege, die dem Slicer bisher fehlten: die Aufbereitung
 * des Materials vor dem Schneiden, und der Export der Slices als Dateien.
 *
 * Anders als `sample-slicing.spec.ts` (prüft nur, dass der Toolbar-Button den
 * File-Input auslöst) wird hier eine echte, kleine WAV eingeschleust und vom
 * Browser dekodiert — nur so öffnet sich der Editor überhaupt. Die Datei wird
 * im Test erzeugt, damit kein Fixture nötig ist.
 */
import { test, expect } from "@playwright/test";
import { seedActivation } from "./_seedApp";

/** Gültige 16-bit-Mono-WAV mit einem Sinus und Stille an den Rändern. */
function makeWav(seconds = 1, sampleRate = 44100): Buffer {
  const frames = Math.floor(seconds * sampleRate);
  const pcm = Buffer.alloc(frames * 2);
  const pad = Math.floor(frames * 0.2);
  for (let i = 0; i < frames; i++) {
    // Stille vorne und hinten, damit "Stille trimmen" etwas zu tun hat.
    const inBody = i > pad && i < frames - pad;
    const v = inBody ? Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 0.4 : 0;
    pcm.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "latin1");
  header.write("fmt ", 12, "latin1");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "latin1");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

test.use({ viewport: { width: 1440, height: 900 } });

async function openEditor(page: import("@playwright/test").Page) {
  await seedActivation(page);
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
  await page.getByTestId("io-cluster-toggle").click();
  await page.getByTestId("slice-sample-input").setInputFiles({
    name: "break.wav",
    mimeType: "audio/wav",
    buffer: makeWav(),
  });
  await expect(page.getByTestId("sample-slice-editor-overlay")).toBeVisible({
    timeout: 20_000,
  });
}

test("Aufbereitung ist im Slicer erreichbar und meldet, was sie getan hat", async ({
  page,
}) => {
  await openEditor(page);

  // Vor dem ersten Anwenden gibt es weder Meldung noch Zurücksetzen-Knopf —
  // beides wäre ohne Änderung nur Rauschen.
  await expect(page.getByTestId("slice-editor-cleanup-note")).toHaveCount(0);
  await expect(page.getByTestId("slice-editor-cleanup-reset")).toHaveCount(0);

  await expect(page.getByTestId("slice-editor-cleanup-preset")).toHaveValue("default");
  await page.getByTestId("slice-editor-cleanup-apply").click();

  const note = page.getByTestId("slice-editor-cleanup-note");
  await expect(note).toBeVisible();
  await expect(note).toContainText("DC-Offset");

  // Jetzt lässt sich das Original zurückholen — ein zu harter Filter darf
  // nicht bedeuten, die Datei neu laden zu müssen.
  const reset = page.getByTestId("slice-editor-cleanup-reset");
  await expect(reset).toBeVisible();
  await reset.click();
  await expect(page.getByTestId("slice-editor-cleanup-note")).toHaveCount(0);
  await expect(page.getByTestId("slice-editor-cleanup-reset")).toHaveCount(0);
});

test("Field-Recording-Preset kürzt das Sample sichtbar", async ({ page }) => {
  await openEditor(page);

  await page.getByTestId("slice-editor-cleanup-preset").selectOption("field");
  await page.getByTestId("slice-editor-cleanup-apply").click();

  // Das Preset trimmt Stille — die Meldung nennt die Längenänderung.
  await expect(page.getByTestId("slice-editor-cleanup-note")).toContainText("kürzer");
});

test("Slices lassen sich als Datei exportieren", async ({ page }) => {
  await openEditor(page);

  // Ein einzelner Slice (nur der Start-Marker) → Einzeldatei, kein Archiv.
  const single = page.waitForEvent("download", { timeout: 20_000 });
  await page.getByTestId("slice-editor-export").click();
  const wav = await single;
  expect(wav.suggestedFilename()).toMatch(/^break_\d+\.wav$/);

  // Auto-Slice erzeugt genug Abschnitte für den Archiv-Pfad.
  await page.getByTestId("slice-editor-auto").click();
  const zip = page.waitForEvent("download", { timeout: 20_000 });
  await page.getByTestId("slice-editor-export").click();
  const archive = await zip;
  expect(archive.suggestedFilename()).toMatch(/^break(_slices\.zip|_\d+\.wav)$/);
});
