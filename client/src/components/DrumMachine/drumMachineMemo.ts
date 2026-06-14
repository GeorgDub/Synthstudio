/**
 * Synthstudio – drumMachineMemo.ts (TASK-247)
 *
 * Pure React.memo-Comparator für die DrumMachine-Komponente.
 *
 * Der Perf-Kern des Tasks: App.tsx besitzt den dm-State (useDrumMachineStore)
 * und erzeugt bei JEDEM `setCurrentStep` ein frisches dm-Objekt → App
 * re-rendert → DrumMachine bekommt ein neues `dm`-Prop und würde komplett
 * neu rendern, OBWOHL sich nur der Playhead-Step geändert hat.
 *
 * Dieser Comparator lässt DrumMachine den Parent-Rerender überspringen, wenn
 * sich AUSSCHLIESSLICH `dm.currentStep` unterscheidet. Der Playhead selbst
 * läuft über usePlayheadStore in kleinen abonnierten Kindern weiter — die
 * große Komponente bleibt stehen.
 *
 * Robust gegen künftige dm-Felder: statt einer handgepflegten Feldliste wird
 * generisch über alle dm-Keys (außer `currentStep`) per Object.is verglichen.
 */

/** Minimal-Form der DrumMachine-Props, die der Comparator vergleicht. */
export interface DrumMachineMemoProps {
  dm: Record<string, unknown> & { currentStep: number };
  samples: unknown;
  isPlaying: boolean;
  bpm: number;
  onPlayStop: unknown;
  onBpmChange: unknown;
  className?: string;
  externalSyncEnabled?: boolean;
  externalSyncStatus?: string;
}

/** Top-Level-Props (alles außer `dm`), die per Object.is verglichen werden. */
const TOP_LEVEL_KEYS: ReadonlyArray<keyof DrumMachineMemoProps> = [
  "samples",
  "isPlaying",
  "bpm",
  "onPlayStop",
  "onBpmChange",
  "className",
  "externalSyncEnabled",
  "externalSyncStatus",
];

/**
 * @returns `true` → Props gleich, Rerender ÜBERSPRINGEN. `false` → neu rendern.
 *
 * Skip nur dann, wenn alle Top-Level-Props referenziell gleich sind UND sich
 * im dm-Objekt höchstens `currentStep` unterscheidet.
 */
export function drumMachinePropsAreEqual(
  prev: DrumMachineMemoProps,
  next: DrumMachineMemoProps,
): boolean {
  // 1) Top-Level-Props (alles außer dm) müssen referenziell gleich sein.
  for (const key of TOP_LEVEL_KEYS) {
    if (!Object.is(prev[key], next[key])) return false;
  }

  // 2) dm: generisch über alle Keys (außer currentStep) vergleichen.
  const a = prev.dm;
  const b = next.dm;
  if (a === b) return true; // gleiche Referenz → garantiert identisch

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;

  for (const k of aKeys) {
    if (k === "currentStep") continue; // Playhead läuft über usePlayheadStore
    if (!Object.is(a[k], b[k])) return false;
  }
  return true;
}
