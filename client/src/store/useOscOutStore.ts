/**
 * Synthstudio – useOscOutStore (v2.26)
 *
 * Mini-Store für die OSC-Out-Konfiguration (BPM-Sync-Out an externe
 * Empfänger). Persistiert in localStorage, kein Server-Bezug — die
 * eigentliche UDP-Send-Logik läuft via electron.sendOscMessage().
 */
import { useReducer, useEffect } from "react";

export interface OscOutConfig {
  enabled: boolean;
  host: string;
  port: number;
  /** Sendet `/synth/bpm/current <float>` bei jeder BPM-Änderung. */
  syncBpm: boolean;
}

const STORAGE_KEY = "ss-osc-out:v1";
const DEFAULT: OscOutConfig = {
  enabled: false,
  host: "127.0.0.1",
  port: 7401,
  syncBpm: true,
};

let _config: OscOutConfig = load();
const _listeners = new Set<() => void>();

function load(): OscOutConfig {
  try {
    if (typeof localStorage === "undefined") return { ...DEFAULT };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw) as Partial<OscOutConfig>;
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT.enabled,
      host:    typeof parsed.host === "string" ? parsed.host : DEFAULT.host,
      port:    typeof parsed.port === "number" ? parsed.port : DEFAULT.port,
      syncBpm: typeof parsed.syncBpm === "boolean" ? parsed.syncBpm : DEFAULT.syncBpm,
    };
  } catch {
    return { ...DEFAULT };
  }
}

function persist(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_config));
  } catch { /* ignore */ }
}

function notify(): void {
  _listeners.forEach(l => l());
}

export function getOscOutConfig(): OscOutConfig {
  return _config;
}

export function setOscOutConfig(update: Partial<OscOutConfig>): void {
  _config = { ..._config, ...update };
  // Port-Range clampen damit der UDP-Socket nicht EACCES wirft.
  _config.port = Math.max(1, Math.min(65535, Math.floor(_config.port)));
  persist();
  notify();
}

export function useOscOutConfig(): OscOutConfig {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return _config;
}
