/**
 * Synthstudio – SongTimeline Komponente
 *
 * Visueller Song-Modus Editor: Pattern-Chaining, Drag & Drop Reordering,
 * Loop-Modus, Mute-Funktion und Song-Arrangement.
 *
 * Features:
 * - Horizontale Timeline mit Pattern-Slots
 * - Drag & Drop zum Umordnen der Slots
 * - Klick auf Pattern-Bank zum Wechseln (A/B/C/D)
 * - Wiederholungs-Zähler (1–16x) per Klick
 * - Mute-Button pro Slot
 * - Song-Loop Toggle
 * - Schnell-Vorlagen (Intro-Verse-Chorus, etc.)
 */
import React, { useState, useRef, useCallback } from "react";
import type { SongSlot, PatternBank, SongState, SongActions } from "@/store/useSongStore";

// ─── Typen ────────────────────────────────────────────────────────────────────

interface SongTimelineProps {
  song: SongState & SongActions;
  isPlaying: boolean;
  className?: string;
}

// ─── Konstanten ───────────────────────────────────────────────────────────────

const BANK_COLORS: Record<PatternBank, string> = {
  A: "bg-cyan-600 border-cyan-400 text-white",
  B: "bg-violet-600 border-violet-400 text-white",
  C: "bg-emerald-600 border-emerald-400 text-white",
  D: "bg-amber-600 border-amber-400 text-white",
};

const BANK_COLORS_MUTED: Record<PatternBank, string> = {
  A: "bg-cyan-900/40 border-cyan-800 text-cyan-800",
  B: "bg-violet-900/40 border-violet-800 text-violet-800",
  C: "bg-emerald-900/40 border-emerald-800 text-emerald-800",
  D: "bg-amber-900/40 border-amber-800 text-amber-800",
};

const BANK_ACTIVE: Record<PatternBank, string> = {
  A: "ring-2 ring-cyan-300 shadow-lg shadow-cyan-500/30",
  B: "ring-2 ring-violet-300 shadow-lg shadow-violet-500/30",
  C: "ring-2 ring-emerald-300 shadow-lg shadow-emerald-500/30",
  D: "ring-2 ring-amber-300 shadow-lg shadow-amber-500/30",
};

const BANKS: PatternBank[] = ["A", "B", "C", "D"];

const QUICK_ARRANGEMENTS = [
  {
    label: "Techno",
    pattern: [
      { bank: "A" as PatternBank, repeats: 2 },
      { bank: "B" as PatternBank, repeats: 4 },
      { bank: "C" as PatternBank, repeats: 4 },
      { bank: "B" as PatternBank, repeats: 4 },
      { bank: "D" as PatternBank, repeats: 2 },
    ],
  },
  {
    label: "House",
    pattern: [
      { bank: "A" as PatternBank, repeats: 4 },
      { bank: "B" as PatternBank, repeats: 8 },
      { bank: "C" as PatternBank, repeats: 4 },
      { bank: "A" as PatternBank, repeats: 8 },
    ],
  },
  {
    label: "Hip-Hop",
    pattern: [
      { bank: "A" as PatternBank, repeats: 2 },
      { bank: "B" as PatternBank, repeats: 4 },
      { bank: "A" as PatternBank, repeats: 2 },
      { bank: "C" as PatternBank, repeats: 4 },
      { bank: "B" as PatternBank, repeats: 4 },
    ],
  },
];

// ─── Slot-Komponente ──────────────────────────────────────────────────────────

interface SlotProps {
  slot: SongSlot;
  index: number;
  isActive: boolean;
  onBankChange: (id: string, bank: PatternBank) => void;
  onRepeatsChange: (id: string, repeats: number) => void;
  onMuteToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onLabelChange: (id: string, label: string) => void;
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
  onDrop: () => void;
  isDragOver: boolean;
}

function SlotCard({
  slot,
  index,
  isActive,
  onBankChange,
  onRepeatsChange,
  onMuteToggle,
  onRemove,
  onLabelChange,
  onDragStart,
  onDragOver,
  onDrop,
  isDragOver,
}: SlotProps) {
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState(slot.label ?? "");

  const colorClass = slot.muted
    ? BANK_COLORS_MUTED[slot.bank]
    : BANK_COLORS[slot.bank];
  const activeClass = isActive ? BANK_ACTIVE[slot.bank] : "";

  const nextBank = (current: PatternBank): PatternBank => {
    const idx = BANKS.indexOf(current);
    return BANKS[(idx + 1) % BANKS.length];
  };

  const handleLabelBlur = () => {
    setEditingLabel(false);
    onLabelChange(slot.id, labelValue);
  };

  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(index); }}
      onDrop={onDrop}
      className={[
        "relative flex-shrink-0 w-20 rounded-lg border-2 p-2 cursor-grab select-none",
        "transition-all duration-150",
        colorClass,
        activeClass,
        isDragOver ? "scale-105 opacity-70" : "",
      ].join(" ")}
    >
      {/* Slot-Nummer */}
      <div className="absolute top-1 left-2 text-[9px] opacity-50 font-mono">
        {index + 1}
      </div>

      {/* Remove-Button */}
      <button
        onClick={() => onRemove(slot.id)}
        className="absolute top-1 right-1 w-4 h-4 rounded text-[10px] opacity-40 hover:opacity-100 hover:bg-black/30 transition-opacity"
        title="Slot entfernen"
      >
        ×
      </button>

      {/* Pattern-Bank (klickbar zum Wechseln) */}
      <button
        onClick={() => onBankChange(slot.id, nextBank(slot.bank))}
        className="w-full mt-3 text-2xl font-bold text-center hover:scale-110 transition-transform"
        title={`Bank wechseln (aktuell: ${slot.bank})`}
      >
        {slot.bank}
      </button>

      {/* Label */}
      <div className="mt-1 text-center">
        {editingLabel ? (
          <input
            autoFocus
            value={labelValue}
            onChange={(e) => setLabelValue(e.target.value)}
            onBlur={handleLabelBlur}
            onKeyDown={(e) => e.key === "Enter" && handleLabelBlur()}
            className="w-full text-[9px] bg-black/30 rounded px-1 text-center outline-none"
            maxLength={10}
          />
        ) : (
          <button
            onClick={() => setEditingLabel(true)}
            className="text-[9px] opacity-60 hover:opacity-100 truncate max-w-full"
            title="Label bearbeiten"
          >
            {slot.label || "—"}
          </button>
        )}
      </div>

      {/* Wiederholungen */}
      <div className="mt-1 flex items-center justify-center gap-1">
        <button
          onClick={() => onRepeatsChange(slot.id, slot.repeats - 1)}
          disabled={slot.repeats <= 1}
          className="w-4 h-4 rounded text-[10px] bg-black/20 hover:bg-black/40 disabled:opacity-20"
        >
          −
        </button>
        <span className="text-xs font-mono font-bold w-4 text-center">
          {slot.repeats}
        </span>
        <button
          onClick={() => onRepeatsChange(slot.id, slot.repeats + 1)}
          disabled={slot.repeats >= 16}
          className="w-4 h-4 rounded text-[10px] bg-black/20 hover:bg-black/40 disabled:opacity-20"
        >
          +
        </button>
      </div>

      {/* Mute-Button */}
      <button
        onClick={() => onMuteToggle(slot.id)}
        className={[
          "mt-1 w-full text-[9px] rounded py-0.5 transition-colors",
          slot.muted
            ? "bg-black/40 text-white/40"
            : "bg-black/20 hover:bg-black/30 opacity-60 hover:opacity-100",
        ].join(" ")}
        title={slot.muted ? "Unmute" : "Mute"}
      >
        {slot.muted ? "MUTED" : "LIVE"}
      </button>
    </div>
  );
}

// ─── Haupt-Komponente ─────────────────────────────────────────────────────────

export function SongTimeline({ song, isPlaying, className = "" }: SongTimelineProps) {
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleDragStart = useCallback((index: number) => {
    setDragFromIndex(index);
  }, []);

  const handleDragOver = useCallback((index: number) => {
    setDragOverIndex(index);
  }, []);

  const handleDrop = useCallback(() => {
    if (dragFromIndex !== null && dragOverIndex !== null && dragFromIndex !== dragOverIndex) {
      song.moveSlot(dragFromIndex, dragOverIndex);
    }
    setDragFromIndex(null);
    setDragOverIndex(null);
  }, [dragFromIndex, dragOverIndex, song]);

  const handleAddSlot = useCallback(() => {
    const lastBank = song.slots.length > 0
      ? song.slots[song.slots.length - 1].bank
      : "A";
    const nextBank = BANKS[(BANKS.indexOf(lastBank) + 1) % BANKS.length];
    song.addSlot(nextBank, 2);
  }, [song]);

  // Gesamtdauer in Takten berechnen
  const totalBars = song.slots.reduce((sum, s) => sum + s.repeats, 0);

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-3 px-1">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
          Song-Modus
        </span>

        {/* Song-Modus Toggle */}
        <button
          onClick={song.toggleSongMode}
          className={[
            "px-2 py-0.5 rounded text-[10px] font-bold transition-colors",
            song.songModeActive
              ? "bg-cyan-600 text-white"
              : "bg-slate-700 text-slate-400 hover:bg-slate-600",
          ].join(" ")}
          title="Song-Modus ein/ausschalten"
        >
          {song.songModeActive ? "SONG" : "PATTERN"}
        </button>

        {/* Loop Toggle */}
        <button
          onClick={song.toggleLoopSong}
          className={[
            "px-2 py-0.5 rounded text-[10px] transition-colors",
            song.loopSong
              ? "bg-violet-600 text-white"
              : "bg-slate-700 text-slate-400 hover:bg-slate-600",
          ].join(" ")}
          title="Song-Loop ein/ausschalten"
        >
          ↻ LOOP
        </button>

        {/* Statistiken */}
        <span className="text-[10px] text-slate-600 ml-auto">
          {song.slots.length} Slots · {totalBars} Takte
        </span>

        {/* Schnell-Arrangements */}
        <div className="flex gap-1">
          {QUICK_ARRANGEMENTS.map((arr) => (
            <button
              key={arr.label}
              onClick={() => song.createArrangement(arr.pattern)}
              className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-500 hover:bg-slate-700 hover:text-slate-300 transition-colors"
              title={`${arr.label}-Arrangement laden`}
            >
              {arr.label}
            </button>
          ))}
        </div>

        {/* Clear */}
        <button
          onClick={song.clearSong}
          className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-600 hover:bg-red-900/40 hover:text-red-400 transition-colors"
          title="Song leeren"
        >
          Leeren
        </button>
      </div>

      {/* Timeline */}
      <div
        ref={scrollRef}
        className="flex items-start gap-2 overflow-x-auto pb-2 min-h-[120px] px-1"
        style={{ scrollbarWidth: "thin", scrollbarColor: "#334155 transparent" }}
      >
        {song.slots.map((slot, index) => (
          <SlotCard
            key={slot.id}
            slot={slot}
            index={index}
            isActive={isPlaying && song.currentSlotIndex === index}
            onBankChange={(id, bank) => song.updateSlot(id, { bank })}
            onRepeatsChange={(id, repeats) => song.updateSlot(id, { repeats })}
            onMuteToggle={(id) =>
              song.updateSlot(id, {
                muted: !song.slots.find((s) => s.id === id)?.muted,
              })
            }
            onRemove={song.removeSlot}
            onLabelChange={(id, label) => song.updateSlot(id, { label })}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            isDragOver={dragOverIndex === index && dragFromIndex !== index}
          />
        ))}

        {/* Slot hinzufügen */}
        <button
          onClick={handleAddSlot}
          className={[
            "flex-shrink-0 w-20 h-[108px] rounded-lg border-2 border-dashed",
            "border-slate-700 text-slate-600 hover:border-slate-500 hover:text-slate-400",
            "flex flex-col items-center justify-center gap-1 transition-colors",
          ].join(" ")}
          title="Slot hinzufügen"
        >
          <span className="text-2xl">+</span>
          <span className="text-[9px]">Slot</span>
        </button>

        {/* Leerer Zustand */}
        {song.slots.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-slate-700 text-xs">
            Klicke auf + um Patterns zum Song hinzuzufügen
          </div>
        )}
      </div>

      {/* Fortschrittsbalken (während Wiedergabe) */}
      {isPlaying && song.songModeActive && song.slots.length > 0 && (
        <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-cyan-500 transition-all duration-300"
            style={{
              width: `${
                song.currentSlotIndex >= 0
                  ? ((song.currentSlotIndex + song.currentRepeat / (song.slots[song.currentSlotIndex]?.repeats ?? 1)) /
                      song.slots.length) *
                    100
                  : 0
              }%`,
            }}
          />
        </div>
      )}
    </div>
  );
}
