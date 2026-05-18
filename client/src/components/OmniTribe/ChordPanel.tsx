/**
 * ChordPanel — Akkord-Auswahl + Strum-Stagger + Enable-Toggle.
 *
 * Wiring:
 *   - chord-type:  setParam(part, 0x1E, 0x00 | (part<<4), typeId 0..14)
 *   - stagger:     setParam(part, 0x1E, 0x01 | (part<<4), ms 0..200 → MIDI 0..127)
 *   - enable:      setParam(part, 0x1E, 0x03 | (part<<4), 0/1)
 *
 * 2-Wege-Sync via omnitribe:paramChange CustomEvent: wenn ein Encoder am Geraet
 * den Chord-Type oder Stagger aendert, updatet diese Komponente den eigenen
 * State (ohne erneutes Senden via Echo-Schutz in der Bridge).
 *
 * Pure-UI: kein Audio, kein eigenes Note-Spawning — die OmniTribe-Firmware
 * (chord-modul ID 9) generiert die Akkord-Voices.
 */

import { useEffect, useState, useCallback, type ReactElement } from "react";
import {
  CHORD_TYPES,
  sendChordParam,
  chordPidToKey,
  decodeParamLow,
  OMNITRIBE_CHORD,
} from "../../utils/omniTribeWiring";

const STAGGER_MAX_MS = 200;

export interface ChordPanelProps {
  /** OmniTribe-Part-Index 0..15. Default 0. */
  partIndex?: number;
  /** Optional: wenn false, sind die Send-Calls No-Ops (Disconnected-State). */
  connected?: boolean;
}

export function ChordPanel({
  partIndex = 0,
  connected = true,
}: ChordPanelProps): ReactElement {
  const [chordTypeId, setChordTypeId] = useState<number>(0);
  const [staggerMs, setStaggerMs]     = useState<number>(0);
  const [enabled, setEnabled]         = useState<boolean>(false);

  // ── User-Slot lokale Editier-Cache (Intervall-Liste als CSV) ────────────
  const [userIntervals, setUserIntervals] = useState<Record<number, string>>({
    11: "0,4,7",   // Default = Major
    12: "0,3,7",
    13: "0,4,7,11",
    14: "0,5,7",
  });

  // ── Outbound: Type-Change ───────────────────────────────────────────────
  const handleChordTypeChange = useCallback((id: number) => {
    setChordTypeId(id);
    sendChordParam(partIndex, "type", id);
  }, [partIndex]);

  // ── Outbound: Stagger ───────────────────────────────────────────────────
  const handleStaggerChange = useCallback((ms: number) => {
    const clamped = Math.max(0, Math.min(STAGGER_MAX_MS, ms));
    setStaggerMs(clamped);
    // 0..200 ms → 0..127
    const midi = Math.round((clamped / STAGGER_MAX_MS) * 127);
    sendChordParam(partIndex, "stagger", midi);
  }, [partIndex]);

  // ── Outbound: Enable-Toggle ─────────────────────────────────────────────
  const handleEnableToggle = useCallback(() => {
    const next = !enabled;
    setEnabled(next);
    sendChordParam(partIndex, "enable", next ? 1 : 0);
  }, [enabled, partIndex]);

  // ── User-Slot Edit ──────────────────────────────────────────────────────
  const handleUserIntervalsChange = useCallback((slotId: number, csv: string) => {
    setUserIntervals((prev) => ({ ...prev, [slotId]: csv }));
  }, []);

  // ── Inbound: paramChange-Listener für 2-Wege-Sync ──────────────────────
  useEffect(() => {
    function onParam(e: Event): void {
      const detail = (e as CustomEvent).detail as {
        part: number; paramHigh: number; paramLow: number; value: number;
      } | undefined;
      if (!detail) return;
      if (detail.paramHigh !== OMNITRIBE_CHORD.PARAM_HIGH) return;
      const decoded = decodeParamLow(detail.paramLow);
      if (decoded.part !== partIndex) return;
      const key = chordPidToKey(decoded.pid);
      if (key === "type") setChordTypeId(detail.value & 0xFF);
      else if (key === "stagger") {
        // MIDI 0..127 → 0..200 ms
        setStaggerMs(Math.round((detail.value / 127) * STAGGER_MAX_MS));
      }
      else if (key === "enable") setEnabled((detail.value & 0x01) === 1);
    }
    window.addEventListener("omnitribe:paramChange", onParam);
    return () => window.removeEventListener("omnitribe:paramChange", onParam);
  }, [partIndex]);

  return (
    <div
      className="bg-bg-panel border border-border-color rounded p-4 space-y-4"
      data-testid="chord-panel"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Chord Panel</h3>
        <button
          type="button"
          onClick={handleEnableToggle}
          aria-pressed={enabled}
          data-testid="chord-enable-toggle"
          className={[
            "px-3 py-1 rounded text-xs font-bold border transition-colors",
            enabled
              ? "bg-accent-success/20 border-accent-success text-accent-success"
              : "bg-bg-elevated border-border-color text-text-dim hover:text-text-muted",
          ].join(" ")}
        >
          {enabled ? "Enabled" : "Disabled"}
        </button>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wide text-text-muted mb-2">
          Chord Type
          <span className="ml-2 text-text-dim normal-case tracking-normal">
            (Part {partIndex + 1}{!connected && " · Disconnected"})
          </span>
        </label>
        <div
          className="grid grid-cols-5 gap-1"
          role="radiogroup"
          aria-label="Chord type"
        >
          {CHORD_TYPES.map((ct) => (
            <button
              key={ct.id}
              type="button"
              role="radio"
              aria-checked={chordTypeId === ct.id}
              onClick={() => handleChordTypeChange(ct.id)}
              data-testid={`chord-type-${ct.id}`}
              className={[
                "px-2 py-1.5 rounded text-xs font-medium border transition-colors",
                chordTypeId === ct.id
                  ? "bg-accent-primary/20 border-accent-primary text-accent-primary"
                  : ct.isUser
                  ? "bg-bg-elevated border-border-color text-text-muted hover:text-text-primary"
                  : "bg-bg-base border-border-color text-text-muted hover:text-text-primary",
              ].join(" ")}
              title={ct.isUser ? "User-defined" : `Intervals: ${ct.intervals.join(", ")}`}
            >
              {ct.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label
          htmlFor="chord-stagger"
          className="block text-xs uppercase tracking-wide text-text-muted mb-2"
        >
          Strum Stagger:
          <span className="ml-2 text-text-primary normal-case tracking-normal font-mono">
            {staggerMs} ms
          </span>
        </label>
        <input
          id="chord-stagger"
          type="range"
          min={0}
          max={STAGGER_MAX_MS}
          step={1}
          value={staggerMs}
          onChange={(e) => handleStaggerChange(parseInt(e.target.value, 10))}
          data-testid="chord-stagger-slider"
          className="w-full accent-accent-primary"
          aria-label={`Strum stagger ${staggerMs} milliseconds`}
        />
      </div>

      {/* User-Slot-Editor: nur Anzeige + lokaler Cache (Firmware-Upload optional) */}
      <details className="border-t border-border-subtle pt-3">
        <summary className="text-xs uppercase tracking-wide text-text-muted cursor-pointer">
          User-Slots (4)
        </summary>
        <div className="mt-2 space-y-2">
          {[11, 12, 13, 14].map((slotId) => (
            <div
              key={slotId}
              className="flex items-center gap-2"
              data-testid={`chord-user-slot-${slotId}`}
            >
              <span className="text-xs text-text-muted w-16">
                User {slotId - 10}
              </span>
              <input
                type="text"
                value={userIntervals[slotId] ?? ""}
                onChange={(e) => handleUserIntervalsChange(slotId, e.target.value)}
                placeholder="0,4,7"
                className="flex-1 px-2 py-1 rounded bg-bg-base border border-border-color text-xs text-text-primary font-mono focus:outline-none focus:border-accent-primary"
                aria-label={`User chord slot ${slotId - 10} intervals`}
              />
            </div>
          ))}
          <p className="text-[10px] text-text-dim italic">
            Halbtoene relativ zum Root. Lokal — Upload an Geraet via Sysex (geplant).
          </p>
        </div>
      </details>
    </div>
  );
}

export default ChordPanel;
