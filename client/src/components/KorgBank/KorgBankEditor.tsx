/**
 * Synthstudio – KorgBankEditor (v3.4.0)
 *
 * WRITE-Side für KORG E2S `.all` Sample-Banks. Komplementär zu KorgBankModal
 * (das nur READ macht).
 *
 * Workflow:
 *   1. User öffnet Modal aus DrumMachine-Toolbar ("📤 KORG Export").
 *   2. User wählt Samples aus useProjectStore.samples (Pick-Liste).
 *   3. Pro Slot: Name + Category + (TODO) Slicing-Marker editierbar.
 *   4. "Save As .all" → buildE2sBank → IPC saveKorgBankAs (Electron) ODER
 *      Blob-Download (Browser).
 *
 * Gated via PRO_FEATURE_KORG_BANK_WRITE.
 *
 * Vereinfachung gegenüber Python-Editor:
 *   - Pro-MVP keine smpl-Chunk-/Loop-Editor — User darf `oneshot` togglen,
 *     Loop-Punkte sind 0/full-sample.
 *   - Resampling/Channel-Adjust passiert automatisch in convertToE2sSpec.
 *   - Slice-Marker können in einer späteren Iteration eingebaut werden.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useProjectStore, type Sample } from "@/store/useProjectStore";
import { toast } from "@/store/useToastStore";
import {
  buildE2sBank,
  E2sBuildError,
  type E2sSlotInput,
} from "@/utils/korg/e2sBankBuilder";
import {
  convertToE2sSpec,
  AudioProcessError,
} from "@/utils/korg/audioProcessor";
import {
  E2S_CATEGORY_NAMES,
  E2S_MAX_SLOTS,
  E2S_SAMPLE_RATES,
  MAX_BYTES_PER_SLOT,
} from "@/utils/korg/constants";
import {
  PRO_FEATURE_KORG_BANK_WRITE,
  requireProFeature,
} from "@/utils/proFeatures";
import { ProLockBadge } from "@/components/License/ProLockBadge";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface KorgBankEditorProps {
  /** Wenn `true` rendert sich das Modal. Caller toggelt das State. */
  open: boolean;
  onClose: () => void;
}

// ─── Internal State ───────────────────────────────────────────────────────────

interface EditorSlot {
  /** Unique row ID for React + data-testids. */
  rowId: string;
  /** Slot-Index 0..249 (User-editierbar via Up/Down). */
  slotIndex: number;
  /** Source-Sample (referenz auf useProjectStore.samples). */
  source: Sample;
  /** Editierbarer Slot-Name (max 16 ASCII chars). */
  name: string;
  /** Category 0..17. */
  category: number;
  /** Oneshot (false = forward-loop). */
  oneshot: boolean;
  /** Decode-Status. */
  status: "pending" | "decoding" | "ready" | "error";
  /** Bei status=ready: dekodierter Float32-PCM (mono, interleaved-LR oder mono). */
  pcm?: Float32Array;
  channels?: 1 | 2;
  sampleRate?: number;
  errorMessage?: string;
  /** Frame-Count nach convert. */
  frames?: number;
  /** Geschätzte Bytes für Cap-Display. */
  pcmBytes?: number;
}

const TARGET_SAMPLE_RATE_OPTIONS: ReadonlyArray<44100 | 48000> = E2S_SAMPLE_RATES;

// ─── Public Component ─────────────────────────────────────────────────────────

export function KorgBankEditor({
  open,
  onClose,
}: KorgBankEditorProps): React.ReactElement | null {
  const project = useProjectStore();
  const samples = project.samples;
  const [editorSlots, setEditorSlots] = useState<EditorSlot[]>([]);
  const [targetSr, setTargetSr] = useState<44100 | 48000>(44100);
  const [forceMono, setForceMono] = useState<boolean>(false);
  const [filename, setFilename] = useState<string>("synthstudio_pack.all");
  const [busy, setBusy] = useState<boolean>(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Lazy-init shared AudioContext für decode (closed beim Unmount).
  useEffect(() => {
    if (!open) return;
    return () => {
      audioContextRef.current?.close().catch(() => {/* */});
      audioContextRef.current = null;
    };
  }, [open]);

  // Reset state on close
  useEffect(() => {
    if (!open) {
      setEditorSlots([]);
      setResultMsg(null);
      setBusy(false);
    }
  }, [open]);

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function getCtx(): AudioContext {
    if (!audioContextRef.current) {
      const Ctor = window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new Error("AudioContext nicht verfügbar");
      audioContextRef.current = new Ctor();
    }
    return audioContextRef.current;
  }

  async function decodeSample(sample: Sample): Promise<{ pcm: Float32Array; sampleRate: number; channels: 1 | 2 }> {
    // Fetch the blob/URL into an ArrayBuffer.
    const res = await fetch(sample.path);
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const ab = await res.arrayBuffer();
    const ctx = getCtx();
    const buf = await ctx.decodeAudioData(ab.slice(0));
    const channels: 1 | 2 = buf.numberOfChannels >= 2 ? 2 : 1;
    let pcm: Float32Array;
    if (channels === 1) {
      pcm = new Float32Array(buf.getChannelData(0));
    } else {
      const l = buf.getChannelData(0);
      const r = buf.getChannelData(1);
      pcm = new Float32Array(l.length * 2);
      for (let i = 0; i < l.length; i++) {
        pcm[i * 2] = l[i];
        pcm[i * 2 + 1] = r[i];
      }
    }
    return { pcm, sampleRate: buf.sampleRate, channels };
  }

  function addSampleAsSlot(source: Sample): void {
    if (editorSlots.length >= E2S_MAX_SLOTS) {
      toast(`E2S unterstützt nur ${E2S_MAX_SLOTS} Slots`, { kind: "warning" });
      return;
    }
    if (editorSlots.some((s) => s.source.id === source.id)) {
      toast("Sample bereits in der Liste", { kind: "info" });
      return;
    }
    const slot: EditorSlot = {
      rowId: `slot-${Date.now()}-${source.id}`,
      slotIndex: editorSlots.length,
      source,
      name: source.name.replace(/\.[^.]+$/, "").slice(0, 16),
      category: 0,
      oneshot: true,
      status: "pending",
    };
    setEditorSlots((prev) => [...prev, slot]);
  }

  function removeSlot(rowId: string): void {
    setEditorSlots((prev) => {
      const filtered = prev.filter((s) => s.rowId !== rowId);
      // Re-pack slot indices (keep visual order)
      return filtered.map((s, i) => ({ ...s, slotIndex: i }));
    });
  }

  function updateSlot(rowId: string, patch: Partial<EditorSlot>): void {
    setEditorSlots((prev) => prev.map((s) => (s.rowId === rowId ? { ...s, ...patch } : s)));
  }

  // ─── Build & Save ──────────────────────────────────────────────────────────

  async function decodeAllPending(): Promise<EditorSlot[]> {
    const updated: EditorSlot[] = [];
    for (const slot of editorSlots) {
      if (slot.status === "ready") {
        updated.push(slot);
        continue;
      }
      try {
        const dec = await decodeSample(slot.source);
        const processed = convertToE2sSpec(dec.pcm, dec.sampleRate, dec.channels, {
          targetSampleRate: targetSr,
          forceMono,
        });
        if (processed.estimatedPcmBytes > MAX_BYTES_PER_SLOT) {
          updated.push({
            ...slot,
            status: "error",
            errorMessage: `Sample zu groß (${(processed.estimatedPcmBytes / 1024 / 1024).toFixed(1)} MB > 10 MB)`,
          });
          continue;
        }
        updated.push({
          ...slot,
          status: "ready",
          pcm: processed.pcm,
          channels: processed.channels,
          sampleRate: processed.sampleRate,
          frames: processed.frames,
          pcmBytes: processed.estimatedPcmBytes,
        });
      } catch (err) {
        const msg =
          err instanceof AudioProcessError ? err.message :
          err instanceof Error ? err.message : String(err);
        updated.push({ ...slot, status: "error", errorMessage: msg });
      }
    }
    setEditorSlots(updated);
    return updated;
  }

  async function handleSaveAs(): Promise<void> {
    if (!requireProFeature(PRO_FEATURE_KORG_BANK_WRITE)) return;
    if (editorSlots.length === 0) {
      toast("Keine Samples in der Bank — bitte zuerst hinzufügen.", { kind: "warning" });
      return;
    }
    setBusy(true);
    setResultMsg("Decodiere Samples...");
    try {
      const decoded = await decodeAllPending();
      const ready = decoded.filter((s) => s.status === "ready");
      const errored = decoded.filter((s) => s.status === "error");
      if (ready.length === 0) {
        toast("Keine gültigen Samples — alle Decodes fehlgeschlagen.", { kind: "error" });
        setResultMsg(null);
        return;
      }
      if (errored.length > 0) {
        toast(`${errored.length} Slot(s) übersprungen wg. Decode-Fehler`, { kind: "warning" });
      }
      setResultMsg("Baue .all-Bank...");
      const inputs: E2sSlotInput[] = ready.map((s) => ({
        slotIndex: s.slotIndex,
        name: s.name,
        category: s.category,
        pcmData: s.pcm!,
        sampleRate: s.sampleRate!,
        channels: s.channels!,
        loopType: s.oneshot ? 1 : 2,
      }));
      const result = buildE2sBank(inputs);
      if (result.warnings.length > 0) {
        console.warn("[KorgBankEditor] build warnings:", result.warnings);
      }
      const buf = result.buffer;
      const isElectron =
        typeof window !== "undefined" &&
        typeof window.electronAPI !== "undefined" &&
        typeof (window.electronAPI as { saveKorgBankAs?: unknown }).saveKorgBankAs === "function";

      // Filename sanitize for IPC validation (.all + safe chars only).
      const safeName = filename.replace(/[^A-Za-z0-9._-]/g, "_");
      const finalName = safeName.endsWith(".all") ? safeName : `${safeName}.all`;

      if (isElectron) {
        const apiAny = window.electronAPI as { saveKorgBankAs: (n: string, d: ArrayBuffer) => Promise<{ success: boolean; filePath?: string; bytesWritten?: number; error?: string }> };
        const saveResult = await apiAny.saveKorgBankAs(finalName, buf);
        if (!saveResult.success) {
          if (saveResult.error === "canceled") {
            setResultMsg(null);
            return;
          }
          toast(`Fehler beim Speichern: ${saveResult.error}`, { kind: "error" });
          setResultMsg(null);
          return;
        }
        toast(`E2S Bank gespeichert: ${saveResult.filePath} (${result.slotCount} Slots)`, { kind: "success", duration: 4000 });
        setResultMsg(`Gespeichert: ${saveResult.filePath}`);
      } else {
        // Browser-Fallback: trigger Download via Blob.
        const blob = new Blob([buf], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        try {
          const a = document.createElement("a");
          a.href = url;
          a.download = finalName;
          document.body.appendChild(a);
          a.click();
          a.remove();
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        toast(`E2S Bank heruntergeladen: ${finalName} (${result.slotCount} Slots)`, { kind: "success", duration: 4000 });
        setResultMsg(`Download: ${finalName}`);
      }
    } catch (err) {
      const msg = err instanceof E2sBuildError ? err.message : err instanceof Error ? err.message : String(err);
      toast(`Build-Fehler: ${msg}`, { kind: "error", duration: 6000 });
      setResultMsg(null);
    } finally {
      setBusy(false);
    }
  }

  // ─── Computed ──────────────────────────────────────────────────────────────

  const totalBytes = useMemo(
    () => editorSlots.reduce((sum, s) => sum + (s.pcmBytes ?? 0), 0),
    [editorSlots],
  );

  // Samples that aren't yet in the bank — show in the picker.
  const availableSamples = useMemo(
    () => samples.filter((sm) => !editorSlots.some((es) => es.source.id === sm.id)),
    [samples, editorSlots],
  );

  if (!open) return null;

  return (
    <div
      data-testid="korg-bank-editor-overlay"
      className="fixed inset-0 z-50 bg-bg-base/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        data-testid="korg-bank-editor"
        className="bg-bg-panel border border-border-color rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <header className="px-4 py-3 border-b border-border-color flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-text-primary flex items-center gap-2">
              KORG E2 Sample-Bank exportieren
              <ProLockBadge feature={PRO_FEATURE_KORG_BANK_WRITE} />
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              Sammle Samples → exportiere als .all für deinen KORG Electribe 2 Sampler
              {" · "}
              {editorSlots.length}/{E2S_MAX_SLOTS} Slots
              {" · "}
              {(totalBytes / 1024 / 1024).toFixed(1)} MB PCM
            </p>
          </div>
          <button
            data-testid="korg-bank-editor-close"
            onClick={onClose}
            disabled={busy}
            className="px-2 py-1 text-xs rounded bg-bg-elevated text-text-muted hover:text-text-primary transition-colors disabled:opacity-40"
            title="Schliessen"
          >
            ✕
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          {/* Left — Sample Picker */}
          <div className="md:w-1/3 border-r border-border-color overflow-y-auto p-3 space-y-2">
            <h3 className="text-xs font-semibold text-text-primary mb-1">
              Verfügbare Samples ({availableSamples.length})
            </h3>
            {availableSamples.length === 0 ? (
              <p className="text-xs text-text-muted">
                Alle Project-Samples sind bereits in der Bank, oder die Sample-Library ist leer.
              </p>
            ) : (
              <ul className="space-y-1" data-testid="korg-bank-editor-picker">
                {availableSamples.map((s) => (
                  <li key={s.id}>
                    <button
                      data-testid={`korg-bank-editor-pick-${s.id}`}
                      onClick={() => addSampleAsSlot(s)}
                      disabled={editorSlots.length >= E2S_MAX_SLOTS}
                      className="w-full text-left px-2 py-1 rounded text-xs bg-bg-elevated text-text-primary hover:bg-bg-base hover:border-accent-primary border border-transparent transition-colors disabled:opacity-40"
                      title={s.name}
                    >
                      <span className="truncate block">+ {s.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Right — Slot Editor */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {/* Settings row */}
            <div className="flex flex-wrap items-center gap-3 pb-2 mb-2 border-b border-border-color">
              <label className="text-xs text-text-muted flex items-center gap-1">
                Sample-Rate:
                <select
                  data-testid="korg-bank-editor-target-sr"
                  value={targetSr}
                  onChange={(e) => setTargetSr(Number(e.target.value) as 44100 | 48000)}
                  className="bg-bg-elevated border border-border-color rounded text-xs px-1 py-0.5 text-text-primary"
                >
                  {TARGET_SAMPLE_RATE_OPTIONS.map((r) => (
                    <option key={r} value={r}>{r} Hz</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-text-muted flex items-center gap-1">
                <input
                  data-testid="korg-bank-editor-force-mono"
                  type="checkbox"
                  checked={forceMono}
                  onChange={(e) => setForceMono(e.target.checked)}
                  className="accent-accent-primary"
                />
                Force Mono
              </label>
              <label className="text-xs text-text-muted flex items-center gap-1 flex-1 min-w-[150px]">
                Dateiname:
                <input
                  data-testid="korg-bank-editor-filename"
                  type="text"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  className="flex-1 bg-bg-elevated border border-border-color rounded text-xs px-1 py-0.5 text-text-primary"
                />
              </label>
            </div>

            {/* Slot Table */}
            {editorSlots.length === 0 ? (
              <p className="text-xs text-text-muted text-center py-8">
                Wähle links Samples aus, um sie der Bank hinzuzufügen.
              </p>
            ) : (
              <div className="space-y-1" data-testid="korg-bank-editor-list">
                {editorSlots.map((slot) => (
                  <div
                    key={slot.rowId}
                    data-testid={`korg-bank-editor-row-${slot.rowId}`}
                    className="flex items-center gap-2 px-2 py-1.5 rounded text-xs bg-bg-elevated border border-transparent hover:border-border-color"
                  >
                    <span className="font-mono text-text-dim w-10 flex-shrink-0">
                      #{slot.slotIndex}
                    </span>
                    <input
                      data-testid={`korg-bank-editor-name-${slot.rowId}`}
                      type="text"
                      value={slot.name}
                      onChange={(e) => updateSlot(slot.rowId, { name: e.target.value.slice(0, 16) })}
                      maxLength={16}
                      className="flex-1 min-w-[80px] bg-bg-base border border-border-color rounded px-1 py-0.5 text-text-primary"
                    />
                    <select
                      data-testid={`korg-bank-editor-cat-${slot.rowId}`}
                      value={slot.category}
                      onChange={(e) => updateSlot(slot.rowId, { category: Number(e.target.value) })}
                      className="bg-bg-base border border-border-color rounded text-xs px-1 py-0.5 text-text-primary w-24 flex-shrink-0"
                    >
                      {E2S_CATEGORY_NAMES.map((n, i) => (
                        <option key={i} value={i}>{n}</option>
                      ))}
                    </select>
                    <label className="text-text-muted flex items-center gap-1 text-[10px]">
                      <input
                        type="checkbox"
                        checked={slot.oneshot}
                        onChange={(e) => updateSlot(slot.rowId, { oneshot: e.target.checked })}
                      />
                      1-Shot
                    </label>
                    <span className={`text-[10px] w-20 truncate ${slot.status === "error" ? "text-accent-danger" : "text-text-dim"}`}>
                      {slot.status === "ready" && slot.frames ? `${slot.frames} fr` : slot.status}
                    </span>
                    <button
                      data-testid={`korg-bank-editor-remove-${slot.rowId}`}
                      onClick={() => removeSlot(slot.rowId)}
                      className="px-2 py-0.5 rounded text-[10px] bg-bg-base text-text-muted hover:text-accent-danger transition-colors"
                      title="Aus der Bank entfernen"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {resultMsg && (
              <p
                data-testid="korg-bank-editor-status"
                className="text-xs text-text-muted pt-2 border-t border-border-color"
              >
                {resultMsg}
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <footer className="px-4 py-3 border-t border-border-color flex items-center justify-between flex-shrink-0">
          <p className="text-xs text-text-muted">
            Total: {editorSlots.length} Slots · {(totalBytes / 1024 / 1024).toFixed(2)} MB PCM
          </p>
          <div className="flex items-center gap-2">
            <button
              data-testid="korg-bank-editor-cancel"
              onClick={onClose}
              disabled={busy}
              className="px-3 py-1 rounded text-xs bg-bg-elevated text-text-muted hover:text-text-primary transition-colors disabled:opacity-40"
            >
              Abbrechen
            </button>
            <button
              data-testid="korg-bank-editor-save"
              onClick={handleSaveAs}
              disabled={busy || editorSlots.length === 0}
              className="px-3 py-1 rounded text-xs bg-accent-primary text-bg-base hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center gap-2"
            >
              {busy ? "Speichere..." : "Als .all speichern"}
              <ProLockBadge feature={PRO_FEATURE_KORG_BANK_WRITE} />
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default KorgBankEditor;
