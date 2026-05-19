/**
 * Synthstudio – MasterFxPanel.tsx (v3.76.0)
 *
 * UI für den Master-FX-Bus: globaler Reverb (decay, damping, preDelay, wet,
 * bypass), Master-Delay (time, feedback, wet, bypass), Master-EQ (3-Band
 * low/mid/high gain + low/high freq + midQ + bypass), v3.76 NEU
 * Master-Limiter (threshold, knee, ratio, release, gain, bypass) mit
 * Live-GR-Meter.
 *
 * Tabbed-Layout (Reverb / Delay / EQ / Limiter). Mount-Position: in MixerView
 * als eigener Section unter den Return-Track-Strips (siehe Mixer-Wiring).
 *
 * Wiring: Slider-Change → Store-Setter → AudioEngine.setMaster*() im
 * selben Tick (Audio-Latency soll < 1 Frame bleiben).
 *
 * GR-Meter: pollt alle 50ms via setInterval die aktuelle Gain-Reduction
 * (DynamicsCompressorNode.reduction) vom AudioEngine. Animation-Frame-Budget
 * blieb damit niedrig (≈20 fps reicht für eine reine Pegelanzeige).
 *
 * Alle Farben über semantische Tailwind-Klassen (bg-bg-panel etc.) — keine
 * hardcoded Slates / Cyans.
 */
import { useEffect, useState } from "react";
import {
  useMasterFxStore,
  setMasterReverb,
  setMasterDelay,
  setMasterEq,
  setMasterLimiter,
} from "@/store/useMasterFxStore";
import { AudioEngine } from "@/audio/AudioEngine";

type Tab = "reverb" | "delay" | "eq" | "limiter";

/** v3.76.0: GR-Meter Update-Rate (50ms ≈ 20fps). */
const GR_METER_INTERVAL_MS = 50;

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  testId?: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

function SliderRow({
  label, value, min, max, step, unit, testId, format, onChange,
}: SliderRowProps) {
  const display = format ? format(value) : `${value.toFixed(step < 1 ? 2 : 0)}${unit ?? ""}`;
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-20 text-text-muted">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        data-testid={testId}
        className="flex-1 accent-accent-primary"
      />
      <span className="w-16 text-right text-text-primary tabular-nums">{display}</span>
    </label>
  );
}

interface BypassToggleProps {
  active: boolean;
  testId?: string;
  onToggle: () => void;
}

function BypassToggle({ active, testId, onToggle }: BypassToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      data-testid={testId}
      className={
        "px-2 py-1 text-xs rounded border " +
        (active
          ? "bg-accent-danger/20 border-accent-danger text-accent-danger"
          : "bg-bg-elevated border-border-color text-text-muted hover:text-text-primary")
      }
      aria-pressed={active}
    >
      {active ? "BYPASSED" : "ACTIVE"}
    </button>
  );
}

export function MasterFxPanel() {
  const state = useMasterFxStore();
  const [tab, setTab] = useState<Tab>("reverb");

  // ─── Reverb-Handler ────────────────────────────────────────────────────────
  const onReverbDecay = (v: number) => {
    setMasterReverb({ decay: v });
    AudioEngine.setMasterReverbDecay(v);
  };
  const onReverbDamping = (v: number) => {
    setMasterReverb({ damping: v });
    AudioEngine.setMasterReverbDamping(v);
  };
  const onReverbPreDelay = (v: number) => {
    setMasterReverb({ preDelay: v });
    AudioEngine.setMasterReverbPreDelay(v);
  };
  const onReverbWet = (v: number) => {
    setMasterReverb({ wet: v });
    AudioEngine.setMasterReverbWet(v);
  };
  const onReverbBypass = () => {
    const next = !state.reverb.bypass;
    setMasterReverb({ bypass: next });
    AudioEngine.setMasterReverbBypass(next);
  };

  // ─── Delay-Handler ─────────────────────────────────────────────────────────
  const onDelayTime = (v: number) => {
    setMasterDelay({ time: v });
    AudioEngine.setMasterDelayTime(v);
  };
  const onDelayFeedback = (v: number) => {
    setMasterDelay({ feedback: v });
    AudioEngine.setMasterDelayFeedback(v);
  };
  const onDelayWet = (v: number) => {
    setMasterDelay({ wet: v });
    AudioEngine.setMasterDelayWet(v);
  };
  const onDelayBypass = () => {
    const next = !state.delay.bypass;
    setMasterDelay({ bypass: next });
    AudioEngine.setMasterDelayBypass(next);
  };

  // ─── EQ-Handler ────────────────────────────────────────────────────────────
  const onEqLowGain = (v: number) => {
    setMasterEq({ lowGain: v });
    AudioEngine.setMasterEqLowGain(v);
  };
  const onEqMidGain = (v: number) => {
    setMasterEq({ midGain: v });
    AudioEngine.setMasterEqMidGain(v);
  };
  const onEqHighGain = (v: number) => {
    setMasterEq({ highGain: v });
    AudioEngine.setMasterEqHighGain(v);
  };
  const onEqLowFreq = (v: number) => {
    setMasterEq({ lowFreq: v });
    AudioEngine.setMasterEqLowFreq(v);
  };
  const onEqHighFreq = (v: number) => {
    setMasterEq({ highFreq: v });
    AudioEngine.setMasterEqHighFreq(v);
  };
  const onEqMidQ = (v: number) => {
    setMasterEq({ midQ: v });
    AudioEngine.setMasterEqMidQ(v);
  };
  const onEqBypass = () => {
    const next = !state.eq.bypass;
    setMasterEq({ bypass: next });
    AudioEngine.setMasterEqBypass(next);
  };

  // ─── Limiter-Handler (v3.76.0) ─────────────────────────────────────────────
  const onLimThreshold = (v: number) => {
    setMasterLimiter({ threshold: v });
    AudioEngine.setMasterLimiterThreshold(v);
  };
  const onLimKnee = (v: number) => {
    setMasterLimiter({ knee: v });
    AudioEngine.setMasterLimiterKnee(v);
  };
  const onLimRatio = (v: number) => {
    setMasterLimiter({ ratio: v });
    AudioEngine.setMasterLimiterRatio(v);
  };
  const onLimRelease = (v: number) => {
    setMasterLimiter({ release: v });
    AudioEngine.setMasterLimiterRelease(v);
  };
  const onLimGain = (v: number) => {
    setMasterLimiter({ gain: v });
    AudioEngine.setMasterLimiterGain(v);
  };
  const onLimBypass = () => {
    const next = !state.limiter.bypass;
    setMasterLimiter({ bypass: next });
    AudioEngine.setMasterLimiterBypass(next);
  };

  // ─── Live-GR-Meter (v3.76.0) ───────────────────────────────────────────────
  // Pollt alle 50ms die aktuelle Gain-Reduction. Nur aktiv solang der
  // Limiter-Tab sichtbar ist (Bypass-State erlaubt Polling aber liefert 0).
  const [gainReduction, setGainReduction] = useState(0);
  useEffect(() => {
    if (tab !== "limiter") return;
    const id = setInterval(() => {
      try {
        setGainReduction(AudioEngine.getMasterLimiterReduction());
      } catch {
        setGainReduction(0);
      }
    }, GR_METER_INTERVAL_MS);
    return () => clearInterval(id);
  }, [tab]);

  return (
    <section
      data-testid="master-fx-panel"
      className="bg-bg-panel border border-border-color rounded p-3 flex flex-col gap-3"
    >
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Master FX</h3>
        <nav className="flex gap-1" role="tablist">
          {(["reverb", "delay", "eq", "limiter"] as Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              onClick={() => setTab(t)}
              data-testid={`master-fx-tab-${t}`}
              className={
                "px-3 py-1 text-xs rounded " +
                (tab === t
                  ? "bg-accent-primary text-bg-base"
                  : "bg-bg-elevated text-text-muted hover:text-text-primary")
              }
              aria-selected={tab === t}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </nav>
      </header>

      {tab === "reverb" && (
        <div className="flex flex-col gap-2" role="tabpanel" data-testid="master-fx-reverb">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-muted">Global Reverb Bus</span>
            <BypassToggle
              active={state.reverb.bypass}
              testId="master-fx-reverb-bypass"
              onToggle={onReverbBypass}
            />
          </div>
          <SliderRow
            label="Decay"
            value={state.reverb.decay}
            min={0.1}
            max={10}
            step={0.1}
            testId="master-fx-reverb-decay"
            format={(v) => `${v.toFixed(1)} s`}
            onChange={onReverbDecay}
          />
          <SliderRow
            label="Damping"
            value={state.reverb.damping}
            min={0}
            max={1}
            step={0.01}
            testId="master-fx-reverb-damping"
            format={(v) => v.toFixed(2)}
            onChange={onReverbDamping}
          />
          <SliderRow
            label="Pre-Delay"
            value={state.reverb.preDelay}
            min={0}
            max={200}
            step={1}
            testId="master-fx-reverb-predelay"
            format={(v) => `${v.toFixed(0)} ms`}
            onChange={onReverbPreDelay}
          />
          <SliderRow
            label="Wet"
            value={state.reverb.wet}
            min={0}
            max={1}
            step={0.01}
            testId="master-fx-reverb-wet"
            format={(v) => v.toFixed(2)}
            onChange={onReverbWet}
          />
        </div>
      )}

      {tab === "delay" && (
        <div className="flex flex-col gap-2" role="tabpanel" data-testid="master-fx-delay">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-muted">Global Delay Bus</span>
            <BypassToggle
              active={state.delay.bypass}
              testId="master-fx-delay-bypass"
              onToggle={onDelayBypass}
            />
          </div>
          <SliderRow
            label="Time"
            value={state.delay.time}
            min={0.001}
            max={2.0}
            step={0.001}
            testId="master-fx-delay-time"
            format={(v) => `${(v * 1000).toFixed(0)} ms`}
            onChange={onDelayTime}
          />
          <SliderRow
            label="Feedback"
            value={state.delay.feedback}
            min={0}
            max={0.95}
            step={0.01}
            testId="master-fx-delay-feedback"
            format={(v) => `${(v * 100).toFixed(0)}%`}
            onChange={onDelayFeedback}
          />
          <SliderRow
            label="Wet"
            value={state.delay.wet}
            min={0}
            max={1}
            step={0.01}
            testId="master-fx-delay-wet"
            format={(v) => v.toFixed(2)}
            onChange={onDelayWet}
          />
        </div>
      )}

      {tab === "eq" && (
        <div className="flex flex-col gap-2" role="tabpanel" data-testid="master-fx-eq">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-muted">Master EQ (3-Band)</span>
            <BypassToggle
              active={state.eq.bypass}
              testId="master-fx-eq-bypass"
              onToggle={onEqBypass}
            />
          </div>
          <SliderRow
            label="Low Gain"
            value={state.eq.lowGain}
            min={-24}
            max={24}
            step={0.1}
            testId="master-fx-eq-lowgain"
            format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)} dB`}
            onChange={onEqLowGain}
          />
          <SliderRow
            label="Low Freq"
            value={state.eq.lowFreq}
            min={20}
            max={1000}
            step={1}
            testId="master-fx-eq-lowfreq"
            format={(v) => `${v.toFixed(0)} Hz`}
            onChange={onEqLowFreq}
          />
          <SliderRow
            label="Mid Gain"
            value={state.eq.midGain}
            min={-24}
            max={24}
            step={0.1}
            testId="master-fx-eq-midgain"
            format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)} dB`}
            onChange={onEqMidGain}
          />
          {/* v3.76.0: Mid-Band Q-Slider (0.3..10), closes v3.75-Caveat. */}
          <SliderRow
            label="Mid Q"
            value={state.eq.midQ}
            min={0.3}
            max={10}
            step={0.1}
            testId="master-fx-eq-midq"
            format={(v) => v.toFixed(1)}
            onChange={onEqMidQ}
          />
          <SliderRow
            label="High Gain"
            value={state.eq.highGain}
            min={-24}
            max={24}
            step={0.1}
            testId="master-fx-eq-highgain"
            format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)} dB`}
            onChange={onEqHighGain}
          />
          <SliderRow
            label="High Freq"
            value={state.eq.highFreq}
            min={1000}
            max={20000}
            step={10}
            testId="master-fx-eq-highfreq"
            format={(v) => `${(v / 1000).toFixed(1)} kHz`}
            onChange={onEqHighFreq}
          />
        </div>
      )}

      {tab === "limiter" && (
        <div className="flex flex-col gap-2" role="tabpanel" data-testid="master-fx-limiter">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-muted">Master Limiter (brick-wall)</span>
            <BypassToggle
              active={state.limiter.bypass}
              testId="master-fx-limiter-bypass"
              onToggle={onLimBypass}
            />
          </div>
          {/* GR-Meter — zeigt aktuelle Gain-Reduction. Negative dB-Werte
              (z.B. -3dB) bedeuten 3dB Reduktion. Update-Rate 50ms (20fps). */}
          <div
            className="flex items-center gap-2 text-xs"
            data-testid="master-fx-limiter-gr-row"
          >
            <span className="w-20 text-text-muted">Gain Reduction</span>
            <div className="flex-1 h-2 bg-bg-elevated rounded overflow-hidden">
              <div
                className="h-full bg-accent-danger transition-all duration-75"
                style={{
                  width: `${Math.min(100, Math.max(0, -gainReduction * 5))}%`,
                }}
                data-testid="master-fx-limiter-gr-bar"
              />
            </div>
            <span
              className="w-16 text-right text-text-primary tabular-nums"
              data-testid="master-fx-limiter-gr-value"
            >
              {gainReduction <= -0.05 ? `${gainReduction.toFixed(1)} dB` : "0.0 dB"}
            </span>
          </div>
          <SliderRow
            label="Threshold"
            value={state.limiter.threshold}
            min={-60}
            max={0}
            step={0.1}
            testId="master-fx-limiter-threshold"
            format={(v) => `${v.toFixed(1)} dB`}
            onChange={onLimThreshold}
          />
          <SliderRow
            label="Knee"
            value={state.limiter.knee}
            min={0}
            max={40}
            step={0.5}
            testId="master-fx-limiter-knee"
            format={(v) => `${v.toFixed(1)} dB`}
            onChange={onLimKnee}
          />
          <SliderRow
            label="Ratio"
            value={state.limiter.ratio}
            min={1}
            max={20}
            step={0.1}
            testId="master-fx-limiter-ratio"
            format={(v) => `${v.toFixed(1)}:1`}
            onChange={onLimRatio}
          />
          <SliderRow
            label="Release"
            value={state.limiter.release}
            min={0}
            max={1}
            step={0.005}
            testId="master-fx-limiter-release"
            format={(v) => `${(v * 1000).toFixed(0)} ms`}
            onChange={onLimRelease}
          />
          <SliderRow
            label="Make-Up"
            value={state.limiter.gain}
            min={0}
            max={4}
            step={0.05}
            testId="master-fx-limiter-gain"
            format={(v) => `${v.toFixed(2)}x`}
            onChange={onLimGain}
          />
        </div>
      )}
    </section>
  );
}

export default MasterFxPanel;
