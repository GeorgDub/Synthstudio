/**
 * PluginHost — v3.44.0 (TASK-239 Phase 1)
 *
 * Wrapper um einen AudioWorkletNode der ein Synthstudio-Plugin instanziiert.
 * API ist bewusst minimal damit die AudioEngine Plugin-Knoten in die FX-Chain
 * einfügen kann (analog zu Built-In Insert-FX wie Bitcrusher/RingMod).
 *
 * Wichtig:
 *  - `addModule()` wird nur einmal pro AudioContext + workletUrl gerufen
 *    (intern via Set<string> memoisiert).
 *  - Bei Load-Fehler (z.B. fehlende Datei, Worklet wirft beim Register)
 *    `createPluginHost()` liefert null und loggt eine Warnung. Caller müssen
 *    den null-Fall graceful behandeln (FX-Chain überspringt den Slot).
 *  - `setParam(id, value)` clampt automatisch auf den paramSchema-Range
 *    (defensive — User-Slider-Input kann Nan/Out-of-Range liefern).
 */

import {
  type PluginManifest,
  type PluginParamDef,
  clampPluginParam,
  getDefaultParams,
} from "./PluginRegistry";

export interface PluginHostInitParams {
  /** Optional: Initial-Params. Wenn nicht gesetzt, werden Defaults aus Manifest übernommen. */
  params?: Record<string, number>;
}

/**
 * Per-AudioContext Cache welche Worklet-Module bereits geladen wurden.
 * Verhindert doppelte `addModule()`-Calls (die wären zwar idempotent, aber
 * teuer wegen Fetch + Parse).
 *
 * Wrapped in einem Holder damit Tests den Cache resetten können ohne
 * `const`-Reassign.
 */
const _moduleCache: { map: WeakMap<BaseAudioContext, Set<string>> } = {
  map: new WeakMap(),
};

function _getLoadedSet(ctx: BaseAudioContext): Set<string> {
  let set = _moduleCache.map.get(ctx);
  if (!set) {
    set = new Set<string>();
    _moduleCache.map.set(ctx, set);
  }
  return set;
}

/**
 * Lädt das Worklet-Modul (falls noch nicht für diesen Context geladen).
 * Wirft bei Fehlern — Caller (`createPluginHost`) fängt das ab.
 */
async function ensureModuleLoaded(
  ctx: BaseAudioContext,
  workletUrl: string,
): Promise<void> {
  const loaded = _getLoadedSet(ctx);
  if (loaded.has(workletUrl)) return;
  // BaseAudioContext.audioWorklet ist im Web-Audio-Spec ein Pflicht-Feature
  // ab AudioContext / OfflineAudioContext. In sehr alten Browsern (kein
  // AudioWorklet) wirft das hier — Caller handled das gracefully.
  const aw = (ctx as { audioWorklet?: AudioWorklet }).audioWorklet;
  if (!aw) {
    throw new Error("[PluginHost] AudioWorklet not supported on this context");
  }
  await aw.addModule(workletUrl);
  loaded.add(workletUrl);
}

export class PluginHost {
  readonly manifest: PluginManifest;
  readonly node: AudioWorkletNode;
  private _params: Record<string, number>;
  private _bypassed = false;

  /**
   * NICHT direkt aufrufen — nutze `createPluginHost()` damit Worklet-Load
   * + Param-Apply atomar passieren und Fehler abgefangen werden.
   */
  constructor(
    manifest: PluginManifest,
    node: AudioWorkletNode,
    initialParams: Record<string, number>,
  ) {
    this.manifest = manifest;
    this.node = node;
    this._params = { ...initialParams };
    // Initial-Werte am Worklet setzen (clamped via Manifest-Range).
    for (const def of manifest.paramSchema) {
      const v = clampPluginParam(manifest, def.id, this._params[def.id] ?? def.default);
      this._setNodeParam(def, v);
      this._params[def.id] = v;
    }
  }

  /**
   * Setzt einen Plugin-Parameter. Clampt automatisch auf den paramSchema-
   * Range. Bei unbekannter Param-ID wird der Call ignoriert (defensive).
   */
  setParam(id: string, value: number): void {
    const def = this.manifest.paramSchema.find((p) => p.id === id);
    if (!def) return; // unknown param — silent no-op
    const clamped = clampPluginParam(this.manifest, id, value);
    this._params[id] = clamped;
    this._setNodeParam(def, clamped);
  }

  /** Liefert eine Kopie der aktuellen Param-Werte. */
  getParams(): Record<string, number> {
    return { ...this._params };
  }

  /** Liefert den AudioWorkletNode für Wiring in die FX-Chain. */
  getNode(): AudioWorkletNode {
    return this.node;
  }

  /**
   * Bypass-Toggle: leitet das Signal beim Wiring direkt durch. AudioWorklet-
   * basierte Plugins können in Phase-1 keinen "echten" internal Bypass via
   * Worklet-Message machen — der Bypass-State wird vom Caller (AudioEngine)
   * beim Re-Wiring konsumiert. Hier merken wir uns nur das Flag.
   */
  setBypassed(bypassed: boolean): void {
    this._bypassed = bypassed;
  }

  isBypassed(): boolean {
    return this._bypassed;
  }

  /** Disconnect + Cleanup. Nach `dispose()` ist die Instanz unbrauchbar. */
  dispose(): void {
    try {
      this.node.disconnect();
    } catch {
      /* ignore — Node war eventuell nie connected */
    }
  }

  private _setNodeParam(def: PluginParamDef, value: number): void {
    // AudioParam-Lookup. Wenn das Plugin den Param nicht als AudioParam
    // sondern via Port-Message verwaltet, suchen wir auch das (Fallback).
    const ap = this.node.parameters.get(def.id);
    if (ap) {
      ap.value = value;
      return;
    }
    // Fallback: Plugin nutzt postMessage statt parameterDescriptors.
    try {
      this.node.port.postMessage({ type: "param", id: def.id, value });
    } catch {
      /* ignore — Plugin akzeptiert das Format nicht */
    }
  }
}

/**
 * Async Factory: lädt das Worklet-Modul (falls nötig) und erzeugt einen
 * `PluginHost`. Liefert `null` bei Load-Fehler (z.B. fehlende Datei).
 *
 * Caller MUSS den null-Fall behandeln:
 * ```ts
 * const host = await createPluginHost(ctx, manifest);
 * if (!host) {
 *   console.warn("Plugin konnte nicht geladen werden — überspringe Slot");
 *   return;
 * }
 * sourceNode.connect(host.getNode());
 * host.getNode().connect(destination);
 * ```
 */
export async function createPluginHost(
  ctx: BaseAudioContext,
  manifest: PluginManifest,
  init?: PluginHostInitParams,
): Promise<PluginHost | null> {
  try {
    await ensureModuleLoaded(ctx, manifest.workletUrl);
    const node = new AudioWorkletNode(ctx, manifest.processorName, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      // 2 Kanäle damit "Width"-Plugin korrekt L/R sehen kann
      outputChannelCount: [2],
    });
    const params = { ...getDefaultParams(manifest), ...(init?.params ?? {}) };
    return new PluginHost(manifest, node, params);
  } catch (e) {
    // Defensive: bei Worklet-Load- oder Konstruktor-Fehlern crashen wir
    // nicht den Mixer. UI zeigt das Plugin als "konnte nicht geladen werden".
    console.warn(
      `[PluginHost] Could not load plugin "${manifest.id}":`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/** Test-Helper: Reset des Module-Load-Caches. */
export function _resetPluginHostModuleCache(): void {
  _moduleCache.map = new WeakMap();
}
