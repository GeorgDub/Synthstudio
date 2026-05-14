/**
 * PerformanceRecorderBadge — kompakter Always-On-Overlay für den
 * v2.15-PerformanceRecorder. Vor v2.22 war der Store nur per
 * `window.dispatchEvent("perf:event", ...)` programmatisch fütterbar — es
 * gab kein UI, das die Aufnahme starten/stoppen oder die letzte Aufnahme
 * abspielen konnte. Dieser Badge schließt die User-Lücke ohne Tab-Refactor.
 *
 * Positionierung: fixed bottom-right. Klein im Idle, expandiert auf Klick
 * mit Sekundär-Actions (Playback, Export, Clear).
 */
import React, { useEffect, useRef, useState } from "react";
import {
  usePerformanceRecorder,
  startRecording,
  stopRecording,
  startPlayback,
  stopPlayback,
  clearRecording,
  exportRecording,
  importRecording,
  type PerfEvent,
} from "@/store/usePerformanceRecorder";
import { toast } from "@/store/useToastStore";

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function PerformanceRecorderBadge() {
  const state = usePerformanceRecorder();
  const [open, setOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  // Live-Tick während Aufnahme
  useEffect(() => {
    if (!state.isRecording) {
      startRef.current = null;
      setElapsed(0);
      return;
    }
    startRef.current = Date.now();
    const id = window.setInterval(() => {
      if (startRef.current !== null) setElapsed(Date.now() - startRef.current);
    }, 250);
    return () => window.clearInterval(id);
  }, [state.isRecording]);

  const handleRecToggle = () => {
    if (state.isRecording) {
      const rec = stopRecording();
      if (rec) {
        toast(`Aufnahme „${rec.name}" gestoppt (${rec.events.length} Events, ${formatMs(rec.durationMs)})`, { kind: "success" });
      }
    } else {
      startRecording();
      setOpen(true);
      toast("Performance-Aufnahme gestartet", { kind: "info" });
    }
  };

  const handlePlay = () => {
    if (state.isPlaying) {
      stopPlayback();
      return;
    }
    startPlayback((ev: PerfEvent) => {
      // Replay = dispatch des Events, damit die normalen Listener feuern.
      window.dispatchEvent(new CustomEvent("perf:replay", { detail: ev }));
    });
  };

  const handleExport = () => {
    const json = exportRecording();
    if (!json) {
      toast("Keine Aufnahme vorhanden", { kind: "error" });
      return;
    }
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    a.download = `synthstudio-performance-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Aufnahme als JSON exportiert", { kind: "success" });
  };

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const handleImport = async (file: File) => {
    const text = await file.text();
    const ok = importRecording(text);
    if (ok) {
      toast(`Aufnahme „${file.name}" importiert`, { kind: "success" });
      setOpen(true);
    } else {
      toast("Konnte JSON nicht als Performance-Aufnahme parsen", { kind: "error" });
    }
  };

  const handleClear = () => {
    if (!state.last && !state.isRecording) return;
    if (confirm("Aktuelle Aufnahme löschen?")) {
      clearRecording();
      toast("Aufnahme gelöscht", { kind: "info" });
    }
  };

  const recBtnClass = state.isRecording
    ? "bg-accent-danger text-white animate-pulse"
    : state.last
      ? "bg-bg-elevated text-text-muted hover:text-accent-danger border border-border-color"
      : "bg-bg-elevated text-text-dim hover:text-accent-danger border border-border-color";

  return (
    <div
      className="fixed bottom-3 right-3 z-30 flex items-end gap-2"
      data-testid="performance-recorder-badge"
    >
      {open && (
        <div className="rounded-lg border border-border-color bg-bg-panel shadow-lg p-2 flex items-center gap-2 text-xs">
          {state.last && (
            <button
              type="button"
              onClick={handlePlay}
              className={`px-2 py-1 rounded ${
                state.isPlaying
                  ? "bg-accent-primary text-bg-base"
                  : "bg-bg-elevated text-text-muted hover:text-accent-primary"
              }`}
              title={state.isPlaying ? "Wiedergabe stoppen" : "Aufnahme abspielen"}
              data-testid="perf-rec-play"
            >
              {state.isPlaying ? "⏹ Stop" : `▶ ${formatMs(state.last.durationMs)}`}
            </button>
          )}
          {state.last && (
            <button
              type="button"
              onClick={handleExport}
              className="px-2 py-1 rounded bg-bg-elevated text-text-muted hover:text-text-primary"
              title="Aufnahme als JSON herunterladen"
              data-testid="perf-rec-export"
            >
              ⇩ Export
            </button>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-2 py-1 rounded bg-bg-elevated text-text-muted hover:text-text-primary"
            title="JSON-Aufnahme aus Datei importieren"
            data-testid="perf-rec-import"
          >
            ⇧ Import
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) void handleImport(f);
              e.target.value = "";
            }}
            className="hidden"
            data-testid="perf-rec-import-input"
          />
          {(state.last || state.isRecording) && (
            <button
              type="button"
              onClick={handleClear}
              className="px-2 py-1 rounded text-text-dim hover:text-accent-danger"
              title="Aktuelle Aufnahme löschen"
              data-testid="perf-rec-clear"
            >
              ✕
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="px-1 py-1 rounded text-text-dim hover:text-text-primary"
            title="Schließen"
          >
            ‹
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          if (state.isRecording || state.last) {
            // Wenn aktive Aufnahme oder vorhandene Aufnahme: Badge ein-/ausklappen
            setOpen(o => !o);
          } else {
            // Sonst direkt Recording starten
            handleRecToggle();
          }
        }}
        onContextMenu={e => {
          e.preventDefault();
          handleRecToggle();
        }}
        className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors ${recBtnClass}`}
        title={
          state.isRecording
            ? `Aufnahme läuft (${state.current?.events.length ?? 0} Events) — Rechtsklick zum Stoppen`
            : state.last
              ? `Letzte Aufnahme: ${state.last.name} (${state.last.events.length} Events) — Klick zum Öffnen, Rechtsklick zum Neu-Aufnehmen`
              : "Performance-Aufnahme starten — Linksklick startet, Rechtsklick auch"
        }
        data-testid="perf-rec-toggle"
      >
        <span aria-hidden="true">●</span>
        <span>
          {state.isRecording
            ? `REC ${formatMs(elapsed)}`
            : state.last
              ? "Performance"
              : "Performance"}
        </span>
        {state.isRecording && state.current && (
          <span className="text-[10px] opacity-75">{state.current.events.length}</span>
        )}
      </button>
    </div>
  );
}
