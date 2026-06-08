/**
 * Synthstudio – SubMixBusStrip.tsx (v3.86.0)
 *
 * Channel-Strip-Variante für einen Sub-Mix-Bus (Channel-Grouping mit
 * shared Volume/Pan/Mute/Solo + voller FX-Chain). Closes v3.79.1 UI-Lücke:
 * bisher gab es den Store (v3.79.0) + Engine-Wiring (v3.79.1), aber keinen
 * visuellen Strip im MixerView.
 *
 * Layout (top → bottom):
 *   1. Color-Indicator (3px Strip oben, inline-style mit bus.color)
 *   2. Editable Bus-Name (Input mit onBlur → renameBus, maxLength 32)
 *   3. "Members: N" Counter
 *   4. Vertical Volume-Fader (0..2, mit dB-Anzeige)
 *   5. Pan-Slider (-1..+1)
 *   6. M / S Buttons (mute/solo)
 *   7. "× Remove" Button (mit Confirm wenn members > 0)
 *   8. v3.86.0: "▸ FX"-Toggle öffnet Inline-FX-Section (EQ-3 + Comp-Toggle
 *      + Threshold + Reverb-Send + Delay-Send Knobs).
 *
 * Styling: ausschließlich semantische --ss-* Tokens. Layout-Breite analog
 * ChannelStrip (52px), Bus-Strips sitzen rechts neben den regulären
 * Channels und LINKS vom Master.
 *
 * v3.81.0:
 *   - Right-Click MIDI-Learn auf Volume/Pan/Mute/Solo via useMidiLearn-Hook
 *     (Targets: subMixBusVolume/Pan/Mute/Solo, gebridged in useMidiEventBridge).
 *   - Color-Picker (ChannelColorPicker) im oberen Color-Indicator.
 *
 * v3.86.0:
 *   - FX-Section inline (EQ-3 Mini-Sliders + Comp-Toggle/Threshold + Sends).
 *   - Detailliertes Editing per Modal "Bus FX" via Doppelklick auf FX-Toggle.
 *   - Per-Section Slider rufen setBusEq3/setBusCompressor/setBusReverbSend/
 *     setBusDelaySend — der App-Subscribe-Effect synchront mit AudioEngine.
 *
 * v3.88.0:
 *   - Right-Click MIDI-Learn auf den 7 v3.87-Bus-FX-Targets im BusFxModal:
 *     EQ Low/Mid/High, Comp Threshold/Ratio, Reverb-Send, Delay-Send.
 *     ·CC<n>-Badge in den Slider-Labels (analog v1.86 Right-Click-Learn).
 *   - NEU postGain-Slider (Post-Comp-Trim 0..2) im Modal — verbunden mit
 *     setBusPostGain → AudioEngine compMix → postGain → gain Wiring.
 */
import React, { useCallback, useState } from "react";
import {
  type SubMixBus,
  type SubMixBusFx,
  DEFAULT_BUS_FX,
  removeBus,
  renameBus,
  setBusVolume,
  setBusPan,
  setBusMute,
  setBusSolo,
  setBusColor,
  setBusEq3,
  setBusCompressor,
  setBusReverbSend,
  setBusDelaySend,
  setBusFx,
  setBusPostGain,
} from "@/store/useSubMixStore";
import { useMidiLearn } from "@/hooks/useMidiLearn";
import { ChannelColorPicker } from "@/components/Mixer/ChannelColorPicker";
import { useConfirm } from "@/components/common/ConfirmDialog";

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function volToDb(vol: number): string {
  if (vol <= 0) return "-∞";
  const db = 20 * Math.log10(Math.max(0.001, vol));
  return (db >= 0 ? "+" : "") + db.toFixed(1) + " dB";
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface SubMixBusStripProps {
  bus: SubMixBus;
  /**
   * Bus-Index — wird für eine Default-Farbe genutzt, wenn `bus.color`
   * undefined ist. Pure visuell.
   */
  busIndex: number;
}

/** 8 OLED-freundliche Bus-Default-Farben (analog channelColors-Palette, andere Reihenfolge). */
const BUS_COLOR_DEFAULTS = [
  "#06b6d4", // cyan
  "#a855f7", // purple
  "#22c55e", // green
  "#f59e0b", // amber
  "#ec4899", // pink
  "#3b82f6", // blue
  "#ef4444", // red
  "#eab308", // yellow
];

function resolveBusColor(explicit: string | undefined, idx: number): string {
  if (typeof explicit === "string" && /^#[0-9a-fA-F]{3,6}$/.test(explicit)) {
    return explicit;
  }
  return BUS_COLOR_DEFAULTS[Math.max(0, idx) % BUS_COLOR_DEFAULTS.length];
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * v3.86.0: Liefert die aktuelle FX-Config (mit Defaults bei Pre-v1.33-Buses).
 * Pure-Helper — exported für Tests + UI-Synchronität.
 */
export function resolveBusFx(bus: SubMixBus): SubMixBusFx {
  if (!bus.fx) return { ...DEFAULT_BUS_FX };
  return {
    enabled:    bus.fx.enabled ?? DEFAULT_BUS_FX.enabled,
    postGain:   bus.fx.postGain ?? DEFAULT_BUS_FX.postGain,
    eq3:        { ...DEFAULT_BUS_FX.eq3, ...(bus.fx.eq3 ?? {}) },
    compressor: { ...DEFAULT_BUS_FX.compressor, ...(bus.fx.compressor ?? {}) },
    reverbSend: bus.fx.reverbSend ?? DEFAULT_BUS_FX.reverbSend,
    delaySend:  bus.fx.delaySend ?? DEFAULT_BUS_FX.delaySend,
  };
}

export function SubMixBusStrip({ bus, busIndex }: SubMixBusStripProps): React.ReactElement {
  const [editingName, setEditingName] = useState<string>(bus.name);
  const [fxExpanded, setFxExpanded] = useState<boolean>(false);
  const [fxModalOpen, setFxModalOpen] = useState<boolean>(false);

  // Lokaler Edit-State wird bei externer Mutation aufgefrischt (z.B. Project-
  // Load setzt einen neuen Namen). useState-init reicht nicht, daher manueller
  // sync via key-Vergleich.
  React.useEffect(() => {
    setEditingName(bus.name);
  }, [bus.name]);

  const fx = resolveBusFx(bus);

  const memberCount = bus.channelIds.length;
  const resolvedColor = resolveBusColor(bus.color, busIndex);

  // v3.81.0: Right-Click MIDI-Learn auf Bus-Controls
  const volumeLearn = useMidiLearn({ type: "subMixBusVolume", busId: bus.id, busName: bus.name });
  const panLearn    = useMidiLearn({ type: "subMixBusPan",    busId: bus.id, busName: bus.name });
  const muteLearn   = useMidiLearn({ type: "subMixBusMute",   busId: bus.id, busName: bus.name });
  const soloLearn   = useMidiLearn({ type: "subMixBusSolo",   busId: bus.id, busName: bus.name });

  const confirm = useConfirm();

  // v3.81.0: Color-Picker — onColorChange → setBusColor (undefined = reset).
  const handleColorChange = useCallback(
    (color: string | undefined) => {
      setBusColor(bus.id, color);
    },
    [bus.id],
  );

  const handleRemove = useCallback(async () => {
    if (memberCount > 0) {
      const ok = await confirm({
        title: `Bus "${bus.name}" hat ${memberCount} Mitglied${memberCount === 1 ? "" : "er"}.`,
        message: "Channels fallen auf Master zurück. Trotzdem entfernen?",
        confirmLabel: "Entfernen",
        destructive: true,
      });
      if (!ok) return;
    }
    removeBus(bus.id);
  }, [bus.id, bus.name, memberCount, confirm]);

  const labelColor = bus.mute ? "text-text-dim" : bus.solo ? "text-accent-success" : "text-text-primary";

  return (
    <div
      data-testid={`sub-mix-bus-strip-${bus.id}`}
      className={[
        "flex flex-col items-center gap-1 px-2 py-2 select-none relative",
        "border-r border-border-color last:border-r-0",
        "bg-bg-panel/40 border-l border-border-color pl-3",
        bus.mute ? "opacity-50" : "",
      ].join(" ")}
      style={{
        minWidth: "56px",
        // Color-Indicator als 3px-Strip am oberen Rand (analog ChannelStrip).
        boxShadow: `inset 0 3px 0 0 ${resolvedColor}`,
      }}
    >
      {/* v3.81.0: Color-Picker — oben links, Klick stoppt Propagation damit
          der Strip nicht selektiert/expanded wird. */}
      <div className="absolute top-1 left-1 z-10" onClick={(e) => e.stopPropagation()}>
        <ChannelColorPicker
          channelName={bus.name}
          color={bus.color}
          index={busIndex}
          onColorChange={handleColorChange}
          testIdPrefix={`sub-mix-bus-color-${bus.id}`}
        />
      </div>

      {/* Bus-Name (editable) */}
      <input
        type="text"
        value={editingName}
        maxLength={32}
        onChange={(e) => setEditingName(e.target.value)}
        onBlur={() => {
          const trimmed = editingName.trim();
          if (trimmed.length > 0 && trimmed !== bus.name) {
            renameBus(bus.id, trimmed);
          } else {
            setEditingName(bus.name);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setEditingName(bus.name);
            (e.target as HTMLInputElement).blur();
          }
        }}
        data-testid={`sub-mix-bus-name-${bus.id}`}
        aria-label={`Bus name: ${bus.name}`}
        className={[
          "text-[9px] font-medium uppercase tracking-wide truncate w-full text-center",
          "bg-transparent border-b border-transparent hover:border-border-color focus:border-accent-primary",
          "focus:outline-none px-0.5",
          labelColor,
        ].join(" ")}
        title={`Bus "${bus.name}" — Rename`}
      />

      {/* Members-Counter */}
      <span
        data-testid={`sub-mix-bus-members-${bus.id}`}
        className="text-[8px] text-text-dim font-mono"
        title={`${memberCount} Channel${memberCount === 1 ? "" : "s"} routen in diesen Bus`}
      >
        Members: {memberCount}
      </span>

      {/* Vertical Fader (Volume 0..2) — v3.81: right-click MIDI-Learn */}
      <div className="flex items-end gap-1 h-28">
        <input
          type="range"
          min={0}
          max={2}
          step={0.01}
          value={bus.volume}
          onChange={(e) => setBusVolume(bus.id, parseFloat(e.target.value))}
          onContextMenu={volumeLearn.onContextMenu}
          data-testid={`sub-mix-bus-volume-${bus.id}`}
          aria-label={`Bus ${bus.name} volume`}
          className="h-28 w-3 accent-accent-primary cursor-pointer"
          style={{
            writingMode: "vertical-lr",
            direction: "rtl",
            appearance: "slider-vertical" as React.CSSProperties["appearance"],
          }}
          title={`${volToDb(bus.volume)} · Rechtsklick: MIDI-Learn${volumeLearn.isMapped ? ` · CC${volumeLearn.mappedCC}` : ""}`}
        />
        {volumeLearn.menu}
      </div>

      {/* dB-Anzeige + Mapped-Badge */}
      <span className="text-[8px] text-text-dim font-mono">
        {volToDb(bus.volume)}
        {volumeLearn.isMapped && (
          <span className="ml-1 text-accent-secondary">·CC{volumeLearn.mappedCC}</span>
        )}
      </span>

      {/* Pan-Regler — v3.81: right-click MIDI-Learn */}
      <div className="flex flex-col items-center gap-0.5 w-full">
        <span className="text-[8px] text-text-dim uppercase">Pan</span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={bus.pan}
          onChange={(e) => setBusPan(bus.id, parseFloat(e.target.value))}
          onContextMenu={panLearn.onContextMenu}
          data-testid={`sub-mix-bus-pan-${bus.id}`}
          aria-label={`Bus ${bus.name} pan`}
          className="w-full accent-accent-primary cursor-pointer"
          title={`${bus.pan === 0 ? "Center" : bus.pan > 0 ? `R ${Math.round(bus.pan * 100)}` : `L ${Math.round(-bus.pan * 100)}`}${panLearn.isMapped ? ` · CC${panLearn.mappedCC}` : ""}`}
        />
        <span className="text-[8px] text-text-dim font-mono">
          {bus.pan === 0 ? "C" : bus.pan > 0 ? `R${Math.round(bus.pan * 100)}` : `L${Math.round(-bus.pan * 100)}`}
          {panLearn.isMapped && (
            <span className="ml-1 text-accent-secondary">·CC{panLearn.mappedCC}</span>
          )}
        </span>
        {panLearn.menu}
      </div>

      {/* Mute / Solo — v3.81: right-click MIDI-Learn */}
      <div className="flex gap-1 relative">
        <button
          type="button"
          onClick={() => setBusMute(bus.id, !bus.mute)}
          onContextMenu={muteLearn.onContextMenu}
          data-testid={`sub-mix-bus-mute-${bus.id}`}
          aria-pressed={bus.mute}
          aria-label={`Bus ${bus.name} mute`}
          title={`Mute Bus · Rechtsklick: MIDI-Learn${muteLearn.isMapped ? ` · CC${muteLearn.mappedCC}` : ""}`}
          className={[
            "w-6 h-5 rounded text-[8px] font-bold transition-colors duration-100 relative",
            bus.mute
              ? "bg-accent-secondary text-bg-base"
              : "bg-bg-elevated text-text-dim hover:text-text-primary hover:text-accent-secondary",
          ].join(" ")}
        >
          M
          {muteLearn.isMapped && (
            <span
              className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-accent-secondary"
              aria-hidden="true"
            />
          )}
        </button>
        <button
          type="button"
          onClick={() => setBusSolo(bus.id, !bus.solo)}
          onContextMenu={soloLearn.onContextMenu}
          data-testid={`sub-mix-bus-solo-${bus.id}`}
          aria-pressed={bus.solo}
          aria-label={`Bus ${bus.name} solo`}
          title={`Solo Bus · Rechtsklick: MIDI-Learn${soloLearn.isMapped ? ` · CC${soloLearn.mappedCC}` : ""}`}
          className={[
            "w-6 h-5 rounded text-[8px] font-bold transition-colors duration-100 relative",
            bus.solo
              ? "bg-accent-success text-bg-base"
              : "bg-bg-elevated text-text-dim hover:text-text-primary hover:text-accent-success",
          ].join(" ")}
        >
          S
          {soloLearn.isMapped && (
            <span
              className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-accent-success"
              aria-hidden="true"
            />
          )}
        </button>
        {muteLearn.menu}
        {soloLearn.menu}
      </div>

      {/* v3.86.0: FX-Toggle (Expand/Collapse) + Modal-Trigger via Doppelklick */}
      <button
        type="button"
        onClick={() => setFxExpanded((v) => !v)}
        onDoubleClick={() => setFxModalOpen(true)}
        data-testid={`sub-mix-bus-fx-toggle-${bus.id}`}
        aria-pressed={fxExpanded}
        aria-label={`${fxExpanded ? "Collapse" : "Expand"} FX for ${bus.name}`}
        title="FX-Section ein-/ausklappen · Doppelklick: Modal"
        className={[
          "mt-1 w-full px-1 py-0.5 text-[8px] rounded border transition-colors",
          fx.enabled
            ? "border-accent-primary/60 bg-accent-primary/10 text-accent-primary"
            : "border-border-color text-text-muted hover:text-text-primary",
        ].join(" ")}
      >
        {fxExpanded ? "▾" : "▸"} FX{fx.enabled ? " ●" : ""}
      </button>

      {/* v3.86.0: Inline FX-Section — EQ-3 Mini + Comp-Toggle + Sends */}
      {fxExpanded && (
        <div
          data-testid={`sub-mix-bus-fx-section-${bus.id}`}
          className="w-full flex flex-col gap-1 mt-1 pt-1 border-t border-border-subtle"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Master-Enable */}
          <button
            type="button"
            onClick={() => setBusFx(bus.id, { enabled: !fx.enabled })}
            data-testid={`sub-mix-bus-fx-enabled-${bus.id}`}
            aria-pressed={fx.enabled}
            className={[
              "px-1 py-0.5 text-[8px] rounded transition-colors",
              fx.enabled
                ? "bg-accent-primary/20 text-accent-primary"
                : "bg-bg-elevated text-text-dim hover:text-text-primary",
            ].join(" ")}
            title="FX-Chain Master-Enable"
          >
            {fx.enabled ? "ON" : "OFF"}
          </button>

          {/* EQ-3 Mini-Sliders */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[7px] uppercase text-text-dim tracking-wide">EQ</span>
            <FxMiniSlider
              testId={`sub-mix-bus-eq-low-${bus.id}`}
              label="Lo"
              min={-24}
              max={24}
              step={0.5}
              value={fx.eq3.lowGain}
              onChange={(v) => setBusEq3(bus.id, { lowGain: v })}
              format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}dB`}
            />
            <FxMiniSlider
              testId={`sub-mix-bus-eq-mid-${bus.id}`}
              label="Md"
              min={-24}
              max={24}
              step={0.5}
              value={fx.eq3.midGain}
              onChange={(v) => setBusEq3(bus.id, { midGain: v })}
              format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}dB`}
            />
            <FxMiniSlider
              testId={`sub-mix-bus-eq-high-${bus.id}`}
              label="Hi"
              min={-24}
              max={24}
              step={0.5}
              value={fx.eq3.highGain}
              onChange={(v) => setBusEq3(bus.id, { highGain: v })}
              format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}dB`}
            />
          </div>

          {/* Compressor: Toggle + Threshold */}
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between">
              <span className="text-[7px] uppercase text-text-dim tracking-wide">Comp</span>
              <button
                type="button"
                onClick={() => setBusCompressor(bus.id, { enabled: !fx.compressor.enabled })}
                data-testid={`sub-mix-bus-comp-enabled-${bus.id}`}
                aria-pressed={fx.compressor.enabled}
                className={[
                  "px-1 text-[7px] rounded transition-colors",
                  fx.compressor.enabled
                    ? "bg-accent-success/20 text-accent-success"
                    : "bg-bg-elevated text-text-dim hover:text-text-primary",
                ].join(" ")}
              >
                {fx.compressor.enabled ? "ON" : "OFF"}
              </button>
            </div>
            <FxMiniSlider
              testId={`sub-mix-bus-comp-threshold-${bus.id}`}
              label="Th"
              min={-60}
              max={0}
              step={0.5}
              value={fx.compressor.threshold}
              onChange={(v) => setBusCompressor(bus.id, { threshold: v })}
              format={(v) => `${v.toFixed(1)}`}
            />
          </div>

          {/* Sends: Reverb + Delay */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[7px] uppercase text-text-dim tracking-wide">Sends</span>
            <FxMiniSlider
              testId={`sub-mix-bus-reverb-send-${bus.id}`}
              label="Rv"
              min={0}
              max={1}
              step={0.01}
              value={fx.reverbSend}
              onChange={(v) => setBusReverbSend(bus.id, v)}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <FxMiniSlider
              testId={`sub-mix-bus-delay-send-${bus.id}`}
              label="Dl"
              min={0}
              max={1}
              step={0.01}
              value={fx.delaySend}
              onChange={(v) => setBusDelaySend(bus.id, v)}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </div>

          <button
            type="button"
            onClick={() => setFxModalOpen(true)}
            data-testid={`sub-mix-bus-fx-modal-open-${bus.id}`}
            className="mt-0.5 px-1 py-0.5 text-[7px] rounded border border-border-color text-text-muted hover:text-text-primary"
            title="Detail-Editor öffnen"
          >
            Edit…
          </button>
        </div>
      )}

      {/* Remove */}
      <button
        type="button"
        onClick={handleRemove}
        data-testid={`sub-mix-bus-remove-${bus.id}`}
        aria-label={`Remove bus ${bus.name}`}
        title={memberCount > 0 ? `Bus entfernen (${memberCount} Member fallen zu Master)` : "Bus entfernen"}
        className="mt-1 px-1.5 py-0.5 text-[8px] rounded border border-accent-danger/40 text-accent-danger/80 hover:bg-accent-danger/15 transition-colors"
      >
        × Remove
      </button>

      {/* v3.86.0: Bus FX Modal — detailed editing (analog ChannelInspector) */}
      {fxModalOpen && (
        <BusFxModal
          bus={bus}
          fx={fx}
          onClose={() => setFxModalOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Mini-Slider Helper (für inline-FX-Section) ────────────────────────────

interface FxMiniSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  testId: string;
  format: (v: number) => string;
  onChange: (v: number) => void;
}

function FxMiniSlider({
  label, value, min, max, step, testId, format, onChange,
}: FxMiniSliderProps): React.ReactElement {
  return (
    <label className="flex items-center gap-1 text-[8px] w-full">
      <span className="w-4 text-text-dim font-mono">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        data-testid={testId}
        className="flex-1 h-1 accent-accent-primary cursor-pointer"
      />
      <span className="w-8 text-right text-text-muted font-mono tabular-nums">{format(value)}</span>
    </label>
  );
}

// ─── BusFxModal — detailed editing dialog ───────────────────────────────────

interface BusFxModalProps {
  bus: SubMixBus;
  fx: SubMixBusFx;
  onClose: () => void;
}

function BusFxModal({ bus, fx, onClose }: BusFxModalProps): React.ReactElement {
  // v3.88.0: Right-Click MIDI-Learn auf alle 7 v3.87-Bus-FX-Targets + Modal-Slider.
  // Pro Control wird ein useMidiLearn-Hook bezogen — die Targets matchen 1:1
  // den useMidi.MidiLearnTarget-Union (subMixBusEqLowGain etc.).
  const learnEqLow    = useMidiLearn({ type: "subMixBusEqLowGain",    busId: bus.id, busName: bus.name });
  const learnEqMid    = useMidiLearn({ type: "subMixBusEqMidGain",    busId: bus.id, busName: bus.name });
  const learnEqHigh   = useMidiLearn({ type: "subMixBusEqHighGain",   busId: bus.id, busName: bus.name });
  const learnCompThr  = useMidiLearn({ type: "subMixBusCompThreshold", busId: bus.id, busName: bus.name });
  const learnCompRat  = useMidiLearn({ type: "subMixBusCompRatio",    busId: bus.id, busName: bus.name });
  const learnReverbSend = useMidiLearn({ type: "subMixBusReverbSend", busId: bus.id, busName: bus.name });
  const learnDelaySend  = useMidiLearn({ type: "subMixBusDelaySend",  busId: bus.id, busName: bus.name });

  return (
    <div
      role="dialog"
      aria-label={`Bus FX: ${bus.name}`}
      data-testid={`sub-mix-bus-fx-modal-${bus.id}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg-base/80"
      onClick={onClose}
    >
      <div
        className="bg-bg-panel border border-border-color rounded-lg p-4 flex flex-col gap-3 w-80 max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border-subtle pb-2">
          <h3 className="text-sm font-semibold text-text-primary">
            Bus FX — {bus.name}
          </h3>
          <button
            type="button"
            onClick={onClose}
            data-testid={`sub-mix-bus-fx-modal-close-${bus.id}`}
            className="text-xs text-text-muted hover:text-text-primary px-2"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        {/* Master-Enable */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">FX-Chain</span>
          <button
            type="button"
            onClick={() => setBusFx(bus.id, { enabled: !fx.enabled })}
            data-testid={`sub-mix-bus-fx-modal-enabled-${bus.id}`}
            aria-pressed={fx.enabled}
            className={[
              "px-2 py-1 text-xs rounded border",
              fx.enabled
                ? "border-accent-primary bg-accent-primary/20 text-accent-primary"
                : "border-border-color text-text-muted hover:text-text-primary",
            ].join(" ")}
          >
            {fx.enabled ? "ENABLED" : "DISABLED"}
          </button>
        </div>

        {/* EQ-3 detail */}
        <section className="flex flex-col gap-1 border-t border-border-subtle pt-2">
          <h4 className="text-xs font-medium text-text-primary">EQ (3-Band)</h4>
          <FxModalSlider
            label="Low"
            min={-24} max={24} step={0.1}
            value={fx.eq3.lowGain}
            onChange={(v) => setBusEq3(bus.id, { lowGain: v })}
            format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)} dB`}
            testId={`sub-mix-bus-fx-modal-eq-low-${bus.id}`}
            onContextMenu={learnEqLow.onContextMenu}
            isMapped={learnEqLow.isMapped}
            mappedCC={learnEqLow.mappedCC}
            menu={learnEqLow.menu}
          />
          <FxModalSlider
            label="Mid"
            min={-24} max={24} step={0.1}
            value={fx.eq3.midGain}
            onChange={(v) => setBusEq3(bus.id, { midGain: v })}
            format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)} dB`}
            testId={`sub-mix-bus-fx-modal-eq-mid-${bus.id}`}
            onContextMenu={learnEqMid.onContextMenu}
            isMapped={learnEqMid.isMapped}
            mappedCC={learnEqMid.mappedCC}
            menu={learnEqMid.menu}
          />
          <FxModalSlider
            label="High"
            min={-24} max={24} step={0.1}
            value={fx.eq3.highGain}
            onChange={(v) => setBusEq3(bus.id, { highGain: v })}
            format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)} dB`}
            testId={`sub-mix-bus-fx-modal-eq-high-${bus.id}`}
            onContextMenu={learnEqHigh.onContextMenu}
            isMapped={learnEqHigh.isMapped}
            mappedCC={learnEqHigh.mappedCC}
            menu={learnEqHigh.menu}
          />
        </section>

        {/* Compressor detail */}
        <section className="flex flex-col gap-1 border-t border-border-subtle pt-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium text-text-primary">Compressor</h4>
            <button
              type="button"
              onClick={() => setBusCompressor(bus.id, { enabled: !fx.compressor.enabled })}
              data-testid={`sub-mix-bus-fx-modal-comp-enabled-${bus.id}`}
              aria-pressed={fx.compressor.enabled}
              className={[
                "px-2 py-0.5 text-xs rounded border",
                fx.compressor.enabled
                  ? "border-accent-success bg-accent-success/20 text-accent-success"
                  : "border-border-color text-text-muted hover:text-text-primary",
              ].join(" ")}
            >
              {fx.compressor.enabled ? "ON" : "OFF"}
            </button>
          </div>
          <FxModalSlider
            label="Threshold"
            min={-60} max={0} step={0.1}
            value={fx.compressor.threshold}
            onChange={(v) => setBusCompressor(bus.id, { threshold: v })}
            format={(v) => `${v.toFixed(1)} dB`}
            testId={`sub-mix-bus-fx-modal-comp-threshold-${bus.id}`}
            onContextMenu={learnCompThr.onContextMenu}
            isMapped={learnCompThr.isMapped}
            mappedCC={learnCompThr.mappedCC}
            menu={learnCompThr.menu}
          />
          <FxModalSlider
            label="Ratio"
            min={1} max={20} step={0.1}
            value={fx.compressor.ratio}
            onChange={(v) => setBusCompressor(bus.id, { ratio: v })}
            format={(v) => `${v.toFixed(1)}:1`}
            testId={`sub-mix-bus-fx-modal-comp-ratio-${bus.id}`}
            onContextMenu={learnCompRat.onContextMenu}
            isMapped={learnCompRat.isMapped}
            mappedCC={learnCompRat.mappedCC}
            menu={learnCompRat.menu}
          />
          <FxModalSlider
            label="Attack"
            min={0} max={1} step={0.001}
            value={fx.compressor.attack}
            onChange={(v) => setBusCompressor(bus.id, { attack: v })}
            format={(v) => `${(v * 1000).toFixed(0)} ms`}
            testId={`sub-mix-bus-fx-modal-comp-attack-${bus.id}`}
          />
          <FxModalSlider
            label="Release"
            min={0} max={1} step={0.005}
            value={fx.compressor.release}
            onChange={(v) => setBusCompressor(bus.id, { release: v })}
            format={(v) => `${(v * 1000).toFixed(0)} ms`}
            testId={`sub-mix-bus-fx-modal-comp-release-${bus.id}`}
          />
        </section>

        {/* Sends */}
        <section className="flex flex-col gap-1 border-t border-border-subtle pt-2">
          <h4 className="text-xs font-medium text-text-primary">Sends</h4>
          <FxModalSlider
            label="Reverb"
            min={0} max={1} step={0.01}
            value={fx.reverbSend}
            onChange={(v) => setBusReverbSend(bus.id, v)}
            format={(v) => `${(v * 100).toFixed(0)}%`}
            testId={`sub-mix-bus-fx-modal-reverb-send-${bus.id}`}
            onContextMenu={learnReverbSend.onContextMenu}
            isMapped={learnReverbSend.isMapped}
            mappedCC={learnReverbSend.mappedCC}
            menu={learnReverbSend.menu}
          />
          <FxModalSlider
            label="Delay"
            min={0} max={1} step={0.01}
            value={fx.delaySend}
            onChange={(v) => setBusDelaySend(bus.id, v)}
            format={(v) => `${(v * 100).toFixed(0)}%`}
            testId={`sub-mix-bus-fx-modal-delay-send-${bus.id}`}
            onContextMenu={learnDelaySend.onContextMenu}
            isMapped={learnDelaySend.isMapped}
            mappedCC={learnDelaySend.mappedCC}
            menu={learnDelaySend.menu}
          />
        </section>

        {/* v3.88.0: postGain (Post-Comp-Trim) — wirkt zwischen compMix und bus.gain. */}
        <section className="flex flex-col gap-1 border-t border-border-subtle pt-2">
          <h4 className="text-xs font-medium text-text-primary">Post-Comp Gain</h4>
          <FxModalSlider
            label="Trim"
            min={0} max={2} step={0.01}
            value={fx.postGain}
            onChange={(v) => setBusPostGain(bus.id, v)}
            format={(v) => `${v.toFixed(2)}×`}
            testId={`sub-mix-bus-fx-modal-post-gain-${bus.id}`}
          />
        </section>
      </div>
    </div>
  );
}

interface FxModalSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  testId: string;
  format: (v: number) => string;
  onChange: (v: number) => void;
  /** v3.88.0: optional Right-Click-MIDI-Learn-Handler (useMidiLearn). */
  onContextMenu?: (e: React.MouseEvent) => void;
  /** v3.88.0: optional — wenn true zeigt einen ·CC<n>-Badge im Label. */
  isMapped?: boolean;
  /** v3.88.0: optional CC# zum Badge-Render (nur sichtbar wenn isMapped). */
  mappedCC?: number | null;
  /** v3.88.0: optional ReactNode — Context-Menu vom useMidiLearn-Hook. */
  menu?: React.ReactNode;
}

function FxModalSlider({
  label, value, min, max, step, testId, format, onChange,
  onContextMenu, isMapped, mappedCC, menu,
}: FxModalSliderProps): React.ReactElement {
  return (
    <label className="flex items-center gap-2 text-xs relative">
      <span className="w-16 text-text-muted">
        {label}
        {isMapped && mappedCC != null && (
          <span
            className="ml-1 text-accent-secondary text-[9px] font-mono"
            data-testid={`${testId}-cc-badge`}
          >
            ·CC{mappedCC}
          </span>
        )}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onContextMenu={onContextMenu}
        data-testid={testId}
        className="flex-1 accent-accent-primary"
        title={onContextMenu ? `${format(value)} · Rechtsklick: MIDI-Learn${isMapped ? ` · CC${mappedCC}` : ""}` : format(value)}
      />
      <span className="w-16 text-right text-text-primary tabular-nums">{format(value)}</span>
      {menu}
    </label>
  );
}
