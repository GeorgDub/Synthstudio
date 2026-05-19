/**
 * Synthstudio – ChannelColorPicker.tsx (v3.73.0)
 *
 * Kleiner Popover-Picker für das Channel-Strip Color-Coding.
 * - 8 Default-Farben (Palette)
 * - Custom-Hex-Input
 * - "Reset"-Button → undefined (fällt auf Palette-Default zurück)
 * - ESC + click-out schließen
 *
 * Wird verwendet im Mixer-ChannelStrip + im DrumMachine-ChannelStrip.
 * Trigger ist ein kleines color-Square — der Picker rendert sich darüber.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_CHANNEL_COLOR_PALETTE,
  isValidChannelColor,
  normalizeChannelColor,
  resolveChannelColor,
} from "@/utils/channelColors";

export interface ChannelColorPickerProps {
  /** Channel-Name (für Tooltip/Aria). */
  channelName: string;
  /** Aktuelle Color (undefined = Palette-Default). */
  color: string | undefined;
  /** Index des Channels für den Palette-Default-Fallback. */
  index: number;
  /** Callback bei Color-Auswahl. undefined = Reset auf Palette-Default. */
  onColorChange: (color: string | undefined) => void;
  /** Optional: Klassen für den Trigger-Button (Größen, Position). */
  className?: string;
  /** Optional: Test-ID-Prefix (Default: 'channel-color'). */
  testIdPrefix?: string;
}

export function ChannelColorPicker({
  channelName,
  color,
  index,
  onColorChange,
  className = "",
  testIdPrefix = "channel-color",
}: ChannelColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [hexInput, setHexInput] = useState<string>("");
  const containerRef = useRef<HTMLDivElement>(null);

  const effective = useMemo(() => resolveChannelColor(color, index), [color, index]);

  // Beim Öffnen den aktuellen Wert in den Hex-Input übernehmen
  useEffect(() => {
    if (open) setHexInput(effective);
  }, [open, effective]);

  // ESC + click-out
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDocClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [open]);

  const handleSelect = useCallback(
    (hex: string) => {
      onColorChange(hex);
      setOpen(false);
    },
    [onColorChange],
  );

  const handleHexCommit = useCallback(() => {
    const normalized = normalizeChannelColor(hexInput);
    if (normalized !== undefined) {
      onColorChange(normalized);
      setOpen(false);
    }
    // Invalider Hex → Input bleibt offen, User sieht den roten Border
  }, [hexInput, onColorChange]);

  const handleReset = useCallback(() => {
    onColorChange(undefined);
    setOpen(false);
  }, [onColorChange]);

  const hexIsValid = hexInput.length === 0 || isValidChannelColor(hexInput);

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      {/* Trigger: kleines Color-Square */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title={`Channel-Farbe: ${effective} (Click zum Ändern)`}
        aria-label={`Channel-Farbe für ${channelName}`}
        aria-expanded={open}
        data-testid={`${testIdPrefix}-trigger`}
        className="w-3 h-3 rounded-sm border border-border-color hover:scale-110 transition-transform cursor-pointer flex-shrink-0"
        style={{ backgroundColor: effective }}
      />

      {/* Popover */}
      {open && (
        <div
          className="absolute z-50 top-4 left-0 bg-bg-elevated border border-border-color rounded shadow-lg p-2 flex flex-col gap-2 min-w-[160px]"
          data-testid={`${testIdPrefix}-popover`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 8 Default-Farben — 4x2 Grid */}
          <div className="grid grid-cols-4 gap-1">
            {DEFAULT_CHANNEL_COLOR_PALETTE.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelect(p.hex)}
                title={p.name}
                aria-label={p.name}
                data-testid={`${testIdPrefix}-swatch-${p.id}`}
                className={`w-6 h-6 rounded-sm border transition-all ${
                  effective.toLowerCase() === p.hex.toLowerCase()
                    ? "border-text-primary scale-110"
                    : "border-border-color hover:scale-110"
                }`}
                style={{ backgroundColor: p.hex }}
              />
            ))}
          </div>

          {/* Custom-Hex-Input */}
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={hexInput}
              onChange={(e) => setHexInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleHexCommit();
                }
              }}
              placeholder="#RRGGBB"
              maxLength={7}
              data-testid={`${testIdPrefix}-hex-input`}
              className={`flex-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-base text-text-primary border ${
                hexIsValid ? "border-border-color" : "border-accent-danger"
              } focus:outline-none focus:border-accent-primary`}
            />
            <button
              type="button"
              onClick={handleHexCommit}
              disabled={!hexIsValid || hexInput.length === 0}
              data-testid={`${testIdPrefix}-hex-apply`}
              className="text-[10px] px-2 py-0.5 rounded bg-accent-primary text-bg-base hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              OK
            </button>
          </div>

          {/* Reset / Close */}
          <div className="flex items-center justify-between text-[9px]">
            <button
              type="button"
              onClick={handleReset}
              data-testid={`${testIdPrefix}-reset`}
              className="text-text-muted hover:text-accent-primary uppercase tracking-wide"
            >
              Auto
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              data-testid={`${testIdPrefix}-close`}
              className="text-text-dim hover:text-text-primary"
            >
              Schließen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
