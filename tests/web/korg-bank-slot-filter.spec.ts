/**
 * korg-bank-slot-filter.spec.ts — v3.286.0
 *
 * Smoke für den Slot-Browser des KORG-Bank-Editors nach der Korrektur der
 * Offset-Tabelle (250 → 1002 Slots).
 *
 * Der Test lädt eine synthetisch gebaute `.all` mit genau zwei Samples, eines
 * davon auf **Slot 501** — dem Index, ab dem Hacktribe seine User-Samples
 * ablegt. Mit dem alten Layout war dieser Slot nicht adressierbar; dass er hier
 * in der Liste auftaucht, ist der eigentliche Beweis der Korrektur, und zwar
 * durch die komplette Kette Datei → Parser → UI.
 *
 * Die `.all` wird hier von Hand gebaut, nicht über den App-Builder importiert:
 * Playwright läuft in Node ohne den Vite-`@/`-Alias.
 */
import { test, expect } from "@playwright/test";
import { seedActivation } from "./_seedApp";

// ─── Minimale, gültige .all-Datei ────────────────────────────────────────────

const SIGNATURE = Buffer.from("e2s sample all\x1a\x00", "latin1");
const OFFSET_TABLE_START = 0x0058;
const SAMPLE_AREA_START = 0x1000;
const MAX_SLOTS = 1002;
const KORG_BODY_SIZE = 1180;
const ESLI_NAME_OFFSET = 0x0a;

/** Ein RIFF/WAVE-Chunk mit fmt + data + korg/esli, wie das Gerät ihn schreibt. */
function riffChunk(name: string, frames: number): Buffer {
  const pcm = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    pcm.writeInt16LE(Math.round(Math.sin((i / frames) * Math.PI * 2) * 8000), i * 2);
  }
  const bodyLen = 4 + (8 + 16) + (8 + pcm.length) + (8 + KORG_BODY_SIZE);
  const body = Buffer.alloc(bodyLen);
  let o = 0;
  o += body.write("WAVE", o, "latin1");
  o += body.write("fmt ", o, "latin1");
  body.writeUInt32LE(16, o); o += 4;
  body.writeUInt16LE(1, o); o += 2;      // PCM
  body.writeUInt16LE(1, o); o += 2;      // mono
  body.writeUInt32LE(44100, o); o += 4;
  body.writeUInt32LE(44100 * 2, o); o += 4;
  body.writeUInt16LE(2, o); o += 2;      // blockAlign
  body.writeUInt16LE(16, o); o += 2;     // bits
  o += body.write("data", o, "latin1");
  body.writeUInt32LE(pcm.length, o); o += 4;
  pcm.copy(body, o); o += pcm.length;
  o += body.write("korg", o, "latin1");
  body.writeUInt32LE(KORG_BODY_SIZE, o); o += 4;
  const korgStart = o;
  body.write("esli", korgStart, "latin1");
  body.writeUInt32LE(0x0494, korgStart + 4);
  body.write(name.slice(0, 16).padEnd(16, "\0"), korgStart + ESLI_NAME_OFFSET, "latin1");

  const chunk = Buffer.alloc(8 + body.length);
  chunk.write("RIFF", 0, "latin1");
  chunk.writeUInt32LE(body.length, 4);
  body.copy(chunk, 8);
  return chunk;
}

/** Baut eine `.all` mit den angegebenen {slotIndex → Name}-Paaren. */
function buildAll(entries: Array<{ index: number; name: string }>): Buffer {
  const chunks = entries.map((e) => ({ ...e, chunk: riffChunk(e.name, 64) }));
  const total = chunks.reduce((n, c) => n + c.chunk.length, SAMPLE_AREA_START);
  const out = Buffer.alloc(total);
  SIGNATURE.copy(out, 0);
  let cursor = SAMPLE_AREA_START;
  for (const c of chunks) {
    if (c.index >= MAX_SLOTS) throw new Error(`slot ${c.index} out of range`);
    out.writeUInt32LE(cursor, OFFSET_TABLE_START + c.index * 4);
    c.chunk.copy(out, cursor);
    cursor += c.chunk.length;
  }
  return out;
}

// ─── Test ────────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await seedActivation(page);
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
  await page.evaluate(() => window.dispatchEvent(new Event("korg:bank:export-open")));
  await page.getByTestId("korg-bank-editor-mode-edit").click();
});

test("Bank mit Sample auf Hacktribe-Slot 501 landet im Slot-Browser", async ({ page }) => {
  await page.getByTestId("korg-bank-editor-open-input").setInputFiles({
    name: "e2sSample.all",
    mimeType: "application/octet-stream",
    buffer: buildAll([
      { index: 0, name: "Kick01" },
      { index: 501, name: "Vocal01" },
    ]),
  });

  // Standard ist „Leere verbergen" — es dürfen also genau die zwei belegten
  // Slots stehen, nicht 1002 Zeilen.
  const rows = page.getByTestId("korg-bank-editor-slot-browser").locator("li");
  await expect(rows).toHaveCount(2, { timeout: 15_000 });
  await expect(page.getByTestId("korg-bank-editor-slot-0")).toBeVisible();
  await expect(page.getByTestId("korg-bank-editor-slot-501")).toBeVisible();
  await expect(page.getByTestId("korg-bank-editor-slot-501")).toContainText("Vocal01");
});

test("Leere-verbergen aus zeigt die volle Tabelle, Suche filtert sie wieder", async ({
  page,
}) => {
  await page.getByTestId("korg-bank-editor-open-input").setInputFiles({
    name: "e2sSample.all",
    mimeType: "application/octet-stream",
    buffer: buildAll([
      { index: 0, name: "Kick01" },
      { index: 501, name: "Vocal01" },
    ]),
  });
  const rows = page.getByTestId("korg-bank-editor-slot-browser").locator("li");
  await expect(rows).toHaveCount(2, { timeout: 15_000 });

  // Ohne Filter ist die ganze Tabelle da — 1002 Zeilen, nicht 250.
  await page.getByTestId("korg-bank-editor-slot-hide-empty").uncheck();
  await expect(rows).toHaveCount(1002);
  await expect(page.getByTestId("korg-bank-editor-slot-1001")).toBeAttached();

  // Suche nach dem Index greift auch auf der vollen Liste.
  await page.getByTestId("korg-bank-editor-slot-search").fill("501");
  await expect(rows).toHaveCount(1);
  await expect(page.getByTestId("korg-bank-editor-slot-501")).toBeVisible();

  // Und nach dem Namen.
  await page.getByTestId("korg-bank-editor-slot-search").fill("kick");
  await expect(rows).toHaveCount(1);
  await expect(page.getByTestId("korg-bank-editor-slot-0")).toBeVisible();

  // Kein Treffer → Hinweis statt leerer Fläche.
  await page.getByTestId("korg-bank-editor-slot-search").fill("gibtesnicht");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Keine Slots passen");
});
