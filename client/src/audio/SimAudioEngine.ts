/**
 * SimAudioEngine.ts — Sprint-102 Web-Audio Synth-Stub.
 *
 * Spielt einfache Sinus-Toene mit ADSR-Envelope auf jedes empfangene
 * omnitribe:noteOn-Event und stoppt sie auf omnitribe:noteOff.
 *
 * Zweck: ohne Hardware den kompletten Note-Trigger-Pfad hoerbar machen.
 * Click in der UI → WS → Sim-chord-Modul → Fan-Out → WS-Reply → Bridge
 * → noteOn-Event → hier → Speaker. Im Browser. Ohne Geraet.
 *
 * Bewusst sehr einfach gehalten — kein Filter, kein LFO, kein
 * Multi-Voice-Pooling. Wenn mehr als 32 gleichzeitige Notes anliegen,
 * wird die aelteste verdraengt.
 */

interface ActiveVoice {
  oscillator: OscillatorNode;
  gain: GainNode;
  startedAt: number;
}

const MAX_VOICES = 32;
const ATTACK_S = 0.005;
const DECAY_S = 0.1;
const SUSTAIN_GAIN = 0.4;
const RELEASE_S = 0.2;

function midiToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function voiceKey(channel: number, note: number): string {
  return `${channel}:${note}`;
}

export class SimAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private active = new Map<string, ActiveVoice>();
  private enabled = false;
  private unbindNoteOn: (() => void) | null = null;
  private unbindNoteOff: (() => void) | null = null;

  /**
   * Aktiviert die Engine. Muss nach einer User-Geste aufgerufen werden
   * (Browser-Autoplay-Policy verlangt User-Activation fuer AudioContext).
   */
  async enable(): Promise<void> {
    if (this.enabled) return;
    if (typeof window === "undefined") return;
    // AudioContext lazily; Browser muss User-Gesture gesehen haben.
    const AC = window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext })
           .webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    if (this.ctx.state === "suspended") {
      try { await this.ctx.resume(); } catch { /* */ }
    }
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.3;          // master-volume
    this.masterGain.connect(this.ctx.destination);

    const onNoteOn = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        channel: number; note: number; velocity: number;
      } | undefined;
      if (!detail) return;
      this.noteOn(detail.channel, detail.note, detail.velocity);
    };
    const onNoteOff = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        channel: number; note: number;
      } | undefined;
      if (!detail) return;
      this.noteOff(detail.channel, detail.note);
    };

    window.addEventListener("omnitribe:noteOn", onNoteOn);
    window.addEventListener("omnitribe:noteOff", onNoteOff);
    this.unbindNoteOn = () =>
      window.removeEventListener("omnitribe:noteOn", onNoteOn);
    this.unbindNoteOff = () =>
      window.removeEventListener("omnitribe:noteOff", onNoteOff);
    this.enabled = true;
  }

  /** Schliesst alle aktiven Voices und beendet den AudioContext. */
  async disable(): Promise<void> {
    if (!this.enabled) return;
    for (const key of Array.from(this.active.keys())) {
      this.releaseVoice(key, 0);
    }
    this.unbindNoteOn?.(); this.unbindNoteOn = null;
    this.unbindNoteOff?.(); this.unbindNoteOff = null;
    try { await this.ctx?.close(); } catch { /* */ }
    this.ctx = null;
    this.masterGain = null;
    this.enabled = false;
  }

  get isEnabled(): boolean { return this.enabled; }
  get activeVoiceCount(): number { return this.active.size; }

  private noteOn(channel: number, note: number, velocity: number): void {
    if (!this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const key = voiceKey(channel, note);

    // Bereits aktive Voice fuer denselben key wegklappen (re-trigger)
    const existing = this.active.get(key);
    if (existing) this.releaseVoice(key, 0);

    // Voice-Stealing wenn zu viele aktiv
    if (this.active.size >= MAX_VOICES) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [k, v] of this.active) {
        if (v.startedAt < oldestTime) {
          oldestTime = v.startedAt;
          oldestKey = k;
        }
      }
      if (oldestKey) this.releaseVoice(oldestKey, 0);
    }

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = midiToFreq(note);

    const gain = ctx.createGain();
    const peak = Math.max(0.05, Math.min(1.0, velocity / 127));
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + ATTACK_S);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, peak * SUSTAIN_GAIN),
      now + ATTACK_S + DECAY_S,
    );

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);

    this.active.set(key, { oscillator: osc, gain, startedAt: now });
  }

  private noteOff(channel: number, note: number): void {
    this.releaseVoice(voiceKey(channel, note), RELEASE_S);
  }

  private releaseVoice(key: string, releaseTime: number): void {
    const voice = this.active.get(key);
    if (!voice || !this.ctx) return;
    this.active.delete(key);
    const now = this.ctx.currentTime;
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      voice.gain.gain.exponentialRampToValueAtTime(
        0.0001,
        now + Math.max(0.01, releaseTime),
      );
      voice.oscillator.stop(now + Math.max(0.02, releaseTime + 0.01));
    } catch { /* */ }
  }
}

/** Singleton — die App hat genau eine Audio-Engine. */
export const simAudioEngine = new SimAudioEngine();
