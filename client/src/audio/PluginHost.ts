/**
 * PluginHost — v3.45.0 (TASK-239 Phase 1 + Multi-Slot / Click-Free Bypass)
 *
 * Wrapper um einen AudioWorkletNode der ein Synthstudio-Plugin instanziiert.
 * API ist bewusst minimal damit die AudioEngine Plugin-Knoten in eine Multi-
 * Slot-Plugin-Chain (max 4 pro Channel, v3.45) einfügen kann.
 *
 * Wichtig:
 *  - `addModule()` wird nur einmal pro AudioContext + workletUrl gerufen
 *    (intern via Set<string> memoisiert).
 *  - Bei Load-Fehler (z.B. fehlende Datei, Worklet wirft beim Register)
 *    `createPluginHost()` liefert null und loggt eine Warnung. Caller müssen
 *    den null-Fall graceful behandeln (FX-Chain überspringt den Slot).
 *  - `setParam(id, value)` clampt automatisch auf den paramSchema-Range
 *    (defensive — User-Slider-Input kann Nan/Out-of-Range liefern).
 *
 * Click-Free Bypass (v3.45):
 *  - Plugin-Node sitzt zwischen `getInputNode()` und `getOutputNode()`.
 *  - Die zwei Gain-Wrapper bilden einen Crossfader: Plugin-Pfad (wetGain)
 *    und Bypass-Pfad (dryGain) summieren sich am Output. setBypassed()
 *    rampt beide Gains parallel über `rampMs` (Default 5ms) — der Plugin-
 *    Knoten bleibt verkabelt, sodass interne State-Pops (Filter-History)
 *    beim Re-Aktivieren ausbleiben.
 *  - Fällt der AudioContext (Test-Env / Node) weg, läuft setBypassed in
 *    einen No-Op-Pfad: das Flag wird gesetzt, aber kein gain-ramp gefahren.
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

/** Default-Ramp-Time für click-free Bypass (in ms). */
export const DEFAULT_BYPASS_RAMP_MS = 5;

export class PluginHost {
  readonly manifest: PluginManifest;
  readonly node: AudioWorkletNode;
  /**
   * Input-Wrapper: Caller verkettet Signal hier hinein.
   * Splittet auf Plugin-Pfad (wetGain) und Bypass-Pfad (dryGain).
   */
  private readonly _inputGain: GainNode | null;
  /** Plugin-Pfad-Output (wet). Bei Bypass auf 0 gerampt. */
  private readonly _wetGain: GainNode | null;
  /** Bypass-Pfad-Output (dry). Bei Bypass auf 1 gerampt. */
  private readonly _dryGain: GainNode | null;
  /** Output-Summing-Node. Caller verkettet ab hier weiter. */
  private readonly _outputGain: GainNode | null;
  /** AudioContext-Referenz für currentTime + Ramps. */
  private readonly _ctx: BaseAudioContext | null;

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
    ctx?: BaseAudioContext | null,
  ) {
    this.manifest = manifest;
    this.node = node;
    this._params = { ...initialParams };
    this._ctx = ctx ?? null;

    // Crossfade-Wrapper bauen — nur wenn ctx + createGain verfügbar sind.
    // Test-Env (Mock-Context ohne createGain) fällt auf "naked node" zurück:
    // dann ist getInputNode/getOutputNode == this.node, Bypass-Ramp ist No-Op.
    const hasGain = !!ctx && typeof (ctx as { createGain?: () => GainNode }).createGain === "function";
    if (hasGain && ctx) {
      const c = ctx as AudioContext;
      this._inputGain = c.createGain();
      this._wetGain = c.createGain();
      this._dryGain = c.createGain();
      this._outputGain = c.createGain();
      this._inputGain.gain.value = 1;
      this._wetGain.gain.value = 1;
      this._dryGain.gain.value = 0;
      this._outputGain.gain.value = 1;
      // Wiring: input → node → wet → output ; input → dry → output
      this._inputGain.connect(this.node);
      this.node.connect(this._wetGain);
      this._wetGain.connect(this._outputGain);
      this._inputGain.connect(this._dryGain);
      this._dryGain.connect(this._outputGain);
    } else {
      this._inputGain = null;
      this._wetGain = null;
      this._dryGain = null;
      this._outputGain = null;
    }

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

  /**
   * Liefert den AudioNode den die Plugin-Chain als Eingang nutzen soll.
   * (Pre-v3.45 war das identisch zur AudioWorkletNode; mit Crossfade-Wrapper
   * ist es jetzt der _inputGain. Caller braucht NICHT zu unterscheiden.)
   */
  getInputNode(): AudioNode {
    return this._inputGain ?? this.node;
  }

  /**
   * Liefert den AudioNode der die Plugin-Chain als Ausgang nutzen soll.
   * Vor v3.45 lieferte getNode() den AudioWorkletNode direkt — getOutputNode
   * ist der semantisch korrekte Output. getNode() bleibt für Tests/Legacy.
   */
  getOutputNode(): AudioNode {
    return this._outputGain ?? this.node;
  }

  /** Liefert den AudioWorkletNode (Legacy — bevorzuge getInputNode/getOutputNode). */
  getNode(): AudioWorkletNode {
    return this.node;
  }

  /**
   * Click-Free Bypass-Toggle (v3.45).
   *
   * Rampt die internen Wet/Dry-Gains parallel über `rampMs` Millisekunden
   * (Default 5ms) — schnell genug für UI-Responsiveness, langsam genug um
   * Click-Artefakte zu vermeiden. Der Plugin-Knoten bleibt verkabelt damit
   * interne States (Filter-History, Saturation-Hysterese) nicht poppen.
   *
   * Fallback-Pfad: ohne createGain (Test-Mock) wird nur das Flag gesetzt —
   * Caller (AudioEngine) konsumiert das Flag beim Re-Wiring (Legacy v3.44).
   */
  setBypassed(bypassed: boolean, rampMs: number = DEFAULT_BYPASS_RAMP_MS): void {
    this._bypassed = bypassed;
    if (!this._wetGain || !this._dryGain || !this._ctx) {
      // Kein crossfader gebaut (Test-Env / kein createGain) — Flag bleibt
      // gesetzt, Caller muss ggf. via Re-Wiring reagieren.
      return;
    }
    const ramp = Math.max(0.0001, rampMs) / 1000;
    const now = this._ctx.currentTime;
    try {
      // cancelScheduledValues vermeidet stranded automation falls Toggle
      // schneller als die Rampe getriggert wird.
      this._wetGain.gain.cancelScheduledValues(now);
      this._dryGain.gain.cancelScheduledValues(now);
      // Aktuellen Wert verankern (sonst springt linearRamp vom letzten
      // gescheduleten Wert, nicht vom aktuellen).
      this._wetGain.gain.setValueAtTime(this._wetGain.gain.value, now);
      this._dryGain.gain.setValueAtTime(this._dryGain.gain.value, now);
      if (bypassed) {
        this._wetGain.gain.linearRampToValueAtTime(0, now + ramp);
        this._dryGain.gain.linearRampToValueAtTime(1, now + ramp);
      } else {
        this._wetGain.gain.linearRampToValueAtTime(1, now + ramp);
        this._dryGain.gain.linearRampToValueAtTime(0, now + ramp);
      }
    } catch {
      // Defensive: AudioParam-Methods fehlen in manchen Test-Mocks.
      // Fallback auf instant value set.
      try { this._wetGain.gain.value = bypassed ? 0 : 1; } catch { /* ignore */ }
      try { this._dryGain.gain.value = bypassed ? 1 : 0; } catch { /* ignore */ }
    }
  }

  isBypassed(): boolean {
    return this._bypassed;
  }

  /** Disconnect + Cleanup. Nach `dispose()` ist die Instanz unbrauchbar. */
  dispose(): void {
    const toDisconnect: Array<{ disconnect: () => void } | null> = [
      this._inputGain,
      this._wetGain,
      this._dryGain,
      this._outputGain,
      this.node,
    ];
    for (const n of toDisconnect) {
      if (!n) continue;
      try { n.disconnect(); } catch { /* ignore */ }
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
 * sourceNode.connect(host.getInputNode());
 * host.getOutputNode().connect(destination);
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
    return new PluginHost(manifest, node, params, ctx);
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
