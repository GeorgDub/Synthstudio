/**
 * PositionDisplay.tsx — Sprint-119c Song-Position-Pointer UI.
 *
 * Surfaciert Sprint-115 Features:
 *   - Aktuelle Step-Position (0..15, zeigt 1..16)
 *   - Aktueller Bank-Index (0..n, zeigt A..Z oder numerisch)
 *   - 21-bit Beats-Counter (sppBeats)
 *   - Playing-Status-Indikator
 *   - Set-Position-Form: beats-Eingabe + Apply-Button
 *
 * Bridge-Calls:
 *   - bridge.queryPosition()       CMD 0x0E SUB 0x09
 *   - bridge.setPosition(beats)    CMD 0x0E SUB 0x0A  (21-bit)
 *
 * Events:
 *   - omnitribe:positionChange  { playing, step, bank, sppBeats }
 *
 * NOTE: Bridge.setPosition(beats) nimmt einen 21-bit beats-Wert.
 * Die UI bietet zwei Eingabepfade:
 *   a) Direktes beats-Feld (0..2097151)
 *   b) Step (0..15) + Bank-Offset-Multiplikator: beats = bank * 16 + step
 *      (bank als "Seite" zu je 16 Schritten, konsistent mit sppBeats-Decodierung)
 */

import { useEffect, useState, useCallback, type ReactElement } from "react";
import { omniTribeBridge } from "../../audio/OmniTribeBridge";

const MAX_BEATS = 0x1FFFFF; // 2097151

function bankLabel(bank: number): string {
  // Bank 0..7 → A..H; darueberhinaus numerisch
  if (bank >= 0 && bank < 8) return String.fromCharCode(65 + bank);
  return `#${bank}`;
}

export interface PositionDisplayProps {
  connected: boolean;
}

export function PositionDisplay({ connected }: PositionDisplayProps): ReactElement {
  const [playing, setPlaying] = useState<boolean>(false);
  const [step, setStep] = useState<number>(0);
  const [bank, setBank] = useState<number>(0);
  const [sppBeats, setSppBeats] = useState<number>(0);

  // Form state for set-position
  const [formStep, setFormStep] = useState<number>(0);
  const [formBank, setFormBank] = useState<number>(0);
  const [formError, setFormError] = useState<string>("");

  useEffect(() => {
    const onPositionChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        playing: boolean;
        step: number;
        bank: number;
        sppBeats: number;
      };
      setPlaying(detail.playing);
      setStep(detail.step);
      setBank(detail.bank);
      setSppBeats(detail.sppBeats);
    };

    window.addEventListener("omnitribe:positionChange", onPositionChange);

    if (connected) {
      omniTribeBridge.queryPosition();
    }

    return () => {
      window.removeEventListener("omnitribe:positionChange", onPositionChange);
    };
  }, [connected]);

  const handleRefresh = useCallback(() => {
    if (!connected) return;
    omniTribeBridge.queryPosition();
  }, [connected]);

  const handleApplyPosition = useCallback(() => {
    if (!connected) return;

    // Validate step
    if (formStep < 0 || formStep > 15 || !Number.isInteger(formStep)) {
      setFormError("Step must be an integer 0..15");
      return;
    }
    if (formBank < 0 || !Number.isInteger(formBank)) {
      setFormError("Bank must be a non-negative integer");
      return;
    }

    const beats = formBank * 16 + formStep;
    if (beats > MAX_BEATS) {
      setFormError(`Computed beats ${beats} exceeds max ${MAX_BEATS}`);
      return;
    }

    setFormError("");
    omniTribeBridge.setPosition(beats);
  }, [connected, formStep, formBank]);

  const handleStepInput = useCallback((raw: string) => {
    const v = parseInt(raw, 10);
    setFormStep(isNaN(v) ? 0 : Math.max(0, Math.min(15, v)));
    setFormError("");
  }, []);

  const handleBankInput = useCallback((raw: string) => {
    const v = parseInt(raw, 10);
    setFormBank(isNaN(v) ? 0 : Math.max(0, v));
    setFormError("");
  }, []);

  return (
    <div
      className="bg-bg-panel border border-border-color rounded p-4 space-y-3"
      data-testid="position-display"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-text-primary">Song Position</h3>
        <div className="flex items-center gap-2">
          <span
            data-testid="position-playing-indicator"
            className={[
              "text-[10px] px-2 py-0.5 rounded font-mono",
              playing
                ? "bg-accent-success/20 text-accent-success"
                : "bg-bg-elevated text-text-dim",
            ].join(" ")}
          >
            {playing ? "PLAYING" : "STOPPED"}
          </span>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={!connected}
            data-testid="position-refresh"
            className="text-[10px] px-2 py-0.5 rounded bg-bg-elevated border border-border-color text-text-muted hover:text-text-primary disabled:opacity-40"
            aria-label="Refresh position"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Live Display */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-bg-elevated rounded p-2 text-center">
          <span className="text-[9px] uppercase tracking-wide text-text-dim block mb-1">
            Step
          </span>
          <span
            className="text-lg font-mono font-bold text-text-primary"
            data-testid="position-step"
          >
            {step + 1}
          </span>
          <span className="text-[9px] text-text-dim block">of 16</span>
        </div>
        <div className="bg-bg-elevated rounded p-2 text-center">
          <span className="text-[9px] uppercase tracking-wide text-text-dim block mb-1">
            Bank
          </span>
          <span
            className="text-lg font-mono font-bold text-text-primary"
            data-testid="position-bank"
          >
            {bankLabel(bank)}
          </span>
          <span className="text-[9px] text-text-dim block">#{bank}</span>
        </div>
        <div className="bg-bg-elevated rounded p-2 text-center">
          <span className="text-[9px] uppercase tracking-wide text-text-dim block mb-1">
            Beats
          </span>
          <span
            className="text-sm font-mono font-bold text-text-primary"
            data-testid="position-beats"
          >
            {sppBeats}
          </span>
          <span className="text-[9px] text-text-dim block">21-bit SPP</span>
        </div>
      </div>

      {/* Set-Position Form */}
      <div className="border-t border-border-color pt-3 space-y-2">
        <span className="text-[10px] uppercase tracking-wide text-text-dim block">
          Set Position
        </span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1">
            <span className="text-[10px] text-text-dim">Step</span>
            <input
              type="number"
              min={0}
              max={15}
              value={formStep}
              disabled={!connected}
              data-testid="position-form-step"
              onChange={(e) => handleStepInput(e.target.value)}
              className="w-12 bg-bg-elevated border border-border-color rounded px-1 text-[10px] text-text-primary font-mono text-center disabled:opacity-40"
              aria-label="Target step 0..15"
            />
          </label>
          <label className="flex items-center gap-1">
            <span className="text-[10px] text-text-dim">Bank</span>
            <input
              type="number"
              min={0}
              value={formBank}
              disabled={!connected}
              data-testid="position-form-bank"
              onChange={(e) => handleBankInput(e.target.value)}
              className="w-12 bg-bg-elevated border border-border-color rounded px-1 text-[10px] text-text-primary font-mono text-center disabled:opacity-40"
              aria-label="Target bank index"
            />
          </label>
          <span className="text-[9px] text-text-dim font-mono">
            = {formBank * 16 + formStep} beats
          </span>
          <button
            type="button"
            onClick={handleApplyPosition}
            disabled={!connected}
            data-testid="position-apply"
            className="ml-auto px-3 py-1 rounded text-[10px] font-bold bg-accent-primary/20 border border-accent-primary/60 text-accent-primary hover:bg-accent-primary/30 disabled:opacity-40"
            aria-label="Apply position"
          >
            Apply
          </button>
        </div>
        {formError && (
          <p
            className="text-[10px] text-accent-danger"
            data-testid="position-form-error"
            role="alert"
          >
            {formError}
          </p>
        )}
      </div>
    </div>
  );
}
