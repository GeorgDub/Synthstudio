/**
 * PluginRegistry — v3.44.0 (TASK-239 Phase 1: AudioWorklet-Plugin-Host)
 *
 * Foundation für VST-ähnliche Plugin-Architektur in Synthstudio. Phase-1
 * unterstützt JS-basierte AudioWorklet-Plugins (loaded zur AudioEngine-Init).
 * Phase-2 (v4.0+) wird native VST3/CLAP via Electron-IPC + JUCE-Node-Addon
 * hinzufügen — siehe Phase-2-Stub am Ende der Datei.
 *
 * Architektur:
 *  - `registerPlugin(manifest)` — fügt einen Plugin-Manifest zur Registry hinzu
 *  - `getPlugins()` — liefert alle registrierten Plugins
 *  - `getPlugin(id)` — Lookup per id
 *  - `registerBuiltInPlugins()` — Idempotent; registriert die 3 Built-Ins
 *
 * Plugin-Manifest:
 *  - `id` — eindeutig (z.B. "synthstudio.tape-sat")
 *  - `name`, `version`
 *  - `paramSchema` — Array von Param-Definitionen für die Generic-UI
 *  - `workletUrl` — Web-URL zur .js-Datei (für `audioWorklet.addModule()`)
 *  - `processorName` — Name unter dem der Worklet sich registriert
 *
 * Pure: keine DOM-Abhängigkeit; das Modul ist isomorph (Browser + Electron).
 */

export interface PluginParamDef {
  /** Eindeutige ID innerhalb des Plugins, z.B. "drive" oder "mix". */
  id: string;
  /** Anzeige-Label in der UI. */
  label: string;
  /** Minimum (numerisch). */
  min: number;
  /** Maximum (numerisch). */
  max: number;
  /** Defaultwert beim Instanziieren. */
  default: number;
  /** Optional: Einheit-String (z.B. "Hz", "dB", "%"). */
  unit?: string;
  /** Optional: Schrittweite für den UI-Slider. */
  step?: number;
}

export interface PluginManifest {
  /** Eindeutige Plugin-ID, z.B. "synthstudio.tape-sat". */
  id: string;
  /** Anzeigename des Plugins. */
  name: string;
  /** Plugin-Version (Semver). */
  version: string;
  /** Parameter-Schema (Generic-UI-Gen). */
  paramSchema: PluginParamDef[];
  /** Web-URL zum AudioWorklet-Modul. */
  workletUrl: string;
  /** Name unter dem das Worklet `registerProcessor()` aufruft. */
  processorName: string;
  /**
   * Optional: Built-In Flag — verhindert dass User-Plugins die selbe ID
   * überschreiben können. v3.45+ wird User-Plugin-Drop unterstützen.
   */
  builtIn?: boolean;
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Prüft ein Manifest-Objekt strukturell. Defensive für unbekannte
 * User-Plugin-Quellen — die Registrierung wirft bei Fehlern.
 */
export function validatePluginManifest(manifest: unknown): manifest is PluginManifest {
  if (!manifest || typeof manifest !== "object") return false;
  const m = manifest as Record<string, unknown>;
  if (typeof m.id !== "string" || m.id.length === 0) return false;
  if (typeof m.name !== "string" || m.name.length === 0) return false;
  if (typeof m.version !== "string" || m.version.length === 0) return false;
  if (typeof m.workletUrl !== "string" || m.workletUrl.length === 0) return false;
  if (typeof m.processorName !== "string" || m.processorName.length === 0) return false;
  if (!Array.isArray(m.paramSchema)) return false;
  for (const p of m.paramSchema) {
    if (!p || typeof p !== "object") return false;
    const pp = p as Record<string, unknown>;
    if (typeof pp.id !== "string" || pp.id.length === 0) return false;
    if (typeof pp.label !== "string") return false;
    if (typeof pp.min !== "number" || !Number.isFinite(pp.min)) return false;
    if (typeof pp.max !== "number" || !Number.isFinite(pp.max)) return false;
    if (typeof pp.default !== "number" || !Number.isFinite(pp.default)) return false;
    if (pp.max < pp.min) return false;
    if (pp.default < pp.min || pp.default > pp.max) return false;
  }
  return true;
}

// ─── Registry-Singleton (Module-Scope) ──────────────────────────────────────

const _registry = new Map<string, PluginManifest>();

/**
 * Fügt einen Plugin-Manifest zur Registry hinzu. Wirft wenn das Manifest
 * fehlerhaft ist ODER wenn ein Built-In mit derselben ID ersetzt werden
 * soll (`forceOverwrite=false`).
 */
export function registerPlugin(
  manifest: PluginManifest,
  opts: { forceOverwrite?: boolean } = {},
): void {
  if (!validatePluginManifest(manifest)) {
    throw new Error(`[PluginRegistry] Invalid plugin manifest`);
  }
  const existing = _registry.get(manifest.id);
  if (existing && existing.builtIn && !opts.forceOverwrite) {
    // Idempotent: doppelte Registrierung eines Built-Ins ist OK (kein Throw).
    if (existing.version === manifest.version) return;
    throw new Error(
      `[PluginRegistry] Cannot overwrite built-in plugin "${manifest.id}"`,
    );
  }
  _registry.set(manifest.id, manifest);
}

/** Entfernt einen Plugin-Manifest. Returns true wenn entfernt wurde. */
export function unregisterPlugin(id: string): boolean {
  return _registry.delete(id);
}

/** Liefert alle registrierten Plugins in stabiler Sort-Order (by id). */
export function getPlugins(): PluginManifest[] {
  return Array.from(_registry.values()).sort((a, b) => a.id.localeCompare(b.id));
}

/** Liefert einen Plugin-Manifest per id, oder undefined. */
export function getPlugin(id: string): PluginManifest | undefined {
  return _registry.get(id);
}

/** Liefert die Anzahl registrierter Plugins. */
export function pluginCount(): number {
  return _registry.size;
}

/** Leert die Registry (nur für Tests). */
export function _resetPluginRegistry(): void {
  _registry.clear();
}

// ─── Built-In Manifests ──────────────────────────────────────────────────────

/**
 * URL-Helper für Built-In-Worklet-Module. Im Browser/Electron resolved
 * `new URL(path, import.meta.url)` zu einer absoluten URL. In Node/Vitest
 * (Test-Env) ist `import.meta.url` ein file:// — die UI/AudioEngine ruft
 * `addModule(url)` nur wenn ein AudioContext vorhanden ist.
 */
function builtInWorkletUrl(filename: string): string {
  try {
    return new URL(`./worklets/${filename}`, import.meta.url).toString();
  } catch {
    // Fallback (Test-Env ohne import.meta.url): liefere relativen Pfad.
    return `./worklets/${filename}`;
  }
}

export const BUILT_IN_TAPE_SAT: PluginManifest = {
  id: "synthstudio.tape-sat",
  name: "Tape-Sat",
  version: "1.0.0",
  builtIn: true,
  workletUrl: builtInWorkletUrl("TapeSatProcessor.js"),
  processorName: "tape-sat-processor",
  paramSchema: [
    { id: "drive", label: "Drive", min: 0, max: 1, default: 0.3, step: 0.01 },
    { id: "mix", label: "Mix", min: 0, max: 1, default: 1, step: 0.01 },
  ],
};

export const BUILT_IN_NOTCH: PluginManifest = {
  id: "synthstudio.notch",
  name: "Notch",
  version: "1.0.0",
  builtIn: true,
  workletUrl: builtInWorkletUrl("NotchProcessor.js"),
  processorName: "notch-processor",
  paramSchema: [
    { id: "frequency", label: "Frequency", min: 50, max: 12000, default: 1000, step: 1, unit: "Hz" },
    { id: "q", label: "Q", min: 0.5, max: 30, default: 10, step: 0.1 },
    { id: "mix", label: "Mix", min: 0, max: 1, default: 1, step: 0.01 },
  ],
};

export const BUILT_IN_WIDTH: PluginManifest = {
  id: "synthstudio.width",
  name: "Width",
  version: "1.0.0",
  builtIn: true,
  workletUrl: builtInWorkletUrl("WidthProcessor.js"),
  processorName: "width-processor",
  paramSchema: [
    { id: "width", label: "Width", min: 0, max: 2, default: 1, step: 0.01 },
  ],
};

export const BUILT_IN_PLUGINS: PluginManifest[] = [
  BUILT_IN_TAPE_SAT,
  BUILT_IN_NOTCH,
  BUILT_IN_WIDTH,
];

/**
 * Registriert alle Built-In Plugins idempotent. Wird von `AudioEngine.init()`
 * gerufen. Sicher mehrfach aufrufbar.
 */
export function registerBuiltInPlugins(): void {
  for (const manifest of BUILT_IN_PLUGINS) {
    try {
      registerPlugin(manifest);
    } catch (e) {
      // Defensive: bei Built-In-Konflikten (z.B. Version-Mismatch beim
      // Hot-Reload) loggen, nicht crashen.
      console.warn(`[PluginRegistry] Could not register built-in "${manifest.id}":`, e);
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Liefert die Default-Param-Map für einen Plugin-Manifest. Nützlich beim
 * ersten Anlegen eines Plugin-Slots in der Mixer-Chain.
 */
export function getDefaultParams(manifest: PluginManifest): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of manifest.paramSchema) {
    out[p.id] = p.default;
  }
  return out;
}

/**
 * Clampt einen Wert auf das Param-Range des Manifests. Wirft NIE — bei
 * unbekanntem Param wird der Wert unverändert returned (defensive).
 */
export function clampPluginParam(
  manifest: PluginManifest,
  paramId: string,
  value: number,
): number {
  const def = manifest.paramSchema.find((p) => p.id === paramId);
  if (!def) return value;
  if (!Number.isFinite(value)) return def.default;
  if (value < def.min) return def.min;
  if (value > def.max) return def.max;
  return value;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE-2 STUB — v4.0+ Native VST3/CLAP via Electron IPC + JUCE-Node-Addon
// ═══════════════════════════════════════════════════════════════════════════
//
// Die folgende API ist ein **Placeholder** für Phase-2. Aktuell NICHT
// implementiert. Die Signaturen dokumentieren den geplanten Migrationspfad:
//
// 1. `scanNativePlugins()` — IPC-Aufruf an Electron-Main-Process der den
//    System-VST3-Folder (Win: %ProgramFiles%\Common Files\VST3) durchsucht
//    und Metadata via JUCE-Node-Addon liest. Returns PluginManifest[] mit
//    `builtIn: false` und einem `native: true`-Flag (separate Sub-Interface).
//
// 2. `loadVST3(path)` — Lädt ein einzelnes .vst3 vom Disk und liefert ein
//    Manifest. Der eigentliche Audio-Pfad läuft nicht via AudioWorklet,
//    sondern via JUCE-Process → Audio-Buffer-IPC → AudioBufferSourceNode
//    Trade-Off: höhere Latenz, aber volle VST3-Kompatibilität.
//
// 3. UI nutzt das gleiche Generic-Param-UI (paramSchema bleibt strukturell
//    identisch), nur die `PluginHost`-Klasse hat einen Native-Branch.
//
// Siehe TASK-239 in agents/INDEX.js → openTasks[]. Phase-2 ist ein eigener
// Sprint mit ~160h Aufwand (JUCE-Integration + IPC-Bridge + Security-Audit).
//
// export async function scanNativePlugins(): Promise<PluginManifest[]> {
//   if (typeof window !== "undefined" && window.electronAPI?.invoke) {
//     return window.electronAPI.invoke("plugin:scan-native");
//   }
//   return [];
// }
//
// export async function loadVST3(path: string): Promise<PluginManifest> {
//   throw new Error("Phase-2 not yet implemented — see TASK-239 in INDEX.js");
// }
// ═══════════════════════════════════════════════════════════════════════════
