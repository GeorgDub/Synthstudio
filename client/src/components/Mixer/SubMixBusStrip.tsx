/**
 * Synthstudio – SubMixBusStrip.tsx (v3.81.0)
 *
 * Channel-Strip-Variante für einen Sub-Mix-Bus (Channel-Grouping mit
 * shared Volume/Pan/Mute/Solo). Closes v3.79.1 UI-Lücke: bisher gab es
 * den Store (v3.79.0) + Engine-Wiring (v3.79.1), aber keinen visuellen
 * Strip im MixerView.
 *
 * Layout (top → bottom):
 *   1. Color-Indicator (3px Strip oben, inline-style mit bus.color)
 *   2. Editable Bus-Name (Input mit onBlur → renameBus, maxLength 32)
 *   3. "Members: N" Counter
 *   4. Vertical Volume-Fader (0..2, mit dB-Anzeige)
 *   5. Pan-Slider (-1..+1)
 *   6. M / S Buttons (mute/solo)
 *   7. "× Remove" Button (mit Confirm wenn members > 0)
 *
 * Styling: ausschließlich semantische --ss-* Tokens. Layout-Breite analog
 * ChannelStrip (52px), Bus-Strips sitzen rechts neben den regulären
 * Channels und LINKS vom Master.
 *
 * v3.81.0:
 *   - Right-Click MIDI-Learn auf Volume/Pan/Mute/Solo via useMidiLearn-Hook
 *     (Targets: subMixBusVolume/Pan/Mute/Solo, gebridged in useMidiEventBridge).
 *   - Color-Picker (ChannelColorPicker) im oberen Color-Indicator. Klick auf
 *     den Indikator öffnet das 8-Swatch+Hex-Popover. Reset → undefined fällt
 *     auf BUS_COLOR_DEFAULTS-Palette zurück.
 */
import React, { useCallback, useState } from "react";
import {
  type SubMixBus,
  removeBus,
  renameBus,
  setBusVolume,
  setBusPan,
  setBusMute,
  setBusSolo,
  setBusColor,
} from "@/store/useSubMixStore";
import { useMidiLearn } from "@/hooks/useMidiLearn";
import { ChannelColorPicker } from "@/components/Mixer/ChannelColorPicker";

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

export function SubMixBusStrip({ bus, busIndex }: SubMixBusStripProps): React.ReactElement {
  const [editingName, setEditingName] = useState<string>(bus.name);

  // Lokaler Edit-State wird bei externer Mutation aufgefrischt (z.B. Project-
  // Load setzt einen neuen Namen). useState-init reicht nicht, daher manueller
  // sync via key-Vergleich.
  React.useEffect(() => {
    setEditingName(bus.name);
  }, [bus.name]);

  const memberCount = bus.channelIds.length;
  const resolvedColor = resolveBusColor(bus.color, busIndex);

  // v3.81.0: Right-Click MIDI-Learn auf Bus-Controls
  const volumeLearn = useMidiLearn({ type: "subMixBusVolume", busId: bus.id, busName: bus.name });
  const panLearn    = useMidiLearn({ type: "subMixBusPan",    busId: bus.id, busName: bus.name });
  const muteLearn   = useMidiLearn({ type: "subMixBusMute",   busId: bus.id, busName: bus.name });
  const soloLearn   = useMidiLearn({ type: "subMixBusSolo",   busId: bus.id, busName: bus.name });

  // v3.81.0: Color-Picker — onColorChange → setBusColor (undefined = reset).
  const handleColorChange = useCallback(
    (color: string | undefined) => {
      setBusColor(bus.id, color);
    },
    [bus.id],
  );

  const handleRemove = useCallback(() => {
    if (memberCount > 0) {
      // Confirm — Browser-native zur Vermeidung von Modal-State + Tests.
      const ok = typeof window !== "undefined" && typeof window.confirm === "function"
        ? window.confirm(
            `Bus "${bus.name}" hat ${memberCount} Mitglied${memberCount === 1 ? "" : "er"}. ` +
              `Channels fallen auf Master zurück. Trotzdem entfernen?`,
          )
        : true;
      if (!ok) return;
    }
    removeBus(bus.id);
  }, [bus.id, bus.name, memberCount]);

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
              : "bg-bg-elevated text-text-dim hover:bg-bg-elevated hover:text-accent-secondary",
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
              : "bg-bg-elevated text-text-dim hover:bg-bg-elevated hover:text-accent-success",
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
    </div>
  );
}
