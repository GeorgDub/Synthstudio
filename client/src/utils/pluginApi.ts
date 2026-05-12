/**
 * Synthstudio – Plugin API (Phase N)
 *
 * Einfaches Plugin-System: JavaScript-Module werden dynamisch geladen
 * und haben Zugriff auf eine sandboxed Synthstudio API.
 *
 * Plugin-Format (ESM):
 * ```js
 * export const meta = { name: "MyPlugin", version: "1.0", author: "You" };
 * export function onLoad(api) {
 *   api.log("Plugin geladen!");
 *   api.onStep((step) => { ... });
 * }
 * ```
 */

export interface PluginMeta {
  name: string;
  version: string;
  author?: string;
  description?: string;
}

export interface PluginApi {
  /** BPM setzen */
  setBpm: (bpm: number) => void;
  /** Pattern-Step setzen */
  setStep: (partIdx: number, stepIdx: number, active: boolean, velocity?: number) => void;
  /** Logging */
  log: (...args: unknown[]) => void;
  /** Auf jeden Step reagieren */
  onStep: (cb: (stepIndex: number) => void) => () => void;
  /** Auf BPM-Änderungen reagieren */
  onBpmChange: (cb: (bpm: number) => void) => () => void;
  /** Macro-Wert setzen */
  setMacro: (index: number, value: number) => void;
  /** kb:action dispatchen */
  dispatch: (action: string) => void;
  /** Warten */
  wait: (ms: number) => Promise<void>;
}

interface LoadedPlugin {
  id: string;
  meta: PluginMeta;
  unload: () => void;
  url: string;
}

const _plugins = new Map<string, LoadedPlugin>();
const _listeners = new Set<() => void>();

function notify() { _listeners.forEach(l => l()); }

/** Erstellt die Plugin-API mit den gegebenen Callbacks. */
function createApi(callbacks: {
  setBpm?: (b: number) => void;
  setStep?: (p: number, s: number, a: boolean, v?: number) => void;
}): PluginApi {
  const stepCallbacks: Array<(s: number) => void> = [];
  const bpmCallbacks:  Array<(b: number) => void> = [];

  // Globale Event-Listener einmalig registrieren
  const stepHandler = (e: Event) => {
    const step = (e as CustomEvent).detail as number;
    stepCallbacks.forEach(cb => cb(step));
  };
  const bpmHandler = (e: Event) => {
    const bpm = (e as CustomEvent).detail as number;
    bpmCallbacks.forEach(cb => cb(bpm));
  };
  window.addEventListener("audio:position", stepHandler);
  window.addEventListener("audio:bpmChange", bpmHandler);

  return {
    setBpm: (b) => callbacks.setBpm?.(b),
    setStep: (p, s, a, v) => callbacks.setStep?.(p, s, a, v),
    log: (...args) => console.log("[Plugin]", ...args),
    onStep: (cb) => {
      stepCallbacks.push(cb);
      return () => { const i = stepCallbacks.indexOf(cb); if (i >= 0) stepCallbacks.splice(i, 1); };
    },
    onBpmChange: (cb) => {
      bpmCallbacks.push(cb);
      return () => { const i = bpmCallbacks.indexOf(cb); if (i >= 0) bpmCallbacks.splice(i, 1); };
    },
    setMacro: (idx, val) => {
      window.dispatchEvent(new CustomEvent("macro:change", { detail: { index: idx, value: val } }));
    },
    dispatch: (action) => window.dispatchEvent(new CustomEvent("kb:action", { detail: action })),
    wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  };
}

/**
 * Lädt ein Plugin aus einer URL (ESM).
 */
export async function loadPlugin(
  url: string,
  apiCallbacks: { setBpm?: (b: number) => void; setStep?: (p: number, s: number, a: boolean, v?: number) => void }
): Promise<{ success: boolean; error?: string; meta?: PluginMeta }> {
  try {
    const mod = await import(/* @vite-ignore */ url);
    const meta: PluginMeta = mod.meta ?? { name: url, version: "1.0" };
    const api  = createApi(apiCallbacks);
    const unsubs: Array<() => void> = [];

    if (typeof mod.onLoad === "function") {
      mod.onLoad(api);
    }

    const id = `plugin-${Date.now()}`;
    _plugins.set(id, {
      id, meta, url,
      unload: () => { unsubs.forEach(u => u()); _plugins.delete(id); notify(); },
    });
    notify();
    return { success: true, meta };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export function unloadPlugin(id: string): void {
  _plugins.get(id)?.unload();
}

export function getLoadedPlugins(): LoadedPlugin[] {
  return [..._plugins.values()];
}

export function onPluginsChange(cb: () => void): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
