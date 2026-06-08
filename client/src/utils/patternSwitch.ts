/**
 * Synthstudio – patternSwitch.ts (v3.269)
 *
 * Pure-Helper für die Performance-Pad-Switch-Entscheidung: läuft der Wechsel
 * quantisiert über die Engine-Queue (Switch am Bar/Beat-Boundary + optionaler
 * Crossfade) oder sofort?
 *
 * Regel: quantisiert NUR wenn der Transport läuft UND der Quantize-Modus nicht
 * "step" ist. Im Stop-Zustand würde ein queued Switch nie konsumiert (Scheduler
 * steht) → sofort schalten. "step" = effektiv sofort, daher direkter Pfad.
 */
import type { QuantizeMode } from "@/store/usePerformanceStore";

export function shouldQuantizeSwitch(isPlaying: boolean, quantizeMode: QuantizeMode): boolean {
  return isPlaying && quantizeMode !== "step";
}
