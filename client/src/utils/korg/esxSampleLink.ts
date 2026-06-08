/**
 * esxSampleLink.ts — Pure-Helper: ordnet ESX-Pattern-Parts ihren Bank-Samples zu.
 *
 * Synth.md-Bug: ".esx mit Sampler+Pattern geladen, alles zugewiesen, aber Play
 * spielt nicht ab." Ursache: die importierten Parts trugen nur einen
 * Positions-Label (sampleHint), aber KEINE sampleUrl → der Sequencer hatte
 * keinen Audio-Buffer → stumm.
 *
 * Dieser Helper bestimmt rein (ohne Audio/DOM), welcher Bank-Slot zu welchem
 * Part gehört. Das eigentliche Blob-URL-Encoding bleibt im KorgBankModal (Seiteneffekt).
 */

/** Minimal-Shape eines Parts mit Sample-Referenz. */
export interface PartWithSampleId {
  partIndex: number;
  sampleId: number;
}

/** Minimal-Shape eines Bank-Slots (Index = Position in der Bank). */
export interface BankSlotRef {
  index: number;
}

/**
 * Liefert für einen Part den Index in `slots`, dessen `.index === sampleId`
 * ist — oder -1 wenn kein Slot passt (dann bleibt der Part stumm wie bisher,
 * keine Regression).
 *
 * Konservativ: nur exakte Index-Matches. So wird im Zweifel KEIN falsches
 * Sample zugeordnet.
 */
export function resolveSlotForPart(
  part: PartWithSampleId,
  slots: ReadonlyArray<BankSlotRef>,
): number {
  if (!Number.isFinite(part.sampleId)) return -1;
  return slots.findIndex((s) => s.index === part.sampleId);
}

/**
 * Baut eine Lookup-Map sampleId → erster passender Slot-Array-Index.
 * Erster-Treffer-gewinnt (stabile Reihenfolge der Bank-Liste).
 */
export function buildSlotIndexMap(
  slots: ReadonlyArray<BankSlotRef>,
): Map<number, number> {
  const map = new Map<number, number>();
  slots.forEach((s, arrayIdx) => {
    if (!map.has(s.index)) map.set(s.index, arrayIdx);
  });
  return map;
}

/**
 * Wie viele Parts einer Part-Liste einen abspielbaren Slot finden würden.
 * Nützlich für User-Feedback ("3/16 Parts ohne Sample").
 */
export function countLinkablePats(
  parts: ReadonlyArray<PartWithSampleId>,
  slots: ReadonlyArray<BankSlotRef>,
): number {
  const map = buildSlotIndexMap(slots);
  return parts.reduce((n, p) => (map.has(p.sampleId) ? n + 1 : n), 0);
}
