/**
 * Synthstudio – utils/recordingArmCount.ts (v3.63.0)
 *
 * Aggregator-Helper für Multi-Track-Recording-UI. Kombiniert die armed-Counts
 * aus useLiveInputStore (Live-Inputs / USB-Audio) und useDrumPartRecordArmStore
 * (interne Drum/Synth-Channels) zu einer einzigen Zahl, die der Mixer-Topbar
 * und der Performance-Toast verwenden.
 *
 * Pure-fn, keine eigene Subscription — Caller bekommt einen aktuellen Wert
 * im jeweiligen Render-Tick. Beide Source-Stores nutzen Custom-Observer-
 * Pattern; die Hooks rufen `getTotalArmedCount()` lazy in der Render-Phase.
 */

import { countArmedLiveInputs, getArmedLiveInputChannelIds } from "@/store/useLiveInputStore";
import { countArmedDrumParts, getArmedDrumPartIds } from "@/store/useDrumPartRecordArmStore";

/** Anzahl ALLER record-armed Channels (Live-Inputs + Drum/Synth-Parts). */
export function getTotalArmedCount(): number {
  return countArmedLiveInputs() + countArmedDrumParts();
}

/** Alle armed Channel-IDs in Reihenfolge (Live-Inputs zuerst, dann Drum/Synth). */
export function getAllArmedChannelIds(): string[] {
  return [...getArmedLiveInputChannelIds(), ...getArmedDrumPartIds()];
}
