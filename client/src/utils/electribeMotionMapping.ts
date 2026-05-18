/**
 * client/src/utils/electribeMotionMapping.ts
 *
 * TASK-237-FOLLOWUP-1 / v2.90.0 — Pure-Logik Bridge zwischen
 * Electribe-Motion-Lanes (CustomEvent-Payload aus electribeImport.ts)
 * und Synthstudio-AutomationLanes (useAutomationStore).
 *
 * Aufrufer-Flow:
 *   1. electribeImport.ts dispatcht `electribe:motion-lanes` mit:
 *        { patternId, lanes: [{ target: "<paramName>:<partIndex>", label, points, min, max }] }
 *   2. App.tsx-Listener ruft `mapElectribeLaneToAutomationTarget(lane.target, partIds)`
 *      → liefert AutomationTarget oder null wenn unsupported.
 *   3. App.tsx ruft `addLane(target, label)` + `setPoint(laneId, step, value)` fuer
 *      jeden Punkt der Motion-Lane.
 *
 * Mapping-Strategie (konservativ):
 *   "Volume:N"    → "vol:<partId>"      (immer)
 *   "Pan:N"       → "pan:<partId>"      (immer)
 *   "FX Send:N"   → "send-rev:<partId>" (Reverb als Default-Bus — Electribe hat
 *                                        nur einen Send-Slot, Synthstudio hat
 *                                        getrennt reverb/delay; wir bevorzugen
 *                                        reverb da das musikalisch das weichere
 *                                        Default-Routing ist)
 *
 * Andere Param-Namen (Filter Cutoff, Resonance, Pitch, etc.) werden derzeit
 * NICHT auf AutomationStore-Targets gemappt, weil der AutomationStore aktuell
 * nur bpm/master-vol/vol/pan/send-rev/send-dly unterstuetzt. Erweiterte
 * Targets waeren ein separater Task (fxParam-Lanes in useAutomationStore).
 */

import type { AutomationTarget } from "@/store/useAutomationStore";

/**
 * Lane-Payload wie es electribeImport.ts dispatched.
 * Stimmt mit SynthstudioPatternImport.automationLanes ueberein.
 */
export interface ElectribeMotionLane {
  /** "<paramName>:<partIndex>" — z.B. "Volume:3" oder "Filter Cutoff:0". */
  target: string;
  label: string;
  /** Sparse step → value (0..1 normalisiert). */
  points: Record<number, number>;
  min: number;
  max: number;
}

export interface ElectribeMotionLanePayload {
  patternId: string;
  lanes: ElectribeMotionLane[];
}

/**
 * Parsed-Tupel aus dem target-String: { paramName, partIndex }.
 * @returns null wenn Format ungueltig.
 */
export function parseElectribeLaneTarget(
  target: string,
): { paramName: string; partIndex: number } | null {
  const colon = target.lastIndexOf(":");
  if (colon < 1 || colon === target.length - 1) return null;
  const paramName = target.slice(0, colon).trim();
  const partIndexStr = target.slice(colon + 1).trim();
  const partIndex = Number(partIndexStr);
  if (!Number.isFinite(partIndex) || partIndex < 0 || !Number.isInteger(partIndex)) return null;
  if (!paramName) return null;
  return { paramName, partIndex };
}

/**
 * Mappt einen Electribe-Motion-Lane-Target-String auf ein Synthstudio
 * AutomationTarget.
 *
 * @param electribeTarget   z.B. "Volume:3"
 * @param partIds           Array der Drum-Part-IDs des Ziel-Patterns (Index 0..15)
 * @returns AutomationTarget oder null wenn Param oder Index unsupported.
 */
export function mapElectribeLaneToAutomationTarget(
  electribeTarget: string,
  partIds: ReadonlyArray<string>,
): AutomationTarget | null {
  const parsed = parseElectribeLaneTarget(electribeTarget);
  if (!parsed) return null;
  const partId = partIds[parsed.partIndex];
  if (!partId) return null;

  switch (parsed.paramName) {
    case "Volume":
      return `vol:${partId}`;
    case "Pan":
      return `pan:${partId}`;
    case "FX Send":
      // Electribe hat nur einen Send → Reverb-Bus als musikalisches Default.
      return `send-rev:${partId}`;
    default:
      return null;
  }
}

/**
 * Konvertiert die Sparse-Motion-Points (0..1 normalisiert in 16-Step-Slots)
 * auf den Synthstudio-Step-Range. Electribe-Motion-Slots haben 16 Steps; bei
 * targetStepCount=32/64 werden die Werte über 2x bzw. 4x gestreckt.
 *
 * @param points         Electribe-Points (key=0..15)
 * @param targetStepCount 16 | 32 | 64 — Step-Count des Ziel-Patterns
 * @returns gestrechtes Sparse-Map
 */
export function scaleMotionPointsToStepCount(
  points: Record<number, number>,
  targetStepCount: 16 | 32 | 64,
): Record<number, number> {
  if (targetStepCount === 16) return { ...points };
  const factor = targetStepCount === 32 ? 2 : 4;
  const out: Record<number, number> = {};
  for (const key of Object.keys(points)) {
    const k = Number(key);
    if (!Number.isFinite(k)) continue;
    const targetStep = Math.min(targetStepCount - 1, k * factor);
    out[targetStep] = points[k];
  }
  return out;
}

/**
 * Convenience-Helper: liefert eine flache Liste von
 * "convertable" Lanes (also solche, deren mapElectribeLaneToAutomationTarget
 * nicht null ist). Lanes ohne Mapping werden ausgefiltert.
 */
export function selectConvertableLanes(
  lanes: ReadonlyArray<ElectribeMotionLane>,
  partIds: ReadonlyArray<string>,
): Array<{ lane: ElectribeMotionLane; target: AutomationTarget }> {
  const out: Array<{ lane: ElectribeMotionLane; target: AutomationTarget }> = [];
  for (const lane of lanes) {
    const target = mapElectribeLaneToAutomationTarget(lane.target, partIds);
    if (target) out.push({ lane, target });
  }
  return out;
}
