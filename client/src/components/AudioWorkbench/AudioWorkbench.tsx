/**
 * Synthstudio – AudioWorkbench
 *
 * Audacity-ähnliches Audio-Bearbeitungs-Panel:
 *   1. Datei importieren (Drag & Drop oder Datei-Picker)
 *   2. Mikrofon aufnehmen
 *   3. Waveform-Vorschau
 *   4. Frequenzband-Stem-Separation via OfflineAudioContext
 *      - Sub-Bass  < 80 Hz  (Kick-Fundament)
 *      - Bass      80–250 Hz
 *      - Mid       250–4 kHz
 *      - High      > 4 kHz  (Hi-Hats, Luft)
 *   5. Jeden Stem als neues Sample im Projekt speichern
 */
import React, { useCallback, useRef, useState } from "react";
import { useAudioInput } from "@/hooks/useAudioInput";
import type { Sample } from "@/store/useProjectStore";
import {
  trimBuffer, reverseBuffer, normalizeBuffer,
  fadeIn, fadeOut, applyGain, getPeak, getRms, cutSelection,
} from "@/utils/audioEdit";

// ─── Typen ────────────────────────────────────────────────────────────────────

interface StemResult {
  name: string;
  url: string;
  color: string;
  freq: string;
  duration: number;
}

interface WaveformCanvasProps {
  buffer: AudioBuffer | null;
  selectionStart?: number | null; // in seconds
  selectionEnd?: number | null;   // in seconds
  onSelect?: (startSec: number, endSec: number) => void;
  onClearSelection?: () => void;
}

// ─── Waveform Canvas ─────────────────────────────────────────────────────────

function WaveformCanvas({
  buffer,
  selectionStart = null,
  selectionEnd = null,
  onSelect,
  onClearSelection,
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ startX: number; startSec: number } | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !buffer) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const data = buffer.getChannelData(0);
    const step = Math.ceil(data.length / W);
    const amp = H / 2;

    // BUG-011 Fix: Canvas 2D unterstützt KEINE CSS-Variablen — wir müssen
    // die Tokens via getComputedStyle aus document.documentElement auflösen.
    // Frühere Version `ctx.fillStyle = "var(--ss-bg-elevated, #1a1a2e)"`
    // wurde von Chromium als ungültige Farbe ignoriert → schwarze Linie
    // auf schwarzem Hintergrund → komplett unsichtbar.
    const rootStyle = getComputedStyle(document.documentElement);
    const bgColor = rootStyle.getPropertyValue("--ss-bg-elevated").trim() || "#1a1a2e";
    const accentColor = rootStyle.getPropertyValue("--ss-accent-primary").trim() || "#7c3aed";
    const accentSecondary = rootStyle.getPropertyValue("--ss-accent-secondary").trim() || "#06b6d4";

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, W, H);

    // Selection overlay (hinter waveform)
    if (
      selectionStart !== null && selectionEnd !== null &&
      selectionEnd > selectionStart && buffer.duration > 0
    ) {
      const x0 = Math.max(0, (selectionStart / buffer.duration) * W);
      const x1 = Math.min(W, (selectionEnd   / buffer.duration) * W);
      ctx.fillStyle = `${accentSecondary}33`;
      ctx.fillRect(x0, 0, x1 - x0, H);
      ctx.strokeStyle = accentSecondary;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0 + 0.5, 0); ctx.lineTo(x0 + 0.5, H);
      ctx.moveTo(x1 - 0.5, 0); ctx.lineTo(x1 - 0.5, H);
      ctx.stroke();
    }

    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let x = 0; x < W; x++) {
      let min = 1, max = -1;
      for (let j = 0; j < step; j++) {
        const v = data[x * step + j] ?? 0;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      ctx.moveTo(x, amp + min * amp);
      ctx.lineTo(x, amp + max * amp);
    }
    ctx.stroke();
  }, [buffer, selectionStart, selectionEnd]);

  const xToSeconds = useCallback((clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas || !buffer) return 0;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * buffer.duration;
  }, [buffer]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!buffer || !onSelect) return;
    const sec = xToSeconds(e.clientX);
    dragRef.current = { startX: e.clientX, startSec: sec };
    onSelect(sec, sec);
    e.preventDefault();
  }, [buffer, onSelect, xToSeconds]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current || !onSelect) return;
    const sec = xToSeconds(e.clientX);
    const { startSec } = dragRef.current;
    const lo = Math.min(startSec, sec);
    const hi = Math.max(startSec, sec);
    onSelect(lo, hi);
  }, [onSelect, xToSeconds]);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={80}
      className="w-full rounded border border-border-color cursor-crosshair"
      style={{ background: "var(--ss-bg-elevated)" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDoubleClick={() => onClearSelection?.()}
      title="Drag = Bereich auswählen · Doppelklick = Auswahl löschen"
    />
  );
}

// ─── Stem Separation via OfflineAudioContext ──────────────────────────────────

interface BandDef {
  name: string;
  color: string;
  freq: string;
  lo: number;
  hi: number;
}

const BANDS: BandDef[] = [
  { name: "Sub-Bass",  color: "#a855f7", freq: "< 80 Hz",      lo: 20,   hi: 80   },
  { name: "Bass",      color: "#f59e0b", freq: "80–250 Hz",    lo: 80,   hi: 250  },
  { name: "Mid",       color: "#10b981", freq: "250–4000 Hz",  lo: 250,  hi: 4000 },
  { name: "High",      color: "#06b6d4", freq: "> 4000 Hz",    lo: 4000, hi: 20000 },
];

async function separateStems(buffer: AudioBuffer): Promise<StemResult[]> {
  const results: StemResult[] = [];

  for (const band of BANDS) {
    const ctx = new OfflineAudioContext(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate,
    );

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    // Bandpass via zwei aufeinanderfolgenden Biquad-Filtern
    const hiPass = ctx.createBiquadFilter();
    hiPass.type = "highpass";
    hiPass.frequency.value = band.lo;
    hiPass.Q.value = 0.7;

    const loPass = ctx.createBiquadFilter();
    loPass.type = "lowpass";
    loPass.frequency.value = band.hi;
    loPass.Q.value = 0.7;

    src.connect(hiPass);
    hiPass.connect(loPass);
    loPass.connect(ctx.destination);
    src.start(0);

    const rendered = await ctx.startRendering();

    // Zu Blob/URL konvertieren
    const url = audioBufferToUrl(rendered);
    results.push({
      name: band.name,
      url,
      color: band.color,
      freq: band.freq,
      duration: rendered.duration,
    });
  }

  return results;
}

/** AudioBuffer → WAV Blob-URL */
function audioBufferToUrl(buffer: AudioBuffer): string {
  const numCh = buffer.numberOfChannels;
  const length = buffer.length;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = 2;
  const dataLength = length * numCh * bytesPerSample;
  const ab = new ArrayBuffer(44 + dataLength);
  const view = new DataView(ab);

  const writeStr = (offset: number, s: string) =>
    s.split("").forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numCh * bytesPerSample, true);
  view.setUint16(32, numCh * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
      offset += 2;
    }
  }

  return URL.createObjectURL(new Blob([ab], { type: "audio/wav" }));
}

// ─── Hauptkomponente ──────────────────────────────────────────────────────────

interface AudioWorkbenchProps {
  onSamplesAdded: (samples: Sample[]) => void;
}

const MAX_UNDO_STEPS = 10;

export function AudioWorkbench({ onSamplesAdded }: AudioWorkbenchProps) {
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [stems, setStems] = useState<StemResult[]>([]);
  const [processing, setProcessing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Undo-Stack — speichert die letzten N AudioBuffers vor jedem applyEdit
  const [undoStack, setUndoStack] = useState<AudioBuffer[]>([]);

  type EditMode = "none" | "trim" | "normalize";
  const [editMode, setEditMode] = useState<EditMode>("none");
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [normalizeDb, setNormalizeDb] = useState(0); // 0 dB = -0 dB FS Peak

  // Playback-State (Buffer-Vorschau)
  const [isPlaying, setIsPlaying] = useState(false);
  const playbackRef = useRef<{ ctx: AudioContext; src: AudioBufferSourceNode } | null>(null);

  const stopPlayback = useCallback(() => {
    if (playbackRef.current) {
      try { playbackRef.current.src.stop(); } catch { /* already stopped */ }
      try { void playbackRef.current.ctx.close(); } catch { /* ignore */ }
      playbackRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const startPlayback = useCallback(() => {
    if (!buffer) return;
    stopPlayback();
    const ctx = new AudioContext();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.onended = () => {
      // Race-safe: nur stoppen wenn DIESE source noch aktiv ist
      if (playbackRef.current?.src === src) stopPlayback();
    };
    src.start(0);
    playbackRef.current = { ctx, src };
    setIsPlaying(true);
  }, [buffer, stopPlayback]);

  // Cleanup beim Unmount + bei Buffer-Wechsel
  React.useEffect(() => {
    return () => stopPlayback();
  }, [stopPlayback]);
  React.useEffect(() => {
    stopPlayback();
  }, [buffer, stopPlayback]);

  // Waveform-Bereichsauswahl (drag-to-select)
  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd, setSelEnd] = useState<number | null>(null);
  const handleCanvasSelect = useCallback((s: number, e: number) => {
    setSelStart(s);
    setSelEnd(e);
  }, []);
  const handleCanvasClear = useCallback(() => {
    setSelStart(null);
    setSelEnd(null);
  }, []);

  const loadFile = useCallback(async (file: File) => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const ctx = new AudioContext();
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      setBuffer(decoded);
      setFileName(file.name);
      setStems([]);
      setUndoStack([]); // Neuer Buffer → History zurücksetzen
    } catch (err) {
      console.error("Audio-Datei konnte nicht geladen werden:", err);
    }
  }, []);

  const { start: startRec, stop: stopRec, isRecording, isAvailable, level } = useAudioInput({
    onSample: async (url, name) => {
      try {
        const resp = await fetch(url);
        const ab = await resp.arrayBuffer();
        const ctx = new AudioContext();
        const decoded = await ctx.decodeAudioData(ab);
        setBuffer(decoded);
        setFileName(name);
        setStems([]);
      } catch { /* ignore */ }
    },
  });

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("audio/")) loadFile(file);
  }, [loadFile]);

  // ── Audacity-Level Edit-Tools ────────────────────────────────────────────

  const applyEdit = useCallback((edit: (b: AudioBuffer) => AudioBuffer) => {
    if (!buffer) return;
    setUndoStack(s => [...s, buffer].slice(-MAX_UNDO_STEPS));
    setBuffer(edit(buffer));
    setStems([]); // Stems invalidieren
  }, [buffer]);

  const handleUndo = useCallback(() => {
    setUndoStack(s => {
      if (s.length === 0) return s;
      const prev = s[s.length - 1];
      setBuffer(prev);
      setStems([]);
      setSelStart(null);
      setSelEnd(null);
      return s.slice(0, -1);
    });
  }, []);

  // Keyboard-Shortcut: Ctrl+Z für Undo
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        if (undoStack.length > 0) {
          e.preventDefault();
          handleUndo();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undoStack.length, handleUndo]);

  const handleReverse    = useCallback(() => buffer && applyEdit(() => reverseBuffer(new AudioContext(), buffer)), [buffer, applyEdit]);
  const handleFadeIn     = useCallback(() => buffer && applyEdit(() => fadeIn(new AudioContext(), buffer, 0.5)), [buffer, applyEdit]);
  const handleFadeOut    = useCallback(() => buffer && applyEdit(() => fadeOut(new AudioContext(), buffer, 0.5)), [buffer, applyEdit]);
  const handleHalfGain   = useCallback(() => buffer && applyEdit(() => applyGain(new AudioContext(), buffer, 0.5)), [buffer, applyEdit]);
  const handleDoubleGain = useCallback(() => buffer && applyEdit(() => applyGain(new AudioContext(), buffer, 2.0)), [buffer, applyEdit]);

  // Cut: entfernt die ausgewählte Region (selStart..selEnd) aus dem Buffer.
  // Anders als Trim, das die Auswahl BEHÄLT — Cut entfernt sie.
  const handleCut = useCallback(() => {
    if (!buffer) return;
    if (selStart === null || selEnd === null || selEnd <= selStart) return;
    applyEdit(() => cutSelection(new AudioContext(), buffer, selStart, selEnd).remainder);
    setSelStart(null);
    setSelEnd(null);
  }, [buffer, applyEdit, selStart, selEnd]);

  const openTrim = useCallback(() => {
    if (!buffer) return;
    // Pre-fill aus Waveform-Selection, falls vorhanden
    if (selStart !== null && selEnd !== null && selEnd > selStart) {
      setTrimStart(selStart);
      setTrimEnd(selEnd);
    } else {
      setTrimStart(0);
      setTrimEnd(buffer.duration);
    }
    setEditMode("trim");
  }, [buffer, selStart, selEnd]);

  const openNormalize = useCallback(() => {
    if (!buffer) return;
    setNormalizeDb(0);
    setEditMode("normalize");
  }, [buffer]);

  const applyTrim = useCallback(() => {
    if (!buffer) return;
    if (trimEnd <= trimStart) return;
    applyEdit(() => trimBuffer(new AudioContext(), buffer, trimStart, trimEnd));
    setEditMode("none");
    // Auswahl zurücksetzen, weil die Buffer-Dauer sich verändert hat
    setSelStart(null);
    setSelEnd(null);
  }, [buffer, applyEdit, trimStart, trimEnd]);

  const applyNormalize = useCallback(() => {
    if (!buffer) return;
    const targetPeak = Math.pow(10, normalizeDb / 20);
    applyEdit(() => normalizeBuffer(new AudioContext(), buffer, targetPeak));
    setEditMode("none");
  }, [buffer, applyEdit, normalizeDb]);

  const handleSeparate = useCallback(async () => {
    if (!buffer) return;
    setProcessing(true);
    try {
      const result = await separateStems(buffer);
      setStems(result);
    } finally {
      setProcessing(false);
    }
  }, [buffer]);

  const handleAddStem = useCallback((stem: StemResult) => {
    const sample: Sample = {
      id: `stem-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      name: `${fileName?.replace(/\.[^.]+$/, "") ?? "Sample"} – ${stem.name}`,
      path: stem.url,
      category: "Stem",
      tags: ["stem", stem.name.toLowerCase()],
      size: 0,
    };
    onSamplesAdded([sample]);
  }, [fileName, onSamplesAdded]);

  const handleAddAll = useCallback(() => {
    const samples: Sample[] = stems.map(stem => ({
      id: `stem-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      name: `${fileName?.replace(/\.[^.]+$/, "") ?? "Sample"} – ${stem.name}`,
      path: stem.url,
      category: "Stem",
      tags: ["stem", stem.name.toLowerCase()],
      size: 0,
    }));
    onSamplesAdded(samples);
  }, [fileName, stems, onSamplesAdded]);

  return (
    <div className="flex flex-col gap-4 p-4 max-w-2xl">
      {/* Header */}
      <div>
        <h3 className="text-sm font-bold text-text-primary">Audio Workbench</h3>
        <p className="text-[10px] text-text-dim mt-0.5">
          Audio importieren, aufnehmen und in Frequenz-Stems aufteilen
        </p>
      </div>

      {/* Import-Bereich */}
      <div
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        className={[
          "border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer",
          dragOver
            ? "border-accent-primary bg-accent-primary/10"
            : "border-border-color hover:border-accent-secondary/50",
        ].join(" ")}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) loadFile(file);
          }}
        />
        <div className="text-2xl mb-2">🎵</div>
        <p className="text-xs text-text-muted">
          {buffer
            ? <><span className="text-accent-primary font-bold">{fileName}</span> geladen</>
            : "Audio-Datei hierher ziehen oder klicken zum Auswählen"}
        </p>
        {buffer && (
          <p className="text-[10px] text-text-dim mt-1">
            {buffer.duration.toFixed(2)}s · {buffer.numberOfChannels}ch · {buffer.sampleRate}Hz
          </p>
        )}
      </div>

      {/* Mikrofon-Aufnahme */}
      {isAvailable && (
        <div className="flex items-center gap-3">
          <button
            onClick={isRecording ? stopRec : startRec}
            className={[
              "flex items-center gap-2 px-4 py-2 rounded text-xs font-bold transition-colors",
              isRecording
                ? "bg-accent-danger text-white animate-pulse"
                : "bg-bg-elevated border border-border-color text-text-muted hover:text-accent-danger",
            ].join(" ")}
          >
            {isRecording ? "■ Stop" : "● Aufnehmen"}
          </button>
          {isRecording && (
            <div className="flex items-center gap-0.5 h-4">
              {Array.from({ length: 16 }, (_, i) => (
                <div
                  key={i}
                  className="w-1.5 rounded-sm transition-all"
                  style={{
                    height: level > (i + 1) / 16 ? "100%" : "20%",
                    background: i >= 14 ? "#ef4444" : i >= 11 ? "#f59e0b" : "var(--ss-accent-success)",
                    opacity: level > (i + 1) / 16 ? 1 : 0.3,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Waveform */}
      {buffer && (
        <>
          <WaveformCanvas
            buffer={buffer}
            selectionStart={selStart}
            selectionEnd={selEnd}
            onSelect={handleCanvasSelect}
            onClearSelection={handleCanvasClear}
          />
          {selStart !== null && selEnd !== null && selEnd > selStart && (
            <div className="flex items-center justify-between text-[10px] text-text-dim font-mono px-1 -mt-2">
              <span>
                Auswahl: <span className="text-accent-secondary">{selStart.toFixed(2)}s – {selEnd.toFixed(2)}s</span>
                <span className="text-text-muted"> ({(selEnd - selStart).toFixed(2)}s)</span>
              </span>
              <button
                onClick={handleCanvasClear}
                className="text-text-muted hover:text-text-primary underline"
              >
                Auswahl löschen
              </button>
            </div>
          )}

          {/* ── Playback-Toolbar ──────────────────────────────────────────── */}
          <div className="flex items-center gap-1.5 p-2 bg-bg-elevated rounded-lg">
            <span className="text-[10px] text-text-dim self-center mr-1 uppercase tracking-wider">Vorschau:</span>
            <button
              onClick={isPlaying ? stopPlayback : startPlayback}
              title={isPlaying ? "Wiedergabe stoppen" : "Buffer abspielen"}
              className={`px-3 py-1 text-[10px] rounded font-bold transition-colors ${
                isPlaying
                  ? "bg-accent-danger text-white animate-pulse"
                  : "bg-accent-primary text-white hover:opacity-90"
              }`}
            >
              {isPlaying ? "■ Stop" : "▶ Play"}
            </button>
          </div>

          {/* ── Audacity-Style Edit-Toolbar ──────────────────────────────── */}
          <div className="flex flex-wrap gap-1.5 p-2 bg-bg-elevated rounded-lg">
            <span className="text-[10px] text-text-dim self-center mr-1 uppercase tracking-wider">Edit:</span>
            <button
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              title="Letzte Aktion zurücknehmen (Ctrl+Z)"
              className="px-2 py-1 text-[10px] rounded bg-bg-panel border border-border-color text-text-primary hover:border-accent-primary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ⟲ Undo{undoStack.length > 0 && <span className="ml-1 text-text-dim">({undoStack.length})</span>}
            </button>
            <button onClick={openTrim}          className={`px-2 py-1 text-[10px] rounded bg-bg-panel border text-text-primary hover:border-accent-primary ${editMode==="trim" ? "border-accent-primary" : "border-border-color"}`}>✂ Trim</button>
            <button
              onClick={handleCut}
              disabled={selStart === null || selEnd === null || (selEnd ?? 0) <= (selStart ?? 0)}
              title="Markierte Region aus Buffer entfernen"
              className="px-2 py-1 text-[10px] rounded bg-bg-panel border border-border-color text-text-primary hover:border-accent-primary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ✕ Cut
            </button>
            <button onClick={handleReverse}     className="px-2 py-1 text-[10px] rounded bg-bg-panel border border-border-color text-text-primary hover:border-accent-primary">↩ Reverse</button>
            <button onClick={openNormalize}     className={`px-2 py-1 text-[10px] rounded bg-bg-panel border text-text-primary hover:border-accent-primary ${editMode==="normalize" ? "border-accent-primary" : "border-border-color"}`}>📈 Normalize…</button>
            <button onClick={handleFadeIn}      className="px-2 py-1 text-[10px] rounded bg-bg-panel border border-border-color text-text-primary hover:border-accent-primary">↗ Fade In</button>
            <button onClick={handleFadeOut}     className="px-2 py-1 text-[10px] rounded bg-bg-panel border border-border-color text-text-primary hover:border-accent-primary">↘ Fade Out</button>
            <button onClick={handleHalfGain}    className="px-2 py-1 text-[10px] rounded bg-bg-panel border border-border-color text-text-primary hover:border-accent-primary">−6 dB</button>
            <button onClick={handleDoubleGain}  className="px-2 py-1 text-[10px] rounded bg-bg-panel border border-border-color text-text-primary hover:border-accent-primary">+6 dB</button>
            <button
              onClick={() => {
                if (!buffer || !fileName) return;
                const sample: Sample = {
                  id: `edit-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                  name: `${fileName.replace(/\.[^.]+$/, "")} (bearbeitet)`,
                  path: audioBufferToUrl(buffer),
                  category: "Edited",
                  tags: ["bearbeitet"],
                  size: 0,
                };
                onSamplesAdded([sample]);
              }}
              className="ml-auto px-3 py-1 text-[10px] rounded bg-accent-success text-white hover:opacity-90 font-bold"
              title="Bearbeiteten Buffer als Sample exportieren"
            >
              💾 Als Sample exportieren
            </button>
          </div>

          {/* ── Trim-Panel ──────────────────────────────────────────────── */}
          {editMode === "trim" && (
            <div className="p-3 bg-bg-elevated rounded-lg border border-accent-primary/40 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-accent-primary">✂ Trim</span>
                <span className="text-[10px] text-text-dim font-mono">
                  Auswahl: {(trimEnd - trimStart).toFixed(2)}s
                </span>
              </div>

              {/* Visual range bar */}
              <div className="relative h-2 bg-bg-panel rounded">
                <div
                  className="absolute h-full bg-accent-primary/30 rounded"
                  style={{
                    left:  `${(trimStart / buffer.duration) * 100}%`,
                    right: `${100 - (trimEnd / buffer.duration) * 100}%`,
                  }}
                />
              </div>

              <div className="flex items-center gap-3">
                <label className="text-[10px] text-text-muted flex-1">
                  Start (s)
                  <input
                    type="number"
                    min={0}
                    max={buffer.duration}
                    step={0.01}
                    value={trimStart.toFixed(3)}
                    onChange={e => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v)) setTrimStart(Math.max(0, Math.min(trimEnd - 0.001, v)));
                    }}
                    className="w-full mt-0.5 px-2 py-1 text-xs rounded bg-bg-base border border-border-color text-text-primary font-mono"
                  />
                  <input
                    type="range"
                    min={0}
                    max={buffer.duration}
                    step={0.001}
                    value={trimStart}
                    onChange={e => {
                      const v = parseFloat(e.target.value);
                      setTrimStart(Math.max(0, Math.min(trimEnd - 0.001, v)));
                    }}
                    className="w-full mt-1"
                  />
                </label>
                <label className="text-[10px] text-text-muted flex-1">
                  Ende (s)
                  <input
                    type="number"
                    min={0}
                    max={buffer.duration}
                    step={0.01}
                    value={trimEnd.toFixed(3)}
                    onChange={e => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v)) setTrimEnd(Math.max(trimStart + 0.001, Math.min(buffer.duration, v)));
                    }}
                    className="w-full mt-0.5 px-2 py-1 text-xs rounded bg-bg-base border border-border-color text-text-primary font-mono"
                  />
                  <input
                    type="range"
                    min={0}
                    max={buffer.duration}
                    step={0.001}
                    value={trimEnd}
                    onChange={e => {
                      const v = parseFloat(e.target.value);
                      setTrimEnd(Math.max(trimStart + 0.001, Math.min(buffer.duration, v)));
                    }}
                    className="w-full mt-1"
                  />
                </label>
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setEditMode("none")}
                  className="px-3 py-1 text-[10px] rounded bg-bg-panel border border-border-color text-text-muted hover:text-text-primary"
                >
                  Abbrechen
                </button>
                <button
                  onClick={applyTrim}
                  disabled={trimEnd <= trimStart}
                  className="px-3 py-1 text-[10px] rounded bg-accent-primary text-white font-bold disabled:opacity-50"
                >
                  Trim anwenden
                </button>
              </div>
            </div>
          )}

          {/* ── Normalize-Panel ────────────────────────────────────────── */}
          {editMode === "normalize" && (
            <div className="p-3 bg-bg-elevated rounded-lg border border-accent-primary/40 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-accent-primary">📈 Normalize</span>
                <span className="text-[10px] text-text-dim font-mono">
                  Aktuell Peak: {(20 * Math.log10(Math.max(getPeak(buffer), 1e-6))).toFixed(1)} dB
                </span>
              </div>

              <div className="flex items-center gap-3">
                <label className="text-[10px] text-text-muted flex-1">
                  Ziel-Peak: <span className="text-text-primary font-mono">{normalizeDb.toFixed(1)} dB</span>
                  <input
                    type="range"
                    min={-24}
                    max={0}
                    step={0.5}
                    value={normalizeDb}
                    onChange={e => setNormalizeDb(parseFloat(e.target.value))}
                    className="w-full mt-1"
                  />
                </label>
                <div className="flex gap-1">
                  {[0, -1, -3, -6].map(db => (
                    <button
                      key={db}
                      onClick={() => setNormalizeDb(db)}
                      className={`px-2 py-1 text-[10px] rounded border font-mono ${
                        normalizeDb === db
                          ? "bg-accent-primary border-accent-primary text-white"
                          : "bg-bg-panel border-border-color text-text-muted hover:text-text-primary"
                      }`}
                    >
                      {db === 0 ? "0" : db} dB
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setEditMode("none")}
                  className="px-3 py-1 text-[10px] rounded bg-bg-panel border border-border-color text-text-muted hover:text-text-primary"
                >
                  Abbrechen
                </button>
                <button
                  onClick={applyNormalize}
                  className="px-3 py-1 text-[10px] rounded bg-accent-primary text-white font-bold"
                >
                  Normalize anwenden
                </button>
              </div>
            </div>
          )}

          {/* ── Peak/RMS Info ──────────────────────────────────────────── */}
          <div className="text-[10px] text-text-dim font-mono px-1">
            Peak: {(getPeak(buffer) * 100).toFixed(1)}% · Länge: {buffer.duration.toFixed(2)}s · {buffer.sampleRate}Hz
          </div>

          <button
            onClick={handleSeparate}
            disabled={processing}
            className="w-full py-2.5 rounded-lg bg-accent-primary text-white text-sm font-bold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {processing ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Verarbeite Stems…
              </>
            ) : (
              "🎚 Frequenz-Stems trennen"
            )}
          </button>
        </>
      )}

      {/* Stem-Ergebnisse */}
      {stems.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-text-primary">Stems</span>
            <button
              onClick={handleAddAll}
              className="text-[10px] text-accent-primary hover:opacity-70 font-bold"
            >
              + Alle als Samples
            </button>
          </div>

          {stems.map(stem => (
            <div
              key={stem.name}
              className="flex items-center gap-3 bg-bg-elevated rounded-lg px-3 py-2"
            >
              <div className="w-3 h-8 rounded-sm flex-shrink-0" style={{ background: stem.color }} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-text-primary">{stem.name}</div>
                <div className="text-[10px] text-text-dim">{stem.freq} · {stem.duration.toFixed(2)}s</div>
              </div>
              <audio src={stem.url} controls className="h-6 max-w-32" />
              <button
                onClick={() => handleAddStem(stem)}
                className="px-2 py-1 rounded bg-accent-primary/20 border border-accent-primary/30 text-accent-primary text-[10px] font-bold hover:bg-accent-primary/30 flex-shrink-0"
              >
                + Sample
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
