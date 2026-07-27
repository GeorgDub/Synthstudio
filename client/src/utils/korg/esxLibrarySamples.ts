/**
 * esxLibrarySamples.ts — baut aus einer geparsten ESX-1-Bank die
 * Sample-Browser-Einträge (Project-Store `Sample[]`), damit beim
 * „In Sequenzer laden" die verwendeten Samples auch links im Sample-Browser
 * erscheinen und dort auf andere Parts getauscht werden können.
 *
 * Rein (kein DOM/Blob): der Controller erzeugt die Blob-URLs (Browser-Seiteneffekt)
 * und die WAV-Bytes; diese Funktion verteilt Namen/Kategorie/Größe/Embed und
 * bildet stabile IDs. So bleibt der Pfad in Node testbar.
 *
 * `path` ist die Blob-URL (dieselbe wie am Part) → Playback im Browser nutzt
 * denselben Blob. `embeddedData` (Base64-WAV) macht das Sample projekt-persistent
 * (Blob-URLs sterben beim Reload — das Embed wird beim Save geschrieben und beim
 * Load zu frischem Buffer/Blob restauriert, analog transformierter Samples).
 */

import type { EsxBank, EsxSample } from "./esxParser";
import type { Sample } from "@/store/useProjectStore";
import { uint8ArrayToBase64, MAX_EMBED_SIZE_KB } from "@/utils/sampleEmbedding";

/** Kategorie-Label für ESX-importierte Library-Samples. */
export const ESX_LIBRARY_CATEGORY = "KORG ESX";

/** Lesbarer Fallback-Name, wenn der Slot keinen ASCII-Namen trägt. */
function sampleName(s: EsxSample): string {
  const trimmed = (s.name ?? "").trim();
  return trimmed.length > 0 ? trimmed : `ESX ${s.index}`;
}

/**
 * Baut `Sample[]` (Project-Store-Form) für alle Bank-Slots, die eine Blob-URL
 * in `urlBySampleId` haben (d.h. die tatsächlich mitgeladen wurden). Optional
 * werden die WAV-Bytes (`wavBySampleId`) als Base64 eingebettet, damit das
 * Sample einen Projekt-Save/Reload überlebt.
 *
 * @param bank            Geparste ESX-Bank (Namen/Slot-Metadaten).
 * @param urlBySampleId   Map Slot-Index (== EsxSample.index) → Blob-/Object-URL.
 * @param wavBySampleId   Optional: dieselbe Slot-Map → WAV-Bytes (für Embed).
 * @param idPrefix        Prefix für stabile, kollisionsarme IDs (default "esx").
 */
export function buildEsxLibrarySamples(
  bank: EsxBank,
  urlBySampleId: ReadonlyMap<number, string>,
  wavBySampleId?: ReadonlyMap<number, Uint8Array>,
  idPrefix = "esx",
): Sample[] {
  if (urlBySampleId.size === 0) return [];

  const byIndex = new Map<number, EsxSample>();
  for (const s of [...bank.monoSamples, ...bank.stereoSamples]) {
    byIndex.set(s.index, s);
  }

  const out: Sample[] = [];
  for (const [sampleId, url] of urlBySampleId) {
    const s = byIndex.get(sampleId);
    if (!s) continue;
    const wav = wavBySampleId?.get(sampleId);
    // Embed nur, wenn es unter dem Größen-Limit liegt (sonst Blob-URL-only).
    const embeddedData =
      wav && wav.byteLength <= MAX_EMBED_SIZE_KB * 1024
        ? uint8ArrayToBase64(wav)
        : undefined;
    out.push({
      id: `${idPrefix}-${sampleId}-${bank.source || "bank"}`,
      name: sampleName(s),
      path: url,
      category: ESX_LIBRARY_CATEGORY,
      size: wav?.byteLength,
      tags: s.channels === 2 ? ["esx", "stereo"] : ["esx"],
      ...(embeddedData ? { embeddedData } : {}),
    });
  }
  return out;
}
