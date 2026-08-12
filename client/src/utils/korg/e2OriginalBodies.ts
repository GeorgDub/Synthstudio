/**
 * e2OriginalBodies — merkt sich je Store-Pattern-ID den Original-Body
 * (16384-Byte-PTST-Record), aus dem ein Pattern importiert wurde.
 *
 * Warum: ein Body trägt weit mehr, als SynthStudio liest (Gate-Flag/-Länge,
 * Motion-Bytes +0x05..+0x0B, Part-Config, FX, Groove …). Der Export baut
 * deshalb per `buildE2PatternBody(input, { base })` auf dem Original auf und
 * überschreibt nur adressierte Bytes — derselbe Mechanismus, mit dem der
 * Geräte-Push 250/250 Werks-Patterns byte-gleich zurückgibt
 * (korg-e2-push-original-body.test.ts). Der Geräte-Pfad hält sein Original
 * im useE2sDeviceStore (`currentBody`, ein einzelner Pull); der Datei-Import
 * bringt beliebig viele Patterns auf einmal — daher diese Registry.
 *
 * Bewusst NICHT im Store/Projekt persistiert: die Bodies sind Binärdaten
 * (16 KB je Pattern) und nur für die Sitzung relevant. Nach einem Neustart
 * fällt der Export aufs Init-Template zurück — verlustbehaftet, aber gültig,
 * exakt der Stand vor dieser Registry.
 */
import { E2_PATTERN_BODY_SIZE } from "./e2Layout";

const merker = new Map<string, Uint8Array>();

/**
 * Merkt sich den Original-Body eines Patterns — als KOPIE (der Aufrufer darf
 * seinen Puffer weiterverwenden; ein View würde zudem die ganze 4-MB-Bank
 * am Leben halten).
 *
 * ☠ `undefined`/falsche Länge RÄUMT einen Alt-Eintrag weg, statt ihn stehen
 * zu lassen: importiert jemand eine Legacy-Datei (ohne Body) auf dasselbe
 * Pattern, gehörte der gemerkte Body nicht mehr zum Store-Inhalt — der
 * Export würde auf einem fremden Original überlagern.
 */
export function rememberE2OriginalBody(
  patternId: string,
  body: Uint8Array | undefined | null
): void {
  if (!patternId) return;
  if (body instanceof Uint8Array && body.length === E2_PATTERN_BODY_SIZE) {
    merker.set(patternId, Uint8Array.from(body));
  } else {
    merker.delete(patternId);
  }
}

/**
 * Liefert den gemerkten Original-Body als Kopie — oder undefined (dann fällt
 * der Export wie bisher aufs Init-Template zurück).
 */
export function getE2OriginalBody(patternId: string): Uint8Array | undefined {
  const body = merker.get(patternId);
  return body ? Uint8Array.from(body) : undefined;
}

/** Leert die Registry (Tests / Projekt-Wechsel). */
export function clearE2OriginalBodies(): void {
  merker.clear();
}
