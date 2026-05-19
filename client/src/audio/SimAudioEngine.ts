/**
 * SimAudioEngine.ts — Sprint-102/106 Web-Audio Synth-Stub.
 *
 * Sprint-106: FX-Chain
 *   osc → filter (LP, cutoff+Q) → delay (time+feedback) → master → output
 * Selectable waveform: sine, sawtooth, square, triangle.
 *
 * Spielt einfache Toene mit ADSR-Envelope auf jedes empfangene
 * omnitribe:noteOn-Event und stoppt sie auf omnitribe:noteOff.
 *
 * Zweck: ohne Hardware den kompletten Note-Trigger-Pfad hoerbar machen.
 * Bewusst kompakt — kein LFO, kein Multi-Voice-Pooling. Wenn mehr als
 * 32 gleichzeitige Notes anliegen, wird die aelteste verdraengt.
 */

export type Waveform = "sine" | "sawtooth" | "square" | "triangle";

export interface AudioFxSettings {
  waveform: Waveform;
  /** Filter-Cutoff in Hz (40..20000). */
  filterCutoffHz: number;
  /** Filter-Resonance Q (0.1..20). */
  filterQ: number;
  /** Delay-Time in s (0..1.5). */
  delayTimeS: number;
  /** Delay-Feedback (0..0.95). 0 = kein Delay. */
  delayFeedback: number;
  /** Master-Gain (0..1). */
  masterGain: number;
}

export const DEFAULT_FX: AudioFxSettings = {
  waveform: "sine",
  filterCutoffHz: 4000,
  filterQ: 1,
  delayTimeS: 0,            // default: kein Delay
  delayFeedback: 0.3,
  masterGain: 0.3,
};

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
  private filter: BiquadFilterNode | null = null;
  private delay: DelayNode | null = null;
  private delayFeedbackGain: GainNode | null = null;
  private dryGain: GainNode | null = null;
  private active = new Map<string, ActiveVoice>();
  private enabled = false;
  private unbindNoteOn: (() => void) | null = null;
  private unbindNoteOff: (() => void) | null = null;
  private settings: AudioFxSettings = { ...DEFAULT_FX };

  async enable(): Promise<void> {
    if (this.enabled) return;
    if (typeof window === "undefined") return;
    const AC = window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext })
           .webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    if (this.ctx.state === "suspended") {
      try { await this.ctx.resume(); } catch { /* */ }
    }

    // ─── FX-Graph aufbauen ─────────────────────────────────
    // osc → filter → split:
    //   filter → dryGain → masterGain
    //   filter → delay → feedbackLoop → masterGain
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.settings.masterGain;
    this.masterGain.connect(this.ctx.destination);

    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = this.settings.filterCutoffHz;
    this.filter.Q.value = this.settings.filterQ;

    this.dryGain = this.ctx.createGain();
    this.dryGain.gain.value = 1.0;
    this.filter.connect(this.dryGain);
    this.dryGain.connect(this.masterGain);

    this.delay = this.ctx.createDelay(2.0);
    this.delay.delayTime.value = this.settings.delayTimeS;
    this.delayFeedbackGain = this.ctx.createGain();
    this.delayFeedbackGain.gain.value = this.settings.delayFeedback;

    // Filter-Output → Delay-Line
    this.filter.connect(this.delay);
    // Delay-Output → masterGain (wet signal)
    this.delay.connect(this.masterGain);
    // Feedback-Loop: delay → feedbackGain → delay
    this.delay.connect(this.delayFeedbackGain);
    this.delayFeedbackGain.connect(this.delay);

    // ─── Event-Listener ─────────────────────────────────────
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
    this.filter = null;
    this.delay = null;
    this.delayFeedbackGain = null;
    this.dryGain = null;
    this.enabled = false;
  }

  get isEnabled(): boolean { return this.enabled; }
  get activeVoiceCount(): number { return this.active.size; }
  getSettings(): AudioFxSettings { return { ...this.settings }; }

  // ─── Sprint-106: Realtime FX-Parameter-Setter ────────────

  setWaveform(w: Waveform): void {
    this.settings.waveform = w;
    // Bestehende Stimmen behalten ihre Welle (Web-Audio-osc.type ist
    // nur beim Erzeugen relevant) — neue Notes nutzen die neue Welle.
  }

  setFilterCutoff(hz: number): void {
    const clamped = Math.max(40, Math.min(20000, hz));
    this.settings.filterCutoffHz = clamped;
    if (this.filter && this.ctx) {
      this.filter.frequency.setTargetAtTime(clamped, this.ctx.currentTime, 0.01);
    }
  }

  setFilterQ(q: number): void {
    const clamped = Math.max(0.1, Math.min(20, q));
    this.settings.filterQ = clamped;
    if (this.filter && this.ctx) {
      this.filter.Q.setTargetAtTime(clamped, this.ctx.currentTime, 0.01);
    }
  }

  setDelayTime(s: number): void {
    const clamped = Math.max(0, Math.min(1.5, s));
    this.settings.delayTimeS = clamped;
    if (this.delay && this.ctx) {
      this.delay.delayTime.setTargetAtTime(clamped, this.ctx.currentTime, 0.01);
    }
  }

  setDelayFeedback(amount: number): void {
    const clamped = Math.max(0, Math.min(0.95, amount));
    this.settings.delayFeedback = clamped;
    if (this.delayFeedbackGain && this.ctx) {
      this.delayFeedbackGain.gain.setTargetAtTime(
        clamped, this.ctx.currentTime, 0.01,
      );
    }
  }

  setMasterGain(g: number): void {
    const clamped = Math.max(0, Math.min(1, g));
    this.settings.masterGain = clamped;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        clamped, this.ctx.currentTime, 0.01,
      );
    }
  }

  /** Bulk-Update — z.B. nach loadFxCache(). */
  applySettings(s: Partial<AudioFxSettings>): void {
    if (s.waveform !== undefined) this.setWaveform(s.waveform);
    if (s.filterCutoffHz !== undefined) this.setFilterCutoff(s.filterCutoffHz);
    if (s.filterQ !== undefined) this.setFilterQ(s.filterQ);
    if (s.delayTimeS !== undefined) this.setDelayTime(s.delayTimeS);
    if (s.delayFeedback !== undefined) this.setDelayFeedback(s.delayFeedback);
    if (s.masterGain !== undefined) this.setMasterGain(s.masterGain);
  }

  // ─── Voice-Handling ──────────────────────────────────────

  private noteOn(channel: number, note: number, velocity: number): void {
    if (!this.ctx || !this.filter) return;
    const ctx = this.ctx;
    const key = voiceKey(channel, note);

    const existing = this.active.get(key);
    if (existing) this.releaseVoice(key, 0);

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
    osc.type = this.settings.waveform;
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
    gain.connect(this.filter);   // FX-Chain Entry
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

export const simAudioEngine = new SimAudioEngine();
