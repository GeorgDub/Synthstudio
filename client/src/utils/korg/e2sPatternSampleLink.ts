/**
 * e2sPatternSampleLink.ts — Pure-Helper: verknüpft E2-Pattern-Parts mit ihren
 * Samples aus einer SEPARATEN .all-Sample-Bank.
 *
 * Anders als ESX (Samples + Patterns in EINER Datei) liegen beim E2 Sampler die
 * Patterns (.e2sallpat) und die Samples (.all = e2sSample.all) in zwei Dateien.
 * Verknüpft werden sie über die GERÄTE-SAMPLE-NUMMER:
 *   - Pattern-Part trägt seine Sample-Ref bei esli/part +0x08 (z.B. 501+) →
 *     `ParsedPart.sampleId` bzw. `SynthstudioDrumPartImport.sampleId`.
 *   - .all-Sample trägt seine Nummer als OSC_0index (esli +0x08) →
 *     `E2sSlot.sampleNumber`.
 * Match per VALUE (Nummer), nicht per Offset-Tabellen-Position — robust auch bei
 * Lücken/Nicht-501-Basis (Position bzw. "id − 501" bräche bei realen Bänken).
 *
 * ☠ v3.321: Hier stand „dieselbe Nummer". Das ist widerlegt — siehe
 * `e2PatternRefToBankNumber`: der Bank-Slot liegt um **eins höher** als die
 * Pattern-Referenz. Wer die Zahlen direkt vergleicht, bekommt immer ein
 * plausibles, aber falsches Sample.
 *
 * Dieser Helper ist rein (kein Audio/DOM). Das WAV-Encoding + Blob-URL bleibt
 * im Aufrufer (Seiteneffekt), analog zum ESX-Pfad (KorgBankModal).
 */

import type { E2sBank, E2sSlot } from "./e2sBankReader";

/**
 * v3.321 — Pattern-Referenz → Bank-Slot-Nummer. **Am Gerät gemessen**
 * (2026-08-10, echtes E2S):
 *
 *     Bank-Slot (OSC_0index) == Pattern-Referenz + 1
 *
 * Der Fehler war besonders schwer zu sehen: ein Versatz von eins liefert
 * **immer ein plausibles Sample**, nur eben das falsche — nichts bleibt leer,
 * nichts schlägt fehl.
 *
 * Beleg (dreifach, unabhängig): Die Parts 1..3 referenzieren 584/586/588, das
 * Gerät spielt bei allen dreien `Jumpkick`; in der Bank liegt `Jumpkick` auf
 * 585/587/589, während 584/586/588 `KICK9`/`L3oN_HaT`/`ZaHnI_ki` sind. Deckt
 * sich mit der Anzeige-Regel vom 2026-08-09 (`Anzeige = Pattern-OSC + 1`).
 *
 * 0 heisst „kein Sample" und bleibt 0 — sonst bände ein leerer Part an Slot 1.
 */
export function e2PatternRefToBankNumber(ref: number): number {
  return ref > 0 ? ref + 1 : ref;
}

/**
 * Baut eine Lookup-Map `Geräte-Sample-Nummer (OSC_0index) → E2sSlot`.
 * Erster-Treffer-gewinnt (stabile Slot-Reihenfolge). Nummer 0 = "keins" und wird
 * übersprungen, damit unassigned-Parts nicht fälschlich an Slot 0 binden.
 */
export function buildE2sSampleMap(bank: E2sBank): Map<number, E2sSlot> {
  const map = new Map<number, E2sSlot>();
  for (const slot of bank.slots) {
    if (!slot) continue;
    if (slot.sampleNumber <= 0) continue;
    if (!map.has(slot.sampleNumber)) map.set(slot.sampleNumber, slot);
  }
  return map;
}

/**
 * Wie viele der gegebenen Part-Sample-IDs ein Sample in der Map finden würden.
 * Nützlich für User-Feedback ("12/16 Parts mit Sample verlinkt").
 */
export function countLinkableE2Parts(
  sampleIds: ReadonlyArray<number>,
  map: Map<number, E2sSlot>,
): number {
  return sampleIds.reduce((n, id) => (map.has(id) ? n + 1 : n), 0);
}

/** Diagnose-Ergebnis für die Sample-Verknüpfung eines Patterns. */
export interface E2sLinkDiagnosis {
  /** Part-Sample-Nummern (> 0), die auf ein Sample verweisen wollen. */
  requested: number[];
  /** Davon in der Bank gefunden. */
  matched: number[];
  /** Davon NICHT in der Bank (z.B. Factory-Samples oder falsche Bank). */
  missing: number[];
  /** Alle Geräte-Nummern, die die Bank tatsächlich anbietet (sortiert). */
  available: number[];
}

/**
 * Erklärt, WARUM Parts (nicht) verlinkt wurden — Input für ein aussagekräftiges
 * Toast. Ohne diese Diagnose sah der User nur "0 Spur(en) mit Sample" und
 * konnte nicht unterscheiden zwischen "falsche/keine .all-Bank" und "Part
 * verweist auf ein Factory-Sample, das nicht in der User-Bank liegt".
 *
 * `sampleIds` = die Part-Sample-Refs (0 = kein Sample → ignoriert).
 */
export function diagnoseE2sLink(
  sampleIds: ReadonlyArray<number>,
  map: ReadonlyMap<number, unknown>,
): E2sLinkDiagnosis {
  const requested: number[] = [];
  const seen = new Set<number>();
  for (const id of sampleIds) {
    if (id > 0 && !seen.has(id)) {
      seen.add(id);
      requested.push(id);
    }
  }
  const matched = requested.filter(id => map.has(id));
  const missing = requested.filter(id => !map.has(id));
  const available = Array.from(map.keys()).sort((a, b) => a - b);
  return { requested, matched, missing, available };
}

/** Toast-Text für das Ergebnis der Sample-Verknüpfung eines Pattern-Imports. */
export interface E2sSampleLinkMessage {
  /** Kurzsuffix für den Erfolgs-Toast (z.B. ", 3/4 Spur(en) mit Sample"). */
  summary: string;
  /** Optionaler Hinweis-Toast, wenn etwas fehlt (kein Bank / keine Treffer). */
  hint?: string;
}

/** Kürzt eine Zahlenliste für die Anzeige ("501, 502, 503, …"). */
function previewNumbers(nums: ReadonlyArray<number>, max = 6): string {
  if (nums.length === 0) return "—";
  const head = nums.slice(0, max).join(", ");
  return nums.length > max ? `${head}, … (+${nums.length - max})` : head;
}

/**
 * Baut eine aussagekräftige Rückmeldung für den Electribe-Import. Ersetzt das
 * frühere stumme "0 Spur(en) mit Sample", das dem User nicht sagte WARUM nichts
 * verlinkt wurde. Drei Fälle:
 *   1. Keine .all-Bank gewählt, aber Parts referenzieren Samples → Hinweis, die
 *      e2sSample.all zusätzlich zu wählen (häufigste Ursache).
 *   2. Bank gewählt, aber KEIN Part-Ref gefunden → nennt gesuchte vs. vorhandene
 *      Geräte-Nummern (deckt "falsche Bank" / "Factory-Sample" auf).
 *   3. Teil-Treffer → "X/Y verlinkt" + welche Nummern fehlen.
 *
 * @param hasBank   Ob eine .all-Sample-Bank mitgeladen wurde.
 * @param requested Sample-Refs aktiver Parts (>0), Duplikate erlaubt.
 * @param linked    Wie viele Parts tatsächlich ein Sample bekamen.
 * @param map       Die Bank-Map (nur für die Diagnose); null wenn keine Bank.
 */
export function summarizeE2sSampleLink(
  hasBank: boolean,
  requested: ReadonlyArray<number>,
  linked: number,
  map: ReadonlyMap<number, unknown> | null,
): E2sSampleLinkMessage {
  const uniqueRequested = Array.from(new Set(requested.filter(id => id > 0)));

  // Fall 1: keine Bank, aber Samples referenziert.
  if (!hasBank || !map) {
    if (uniqueRequested.length > 0) {
      return {
        summary: "",
        hint:
          `${uniqueRequested.length} Part(s) verweisen auf Samples ` +
          `(Nr. ${previewNumbers(uniqueRequested)}). Wähle zusätzlich die ` +
          `e2sSample.all-Sample-Bank (Mehrfachauswahl), damit sie zugewiesen werden.`,
      };
    }
    return { summary: "" };
  }

  const diag = diagnoseE2sLink(requested, map);
  const wanted = diag.requested.length;
  const summary = `, ${linked}/${wanted} Spur(en) mit Sample`;

  if (wanted === 0) return { summary: ", keine Sample-Refs" };
  if (linked === wanted) return { summary };

  // Teil- oder Null-Treffer: erklären, welche Nummern fehlen + was die Bank hat.
  const hint =
    `Sample-Zuweisung: ${linked}/${wanted} verlinkt. Nicht in der Bank: ` +
    `Nr. ${previewNumbers(diag.missing)}. Die Bank enthält: ` +
    `Nr. ${previewNumbers(diag.available)}. ` +
    `(Passt die .all zur Pattern-Bank? Factory-Samples liegen nicht in der User-.all.)`;
  return { summary, hint };
}

// ─── Sample-Library-Eintraege (v3.299) ────────────────────────────────────────

/**
 * Ein Eintrag, wie ihn `useProjectStore.addSamples` erwartet — bewusst
 * strukturell getippt statt `Sample` zu importieren, damit dieses Modul
 * store-frei bleibt (es ist sonst reine Format-Logik).
 */
export interface E2sLibraryEntry {
  id: string;
  name: string;
  path: string;
  category: string;
}

/**
 * Uebersetzt die Slots einer `.all` in Library-Eintraege für den
 * Sample-Browser.
 *
 * Hintergrund: bis v3.298 landeten importierte Bank-Samples ausschliesslich
 * als `sampleUrl` an den Pattern-Parts. Die Patterns klangen damit richtig,
 * aber der Sample-Browser blieb leer — er liest `useProjectStore.samples`,
 * und dorthin schrieb der Electribe-Import nie.
 *
 * Iteriert werden nur Slots mit Geraete-Sample-Nummer > 0, dieselbe Bedingung
 * wie in `buildE2sSampleMap`. Was im Browser auftaucht, ist damit
 * deckungsgleich mit dem, was ein Pattern-Part ueberhaupt treffen kann.
 *
 * Die `id` ist stabil aus Bankname + Geraete-Nummer gebildet: `addSamples`
 * dedupliziert ueber `path`, und Blob-URLs sind bei jedem Import neu — ohne
 * stabilen Schluessel legt ein zweiter Import derselben Bank alles doppelt an.
 *
 * @param resolve Liefert Blob-URL + Namen zu einer Geraete-Sample-Nummer.
 *   Wird durchgereicht statt selbst zu encodieren, damit Library-Eintrag und
 *   Pattern-Part auf DENSELBEN Blob zeigen (sonst lägen dieselben PCM-Daten
 *   zweimal im Speicher). `null` ueberspringt den Slot.
 * @param knownIds Bereits vorhandene Sample-IDs; diese Slots werden ausgelassen.
 */
export function bankSamplesToLibraryEntries(
  bank: E2sBank,
  bankFileName: string,
  resolve: (sampleNumber: number) => { url: string; name: string } | null,
  knownIds: ReadonlySet<string> = new Set(),
): E2sLibraryEntry[] {
  const out: E2sLibraryEntry[] = [];
  const seen = new Set(knownIds);
  for (const slot of bank.slots) {
    if (!slot) continue;
    if (slot.sampleNumber <= 0) continue;
    const id = e2sLibraryEntryId(bankFileName, slot.sampleNumber);
    if (seen.has(id)) continue;
    seen.add(id);
    const resolved = resolve(slot.sampleNumber);
    if (!resolved) continue;
    out.push({
      id,
      name: resolved.name,
      path: resolved.url,
      category: `E2S · ${slot.categoryName}`,
    });
  }
  return out;
}

/** Stabiler Library-Schluessel eines Bank-Samples. */
export function e2sLibraryEntryId(bankFileName: string, sampleNumber: number): string {
  return `e2s:${bankFileName}:${sampleNumber}`;
}
