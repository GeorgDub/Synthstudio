/**
 * Synthstudio – Patch-Serialisierung (v2.16, Hot-Swap-Patches)
 *
 * Eine *Patch* ist eine portable Sound-Konfiguration eines Parts:
 * Sample-URL, Synth-Parameter, Granular-Parameter und FX-Chain.
 * Pure Funktionen für Extraction + Application — Tests laufen ohne Audio.
 */
import type { PartData } from "@/audio/AudioEngine";
import type { SynthParams } from "@/audio/SynthEngine";

export interface Patch {
  /** Stable ID, generiert beim Speichern. */
  id: string;
  /** Vom User vergebener Anzeigename. */
  name: string;
  /** Source-Type: bestimmt welche der Sound-Felder relevant sind. */
  sourceType?: PartData["sourceType"];
  /** Sample-URL/-Path (nur bei sourceType=sample). */
  sampleUrl?: string;
  /** Anzeigename des Samples. */
  sampleName?: string;
  /** Synthesizer-Parameter (nur bei sourceType=wavetable/fm). */
  synthParams?: SynthParams;
  /** Granular-Parameter (nur bei sourceType=granular). */
  granularParams?: import("@/audio/GranularEngine").GranularParams;
  /** Vollständige FX-Chain. Optional damit Patches ohne FX speicherbar sind. */
  fx?: PartData["fx"];
  /** Tag-Liste für die Library-Suche. */
  tags?: string[];
  /** Erstellungs-Zeit (ms epoch). */
  createdAt: number;
}

/**
 * Extrahiert die Sound-relevanten Felder eines Parts in eine portable Patch.
 * Erbt sample/synth/granular je nach sourceType, greift aber im Zweifel auf
 * alle vorhandenen Felder zurück (defensive falls sourceType undefined).
 *
 * `includeFx=false` lässt die FX weg – z.B. wenn der User nur den Klang
 * des Oszillators speichern will, nicht die kompletten Insert-Effekte.
 */
export function extractPatch(
  part: PartData,
  name: string,
  options: { includeFx?: boolean; tags?: string[] } = {},
): Patch {
  const includeFx = options.includeFx ?? true;
  const patch: Patch = {
    id: nextPatchId(),
    name: name.trim() || `Patch ${new Date().toLocaleTimeString()}`,
    sourceType: part.sourceType,
    sampleUrl: part.sampleUrl,
    sampleName: part.sampleName,
    synthParams: part.synthParams ? { ...part.synthParams } : undefined,
    granularParams: part.granularParams ? { ...part.granularParams } : undefined,
    fx: includeFx && part.fx ? { ...part.fx } : undefined,
    tags: options.tags ? [...options.tags] : undefined,
    createdAt: Date.now(),
  };
  return patch;
}

/**
 * Wendet eine Patch auf einen Part an und liefert das aktualisierte Part-Objekt
 * (Immutable-Pattern). Felder, die in der Patch undefined sind, bleiben in der
 * Part erhalten — so kann z.B. eine "nur-FX-Patch" angewendet werden ohne den
 * Sample-Slot zu überschreiben.
 *
 * `replaceFx=false` bewahrt die existierende FX-Chain auch wenn die Patch eine
 * mitliefert (z.B. wenn der User nur den Sound, nicht die Insert-Effekte
 * übernehmen möchte).
 */
export function applyPatch(
  part: PartData,
  patch: Patch,
  options: { replaceFx?: boolean } = {},
): PartData {
  const replaceFx = options.replaceFx ?? true;
  return {
    ...part,
    sourceType: patch.sourceType ?? part.sourceType,
    sampleUrl: patch.sampleUrl ?? part.sampleUrl,
    sampleName: patch.sampleName ?? part.sampleName,
    synthParams: patch.synthParams ? { ...patch.synthParams } : part.synthParams,
    granularParams: patch.granularParams ? { ...patch.granularParams } : part.granularParams,
    fx: replaceFx && patch.fx ? { ...patch.fx } : part.fx,
  };
}

/**
 * JSON-Round-Trip — z.B. für Project-Save oder Library-Export.
 * Validiert das Schema beim Lesen und liefert null bei Fehlern.
 */
export function patchToJson(patch: Patch): string {
  return JSON.stringify(patch);
}

export function patchFromJson(json: string): Patch | null {
  try {
    const parsed = JSON.parse(json) as Partial<Patch>;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.id !== "string" || typeof parsed.name !== "string") return null;
    if (typeof parsed.createdAt !== "number") return null;
    return {
      id: parsed.id,
      name: parsed.name,
      sourceType: parsed.sourceType,
      sampleUrl: typeof parsed.sampleUrl === "string" ? parsed.sampleUrl : undefined,
      sampleName: typeof parsed.sampleName === "string" ? parsed.sampleName : undefined,
      synthParams: parsed.synthParams as SynthParams | undefined,
      granularParams: parsed.granularParams,
      fx: parsed.fx,
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t: unknown) => typeof t === "string") : undefined,
      createdAt: parsed.createdAt,
    };
  } catch {
    return null;
  }
}

let _idCounter = 0;
function nextPatchId(): string {
  _idCounter++;
  return `patch_${Date.now()}_${_idCounter}_${Math.random().toString(36).slice(2, 6)}`;
}
