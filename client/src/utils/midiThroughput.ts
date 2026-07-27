/**
 * midiThroughput.ts — reiner Sliding-Window-Durchsatz-Messer für MIDI.
 *
 * Motiv (Performance-Stufe 3): Mit mehreren parallelen Geräten (Electribe 2 +
 * Akai-Controller) will der User SEHEN, wie viele Noten/CC-Nachrichten pro
 * Sekunde tatsächlich hereinkommen und wo Spitzen entstehen — die einzige
 * ehrliche Grundlage für weitere Optimierung, wenn wir remote nicht messen
 * können. Der Messer reitet auf dem bereits existierenden `midi:rawmessage`-
 * Event-Strom (Noten/CC/Pitch-Bend/Aftertouch), erzeugt also KEINE zusätzliche
 * Last im Hot-Path des `useMidi`-Handlers.
 *
 * Rein + deterministisch: alle Methoden bekommen `now` (ms) übergeben — kein
 * `Date.now()`/`performance.now()` intern, damit vollständig in Node testbar.
 *
 * Fenster-Semantik: `perSec` = Nachrichten in den letzten `windowMs`,
 * normalisiert auf 1 s. Alte Zeitstempel werden bei jedem `record`/`snapshot`
 * abgeschnitten. `peakPerSec` merkt sich den höchsten je gemessenen Fenster-Wert
 * (Burst-Erkennung). Ein defensiver Cap verhindert unbegrenztes Wachstum des
 * Ringpuffers bei extremen Bursts.
 */

export interface ThroughputSnapshot {
  /** Nachrichten pro Sekunde (gleitendes Fenster, auf 1 s normalisiert). */
  perSec: number;
  /** Höchster je gemessener perSec-Wert seit Erstellung/Reset. */
  peakPerSec: number;
  /** Gesamtzahl aller aufgezeichneten Nachrichten seit Erstellung/Reset. */
  total: number;
  /** Anzahl Nachrichten aktuell im Fenster (roher Count). */
  windowCount: number;
}

/**
 * Standard-Cap für die Anzahl im Fenster gehaltener Zeitstempel. Bei 1-s-Fenster
 * entspricht das ~8000 msg/s — weit über realem MIDI-DIN-Durchsatz (~1000 msg/s
 * pro Port), aber ein Schutz gegen entartete Eingaben. Beim Überlauf werden die
 * ältesten Stempel verworfen (perSec bleibt dann bei diesem Cap gedeckelt).
 */
const DEFAULT_MAX_SAMPLES = 8000;

export class MidiThroughputMeter {
  private stamps: number[] = [];
  private head = 0; // Index des ältesten gültigen Stempels (amortisiertes Shift)
  private _peak = 0;
  private _total = 0;

  constructor(
    private readonly windowMs = 1000,
    private readonly maxSamples = DEFAULT_MAX_SAMPLES
  ) {}

  /** Verwirft Stempel, die älter als das Fenster sind (relativ zu `now`). */
  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.head < this.stamps.length && this.stamps[this.head] < cutoff) {
      this.head++;
    }
    // Kompaktieren, wenn der tote Präfix zu groß wird (amortisiert O(1)).
    if (this.head > 0 && this.head * 2 >= this.stamps.length) {
      this.stamps = this.stamps.slice(this.head);
      this.head = 0;
    }
  }

  /** Zeichnet eine Nachricht zum Zeitpunkt `now` (ms) auf. */
  record(now: number): void {
    this._total++;
    this.stamps.push(now);
    // Defensiver Cap: ältesten Stempel fallen lassen.
    if (this.stamps.length - this.head > this.maxSamples) {
      this.head++;
    }
    this.prune(now);
    const count = this.stamps.length - this.head;
    const perSec = (count * 1000) / this.windowMs;
    if (perSec > this._peak) this._peak = perSec;
  }

  /** Aktueller Messwert zum Zeitpunkt `now` (ms) — ohne eine Nachricht zu zählen. */
  snapshot(now: number): ThroughputSnapshot {
    this.prune(now);
    const windowCount = this.stamps.length - this.head;
    const perSec = (windowCount * 1000) / this.windowMs;
    if (perSec > this._peak) this._peak = perSec;
    return {
      perSec,
      peakPerSec: this._peak,
      total: this._total,
      windowCount,
    };
  }

  /** Setzt Peak + Zähler zurück (Fenster-Inhalt wird geleert). */
  reset(): void {
    this.stamps = [];
    this.head = 0;
    this._peak = 0;
    this._total = 0;
  }

  get total(): number {
    return this._total;
  }
  get peakPerSec(): number {
    return this._peak;
  }
}

/**
 * Mehrkanal-Aggregator: hält je Geräte-Namen (oder beliebigem Schlüssel) einen
 * eigenen Messer PLUS einen Gesamt-Messer. So kann die UI „Akai: 320/s,
 * Electribe: 48/s, Gesamt: 368/s" anzeigen und Engpässe einem Gerät zuordnen.
 */
export class MidiThroughputByDevice {
  private meters = new Map<string, MidiThroughputMeter>();
  private readonly totalMeter: MidiThroughputMeter;

  constructor(
    private readonly windowMs = 1000,
    private readonly maxSamples = DEFAULT_MAX_SAMPLES
  ) {
    this.totalMeter = new MidiThroughputMeter(windowMs, maxSamples);
  }

  record(key: string, now: number): void {
    let m = this.meters.get(key);
    if (!m) {
      m = new MidiThroughputMeter(this.windowMs, this.maxSamples);
      this.meters.set(key, m);
    }
    m.record(now);
    this.totalMeter.record(now);
  }

  /** Gesamt-Durchsatz über alle Geräte. */
  totalSnapshot(now: number): ThroughputSnapshot {
    return this.totalMeter.snapshot(now);
  }

  /** Pro-Geräte-Durchsatz, absteigend nach aktuellem perSec sortiert. */
  perDevice(now: number): Array<{ key: string } & ThroughputSnapshot> {
    const rows = Array.from(this.meters.entries()).map(([key, m]) => ({
      key,
      ...m.snapshot(now),
    }));
    rows.sort((a, b) => b.perSec - a.perSec || a.key.localeCompare(b.key));
    return rows;
  }

  /** Namen aller je gesehenen Geräte. */
  keys(): string[] {
    return Array.from(this.meters.keys());
  }

  reset(): void {
    this.meters.clear();
    this.totalMeter.reset();
  }
}
