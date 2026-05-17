/**
 * Synthstudio — NanoKontrolFeedback.ts (TASK-231 / v2.84.0)
 *
 * Stateful Wrapper für die LED-Synchronisation eines KORG nanoKONTROL2 (oder
 * jedes anderen externen LED-Feedback-Geräts). Hält den letzten geschickten
 * LED-State pro Channel, damit React-Renders mit identischem Mute/Solo-Vektor
 * NICHT erneut bytes an die MIDI-Schnittstelle pushen (Hardware-Hammering
 * vermeiden).
 *
 * Design:
 *   - Pure Wrapper über `sender(bytes)`. Wer den sender liefert, ist egal
 *     (Web-MIDI, Mock im Test, Logger-Stub für DevTools).
 *   - Keine React-/Store-Imports — App-Komponente macht die Subscription und
 *     ruft `syncMixer()` mit dem aktuellen Mute/Solo-Snapshot auf.
 *   - Defensiv: jede Exception in `sender` wird vom Helper `sendMessage`
 *     gefressen (siehe midiOutput.ts).
 *
 * Verwendet von:
 *   - useMidi (oder App.tsx) — wiring der Mixer-Subscription
 *   - tests/features/nano-kontrol-led.test.ts
 */
import {
  buildNanoKontrolLed,
  NANO_KONTROL2,
} from "@/utils/midiOutput";

/** Mute/Solo-Snapshot pro nanoKONTROL2-Track 0..7. */
export interface NanoKontrolChannelState {
  muted: boolean;
  soloed: boolean;
}

/** Sender-Callback — empfängt eine fertige 3-Byte CC-Message. */
export type NanoKontrolSender = (bytes: number[]) => void;

export class NanoKontrolFeedback {
  private sender: NanoKontrolSender | null = null;
  private enabled = false;
  // Caches der zuletzt gesendeten LED-States — undefined = noch nie gesendet.
  private lastMute: Array<boolean | undefined> = new Array(NANO_KONTROL2.CHANNEL_COUNT).fill(undefined);
  private lastSolo: Array<boolean | undefined> = new Array(NANO_KONTROL2.CHANNEL_COUNT).fill(undefined);

  constructor(sender?: NanoKontrolSender | null) {
    this.sender = sender ?? null;
  }

  /** Tauscht den Sender (z.B. wenn der Output-Device-Picker geändert wurde). */
  setSender(sender: NanoKontrolSender | null): void {
    this.sender = sender;
    // Sender-Wechsel invalidiert den Cache — sonst kann ein Re-Sync ausbleiben
    // weil "der Wert hat sich nicht geändert".
    this.resetCache();
  }

  /**
   * Aktiviert/deaktiviert LED-Feedback. Beim Aktivieren schicken wir KEINEN
   * Full-Sync automatisch — der Caller muss `syncMixer(...)` mit dem aktuellen
   * State aufrufen (so bleibt das Modul Store-agnostisch). Beim Deaktivieren
   * schalten wir alle LEDs auf 0 (über Cache-Reset + nächster syncMixer-Diff,
   * oder explizit per `allLedsOff()`).
   */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.allLedsOff();
    }
  }

  isEnabled(): boolean { return this.enabled; }

  /**
   * Synchronisiert den LED-State mit dem gegebenen Mute/Solo-Vektor.
   * Nur geänderte LEDs werden gesendet (Diff-Sync). Returns Anzahl der
   * tatsächlich verschickten Messages. No-op wenn disabled oder kein Sender.
   */
  syncMixer(channels: NanoKontrolChannelState[]): number {
    if (!this.enabled || !this.sender) return 0;
    let sent = 0;
    for (let i = 0; i < NANO_KONTROL2.CHANNEL_COUNT; i++) {
      const ch = i < channels.length ? channels[i] : { muted: false, soloed: false };
      if (this.lastMute[i] !== ch.muted) {
        this.send(NANO_KONTROL2.MUTE_CC_BASE + i, ch.muted);
        this.lastMute[i] = ch.muted;
        sent++;
      }
      if (this.lastSolo[i] !== ch.soloed) {
        this.send(NANO_KONTROL2.SOLO_CC_BASE + i, ch.soloed);
        this.lastSolo[i] = ch.soloed;
        sent++;
      }
    }
    return sent;
  }

  /**
   * Erzwingt einen Full-Sync ungeachtet des Caches. Wird beim Aktivieren des
   * Feedbacks oder nach Device-Wechsel aufgerufen.
   */
  forceFullSync(channels: NanoKontrolChannelState[]): number {
    this.resetCache();
    return this.syncMixer(channels);
  }

  /** Alle Solo/Mute/Rec LEDs auf 0. Wird beim Deactivate aufgerufen. */
  allLedsOff(): number {
    if (!this.sender) return 0;
    let sent = 0;
    for (let i = 0; i < NANO_KONTROL2.CHANNEL_COUNT; i++) {
      this.send(NANO_KONTROL2.MUTE_CC_BASE + i, false); sent++;
      this.send(NANO_KONTROL2.SOLO_CC_BASE + i, false); sent++;
      this.send(NANO_KONTROL2.REC_CC_BASE  + i, false); sent++;
    }
    this.resetCache();
    return sent;
  }

  /** Resettet den internen LED-Diff-Cache. Nächster syncMixer = Full-Sync. */
  private resetCache(): void {
    this.lastMute.fill(undefined);
    this.lastSolo.fill(undefined);
  }

  private send(cc: number, on: boolean): void {
    if (!this.sender) return;
    try { this.sender(buildNanoKontrolLed(cc, on)); }
    catch { /* swallow — Hardware-Disconnect mid-send darf nicht crashen */ }
  }
}
