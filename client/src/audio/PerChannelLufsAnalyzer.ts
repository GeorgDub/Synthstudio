/**
 * Synthstudio – PerChannelLufsAnalyzer.ts  (v3.122.0)
 *
 * Per-Channel LUFS-Messung fuer "Smart Auto-Mix".
 *
 * Wrapper-Klasse, die pro Channel eine `LufsAnalyzer`-Instance haelt + den
 * AudioContext-Tap (ChannelSplitter → 2x AnalyserNode → Polling) verkabelt.
 *
 * Wird vom `AudioEngine` instanziiert und beim Erstellen/Loeschen von
 * Channels live gehalten. Die UI ruft `getAllResults()` per Polling-Timer
 * (typisch 200ms) ab.
 *
 * Design-Entscheidungen:
 *  - Reuse LufsAnalyzer (BS.1770-4 K-weighting + Integrated-Gating)
 *  - Stereo-Tap via ChannelSplitter (analog zu AudioEngine._lufsAnalyserNodeL/R)
 *  - Lazy-Init: erst wenn `enableForChannel(...)` aufgerufen wird
 *  - Pollen-Loop laeuft solang mind. ein Channel aktiv ist
 *  - Bei `disableForChannel` werden die Web-Audio-Nodes diskonnektet (kein
 *    CPU-Overhead mehr fuer K-weighting)
 *
 * Isomorphisch: wenn kein AudioContext (Node/SSR) → no-op + leere Results.
 */

import { LufsAnalyzer } from "./LufsAnalyzer";

/**
 * v3.122.0: Ergebnis-Snapshot pro Channel (eine Messung).
 *
 * Alle Werte in LUFS (channel-summed). `-Infinity` = noch keine Messung
 * aufgelaufen / silent.
 */
export interface PerChannelLufsResult {
  integrated:  number;
  momentary:   number;
  shortTerm:   number;
}

/** Interner Slot pro Channel. */
interface ChannelSlot {
  analyzer:        LufsAnalyzer;
  splitter:        ChannelSplitterNode;
  analyserL:       AnalyserNode;
  analyserR:       AnalyserNode;
  scratchL:        Float32Array;
  scratchR:        Float32Array;
  /** Source-Node (Channel-Output, z.B. sidechainGain) — fuer Disconnect. */
  source:          AudioNode;
}

const POLL_INTERVAL_MS = 100;
const FFT_SIZE = 2048;

export class PerChannelLufsAnalyzer {
  private slots = new Map<string, ChannelSlot>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private ctx: AudioContext | null) {}

  /**
   * Aktiviert die LUFS-Messung fuer einen Channel.
   *
   * @param channelId   Channel-/Part-ID (Map-Key)
   * @param source      Audio-Source-Node (typisch der Channel-Output VOR
   *                    der Master-Volume-Multiplikation, z.B. `sidechainGain`).
   *
   * No-Op wenn:
   *   - kein AudioContext (SSR / Tests ohne Web-Audio)
   *   - Slot existiert bereits (Doppel-Aktivierung ist idempotent)
   *
   * Routing:
   *   source → splitter → (analyserL, analyserR) [Tap, kein Output zum Master]
   *
   * Wichtig: AnalyserNode hat KEINE output-Connection (Tap-only). Damit
   * beeinflusst die Messung nicht den Audio-Path.
   */
  enableForChannel(channelId: string, source: AudioNode): void {
    if (!this.ctx) return;
    if (this.slots.has(channelId)) return;

    const sr = this.ctx.sampleRate;
    const analyzer  = new LufsAnalyzer({ sampleRate: sr, channelCount: 2 });
    const splitter  = this.ctx.createChannelSplitter(2);
    const analyserL = this.ctx.createAnalyser();
    const analyserR = this.ctx.createAnalyser();
    analyserL.fftSize = FFT_SIZE;
    analyserR.fftSize = FFT_SIZE;
    analyserL.smoothingTimeConstant = 0;
    analyserR.smoothingTimeConstant = 0;

    try {
      source.connect(splitter);
      splitter.connect(analyserL, 0);
      splitter.connect(analyserR, 1);
    } catch (e) {
      // Defensive: wenn der Source-Node mono ist, faellt Split auf Ch0 zurueck.
      // Wir loggen aber rejecten nicht — UI sieht dann -Infinity.
      // eslint-disable-next-line no-console
      console.warn("[PerChannelLufs] connect failed for", channelId, e);
    }

    this.slots.set(channelId, {
      analyzer,
      splitter,
      analyserL,
      analyserR,
      scratchL: new Float32Array(FFT_SIZE),
      scratchR: new Float32Array(FFT_SIZE),
      source,
    });

    this._ensurePolling();
  }

  /**
   * Deaktiviert die LUFS-Messung fuer einen Channel — diskonnektet alle
   * Tap-Nodes (CPU geht wieder runter).
   *
   * No-Op wenn Slot nicht existiert.
   */
  disableForChannel(channelId: string): void {
    const slot = this.slots.get(channelId);
    if (!slot) return;
    try { slot.source.disconnect(slot.splitter); } catch { /* ignore */ }
    try { slot.splitter.disconnect(); } catch { /* ignore */ }
    try { slot.analyserL.disconnect(); } catch { /* ignore */ }
    try { slot.analyserR.disconnect(); } catch { /* ignore */ }
    this.slots.delete(channelId);
    if (this.slots.size === 0) this._stopPolling();
  }

  /**
   * Liefert den aktuellen Integrated-LUFS-Wert fuer einen Channel.
   * `null` wenn kein Slot existiert.
   */
  getIntegratedLufs(channelId: string): number | null {
    const slot = this.slots.get(channelId);
    if (!slot) return null;
    return slot.analyzer.getIntegrated();
  }

  /** Snapshot aller aktiven Channels. */
  getAllResults(): Map<string, PerChannelLufsResult> {
    const out = new Map<string, PerChannelLufsResult>();
    for (const [id, slot] of this.slots.entries()) {
      out.set(id, {
        integrated: slot.analyzer.getIntegrated(),
        momentary:  slot.analyzer.getMomentary(),
        shortTerm:  slot.analyzer.getShortTerm(),
      });
    }
    return out;
  }

  /** Setzt nur die Integrated-Akkus zurueck (Momentary bleibt gleitend). */
  resetAll(): void {
    for (const slot of this.slots.values()) slot.analyzer.reset();
  }

  /** Komplette Teardown — alle Slots disablen, Polling stoppen. */
  disposeAll(): void {
    const ids = [...this.slots.keys()];
    for (const id of ids) this.disableForChannel(id);
    this._stopPolling();
  }

  /** True wenn fuer diesen Channel ein Slot aktiv ist. */
  isActive(channelId: string): boolean {
    return this.slots.has(channelId);
  }

  /** Anzahl aktiver Channels. */
  size(): number {
    return this.slots.size;
  }

  // ─── Polling-Loop (private) ───────────────────────────────────────────────

  private _ensurePolling(): void {
    if (this.pollTimer !== null) return;
    if (typeof setInterval === "undefined") return;
    this.pollTimer = setInterval(() => this._poll(), POLL_INTERVAL_MS);
  }

  private _stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private _poll(): void {
    for (const slot of this.slots.values()) {
      try {
        // TS narrowing: AnalyserNode.getFloatTimeDomainData expects
        // Float32Array<ArrayBuffer> in newer lib.dom — explicit cast haelt
        // den Aufruf kompatibel mit beiden lib-Versionen.
        (slot.analyserL as { getFloatTimeDomainData: (b: Float32Array) => void }).getFloatTimeDomainData(slot.scratchL);
        (slot.analyserR as { getFloatTimeDomainData: (b: Float32Array) => void }).getFloatTimeDomainData(slot.scratchR);
        slot.analyzer.processBlock(slot.scratchL, slot.scratchR);
      } catch {
        // Defensive — Mock-AnalyserNodes ohne getFloatTimeDomainData.
      }
    }
  }
}
