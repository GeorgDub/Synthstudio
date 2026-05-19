/**
 * Synthstudio – SubMixBusStrip.tsx (v3.80.0)
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
 * Right-Click-MIDI-Learn ist v3.80.0 nicht supported — Sub-Mix-Bus-IDs
 * sind nicht in der MidiLearnTarget-Union (siehe useMidi.ts). Hinzufügen
 * in v3.81+ möglich, sobald `subMixBusVolume|Pan|Mute|Solo` Targets
 * eingeführt werden.
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
} from "@/store/useSubMixStore";

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

      {/* Vertical Fader (Volume 0..2) */}
      <div className="flex items-end gap-1 h-28">
        <input
          type="range"
          min={0}
          max={2}
          step={0.01}
          value={bus.volume}
          onChange={(e) => setBusVolume(bus.id, parseFloat(e.target.value))}
          data-testid={`sub-mix-bus-volume-${bus.id}`}
          aria-label={`Bus ${bus.name} volume`}
          className="h-28 w-3 accent-accent-primary cursor-pointer"
          style={{
            writingMode: "vertical-lr",
            direction: "rtl",
            appearance: "slider-vertical" as React.CSSProperties["appearance"],
          }}
          title={volToDb(bus.volume)}
        />
      </div>

      {/* dB-Anzeige */}
      <span className="text-[8px] text-text-dim font-mono">{volToDb(bus.volume)}</span>

      {/* Pan-Regler */}
      <div className="flex flex-col items-center gap-0.5 w-full">
        <span className="text-[8px] text-text-dim uppercase">Pan</span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={bus.pan}
          onChange={(e) => setBusPan(bus.id, parseFloat(e.target.value))}
          data-testid={`sub-mix-bus-pan-${bus.id}`}
          aria-label={`Bus ${bus.name} pan`}
          className="w-full accent-accent-primary cursor-pointer"
          title={bus.pan === 0 ? "Center" : bus.pan > 0 ? `R ${Math.round(bus.pan * 100)}` : `L ${Math.round(-bus.pan * 100)}`}
        />
        <span className="text-[8px] text-text-dim font-mono">
          {bus.pan === 0 ? "C" : bus.pan > 0 ? `R${Math.round(bus.pan * 100)}` : `L${Math.round(-bus.pan * 100)}`}
        </span>
      </div>

      {/* Mute / Solo */}
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => setBusMute(bus.id, !bus.mute)}
          data-testid={`sub-mix-bus-mute-${bus.id}`}
          aria-pressed={bus.mute}
          aria-label={`Bus ${bus.name} mute`}
          title="Mute Bus"
          className={[
            "w-6 h-5 rounded text-[8px] font-bold transition-colors duration-100",
            bus.mute
              ? "bg-accent-secondary text-bg-base"
              : "bg-bg-elevated text-text-dim hover:bg-bg-elevated hover:text-accent-secondary",
          ].join(" ")}
        >
          M
        </button>
        <button
          type="button"
          onClick={() => setBusSolo(bus.id, !bus.solo)}
          data-testid={`sub-mix-bus-solo-${bus.id}`}
          aria-pressed={bus.solo}
          aria-label={`Bus ${bus.name} solo`}
          title="Solo Bus"
          className={[
            "w-6 h-5 rounded text-[8px] font-bold transition-colors duration-100",
            bus.solo
              ? "bg-accent-success text-bg-base"
              : "bg-bg-elevated text-text-dim hover:bg-bg-elevated hover:text-accent-success",
          ].join(" ")}
        >
          S
        </button>
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
