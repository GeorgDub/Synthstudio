/**
 * Synthstudio – useOscOutBridge (v2.47)
 *
 * Hängt alle OSC-Out-Effekte (BPM/Transport/Step/Mute/Macro/Volume/
 * Pattern-Switch) auf einmal an. Wurde aus App.tsx herausgezogen weil die
 * sieben useEffect-Blöcke ~155 Zeilen ausmachten — analog zur v2.40
 * MIDI-Bridge-Extraktion.
 *
 * Architektur:
 * - Pure-Diff-Helpers (diffMuteSnapshots, diffMacroSnapshots,
 *   diffVolumeSnapshots) sind ohne Electron/React testbar.
 * - Hook macht das useEffect-Wiring + Send-Side-Effects.
 * - oscOutConfig wird per useRef gespiegelt (kein Re-Mount des
 *   Step-Listeners bei jedem Config-Edit).
 */
import { useEffect, useRef } from "react";
import { AudioEngine } from "@/audio/AudioEngine";
import type { OscOutConfig } from "@/store/useOscOutStore";

// ─── Pure Diff-Helpers ──────────────────────────────────────────────────────

export interface MuteSnapshot {
  /** partId → muted */
  current: Map<string, boolean>;
}

/**
 * Diff zweier Mute-Snapshots. Liefert die Parts deren Mute-Status sich
 * geändert hat. Neue Parts (prev kennt sie nicht) werden NICHT zurückgegeben
 * — der initial-broadcast soll nicht gefeuert werden, das matched
 * Pre-Refactor-Verhalten in App.tsx ("if prev !== undefined").
 */
export function diffMuteSnapshots(
  prev: Map<string, boolean>,
  next: Map<string, boolean>,
): Array<{ partId: string; muted: boolean }> {
  const changes: Array<{ partId: string; muted: boolean }> = [];
  for (const [partId, muted] of next) {
    const p = prev.get(partId);
    if (p !== undefined && p !== muted) {
      changes.push({ partId, muted });
    }
  }
  return changes;
}

/** Analog: Volume-Diff. */
export function diffVolumeSnapshots(
  prev: Map<string, number>,
  next: Map<string, number>,
): Array<{ partId: string; volume: number }> {
  const changes: Array<{ partId: string; volume: number }> = [];
  for (const [partId, vol] of next) {
    const p = prev.get(partId);
    if (p !== undefined && p !== vol) {
      changes.push({ partId, volume: vol });
    }
  }
  return changes;
}

/** Analog: Macro-Diff über fixen 8-Slot-Array. */
export function diffMacroSnapshots(
  prev: number[],
  next: number[],
): Array<{ index: number; value: number }> {
  const changes: Array<{ index: number; value: number }> = [];
  for (let i = 0; i < next.length; i++) {
    const p = prev[i];
    if (p !== undefined && p !== next[i]) {
      changes.push({ index: i, value: next[i] });
    }
  }
  return changes;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

type SendOscFn = (msg: {
  host: string;
  port: number;
  address: string;
  args: Array<number | string>;
}) => Promise<unknown> | unknown;

export interface UseOscOutBridgeArgs {
  /** Aktiv nur wenn isElectron=true (Browser hat keinen OSC-Sender). */
  isElectron: boolean;
  /** Aktuelle Config — Re-Run bei Änderungen. */
  oscOutConfig: OscOutConfig;
  /** Sendet eine einzelne OSC-Message an den konfigurierten Empfänger. */
  sendOscMessage: SendOscFn;
  /** Aktueller Projekt-BPM (gerendert in useEffect-deps). */
  bpm: number;
  /** Transport-State. */
  isPlaying: boolean;
  /**
   * Snapshot des aktiven Patterns für Mute/Volume-Diffs.
   * Wenn null wird nichts gesendet.
   */
  activeParts: Array<{ id: string; muted: boolean; volume: number }> | null;
  /** ID des aktuell aktiven Patterns für Pattern-Switch-Diff. */
  activePatternId: string;
  /** Macro-Snapshot (typisch 8 Slots; Länge ist flexibel). */
  macroValues: number[];
}

export function useOscOutBridge(args: UseOscOutBridgeArgs): void {
  const {
    isElectron, oscOutConfig, sendOscMessage,
    bpm, isPlaying, activeParts, activePatternId, macroValues,
  } = args;

  // ── ConfigRef für Step-Listener (kein Re-Mount pro Edit) ────────────────
  const cfgRef = useRef(oscOutConfig);
  cfgRef.current = oscOutConfig;
  const sendRef = useRef(sendOscMessage);
  sendRef.current = sendOscMessage;

  // ── BPM-Sync (v2.26) ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isElectron) return;
    if (!oscOutConfig.enabled || !oscOutConfig.syncBpm) return;
    void sendOscMessage({
      host: oscOutConfig.host,
      port: oscOutConfig.port,
      address: "/synth/bpm/current",
      args: [bpm],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bpm, oscOutConfig.enabled, oscOutConfig.syncBpm, oscOutConfig.host, oscOutConfig.port, isElectron]);

  // ── Transport (v2.27) ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isElectron) return;
    if (!oscOutConfig.enabled || !oscOutConfig.syncTransport) return;
    void sendOscMessage({
      host: oscOutConfig.host,
      port: oscOutConfig.port,
      address: isPlaying ? "/synth/transport/play" : "/synth/transport/stop",
      args: [],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, oscOutConfig.enabled, oscOutConfig.syncTransport, oscOutConfig.host, oscOutConfig.port, isElectron]);

  // ── Step-Position rate-limited (v2.27) ─────────────────────────────────
  useEffect(() => {
    if (!isElectron) return;
    const unsubscribe = AudioEngine.onPosition((stepIndex) => {
      const cfg = cfgRef.current;
      if (!cfg.enabled || !cfg.syncStep) return;
      if (stepIndex % Math.max(1, cfg.stepRate) !== 0) return;
      void sendRef.current({
        host: cfg.host,
        port: cfg.port,
        address: "/synth/step",
        args: [stepIndex],
      });
    });
    return unsubscribe;
  }, [isElectron]);

  // ── Mute-Diff pro Part (v2.28) ──────────────────────────────────────────
  const prevMutedRef = useRef<Map<string, boolean>>(new Map());
  useEffect(() => {
    if (!isElectron) return;
    const cfg = oscOutConfig;
    if (!cfg.enabled || !cfg.syncMutes) return;
    if (!activeParts) return;
    const next = new Map<string, boolean>();
    for (const p of activeParts) next.set(p.id, !!p.muted);
    const changes = diffMuteSnapshots(prevMutedRef.current, next);
    for (const { partId, muted } of changes) {
      void sendOscMessage({
        host: cfg.host,
        port: cfg.port,
        address: `/synth/mute/${encodeURIComponent(partId)}`,
        args: [muted ? "1" : "0"],
      });
    }
    prevMutedRef.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    JSON.stringify(activeParts?.map((p) => ({ id: p.id, muted: p.muted })) ?? []),
    oscOutConfig.enabled,
    oscOutConfig.syncMutes,
    isElectron,
  ]);

  // ── Macro-Diff (v2.28) ──────────────────────────────────────────────────
  const prevMacrosRef = useRef<number[]>([]);
  useEffect(() => {
    if (!isElectron) return;
    const cfg = oscOutConfig;
    if (!cfg.enabled || !cfg.syncMacros) return;
    const changes = diffMacroSnapshots(prevMacrosRef.current, macroValues);
    for (const { index, value } of changes) {
      void sendOscMessage({
        host: cfg.host,
        port: cfg.port,
        address: `/synth/macro/${index}`,
        args: [value],
      });
    }
    prevMacrosRef.current = macroValues;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [macroValues, oscOutConfig.enabled, oscOutConfig.syncMacros, isElectron]);

  // ── Volume-Diff pro Part (v2.31) ────────────────────────────────────────
  const prevVolumesRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (!isElectron) return;
    const cfg = oscOutConfig;
    if (!cfg.enabled || !cfg.syncVolumes) return;
    if (!activeParts) return;
    const next = new Map<string, number>();
    for (const p of activeParts) next.set(p.id, p.volume ?? 1);
    const changes = diffVolumeSnapshots(prevVolumesRef.current, next);
    for (const { partId, volume } of changes) {
      void sendOscMessage({
        host: cfg.host,
        port: cfg.port,
        address: `/synth/volume/${encodeURIComponent(partId)}`,
        args: [volume],
      });
    }
    prevVolumesRef.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    JSON.stringify(activeParts?.map((p) => ({ id: p.id, volume: p.volume })) ?? []),
    oscOutConfig.enabled,
    oscOutConfig.syncVolumes,
    isElectron,
  ]);

  // ── Pattern-Switch (v2.31) ──────────────────────────────────────────────
  const prevPatternSwitchRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isElectron) return;
    const cfg = oscOutConfig;
    if (!cfg.enabled || !cfg.syncPatternSwitch) return;
    if (prevPatternSwitchRef.current !== null && prevPatternSwitchRef.current !== activePatternId) {
      void sendOscMessage({
        host: cfg.host,
        port: cfg.port,
        address: "/synth/pattern",
        args: [activePatternId],
      });
    }
    prevPatternSwitchRef.current = activePatternId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePatternId, oscOutConfig.enabled, oscOutConfig.syncPatternSwitch, isElectron]);
}
