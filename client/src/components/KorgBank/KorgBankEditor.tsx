/**
 * Synthstudio – KorgBankEditor (v3.7.0)
 *
 * WRITE-Side für KORG E2S `.all` Sample-Banks. Komplementär zu KorgBankModal
 * (das nur READ macht).
 *
 * v3.7.0 — Bank-Open-Flow:
 *   - Modus-Toggle "Create New" / "Edit Existing" im Header.
 *   - "Open Existing Bank" Button → File-Picker (Electron-Dialog oder
 *     <input type=file> Fallback) → parseE2sBank(buf, { preserveRawRiff: true })
 *     → 250-Row Slot-Browser links, Slot-Detail-Editor rechts.
 *   - Per-Slot Edit: Name / Category / Oneshot / +12dB / Sample-Tune. Jede
 *     Änderung setzt isDirty=true für genau diesen Slot.
 *   - Replace Sample (neues WAV laden), Delete (clear → empty), Revert.
 *   - Save → buildE2sBank(slots, { preserveRawRiff: true }) — unedited Slots
 *     werden bit-exakt durchgereicht, dirty Slots re-encoded. Toast mit
 *     `N geändert, M bit-exakt`.
 *
 * Workflow (Create-New, unverändert seit v3.4):
 *   1. User öffnet Modal aus DrumMachine-Toolbar ("📤 KORG Export").
 *   2. User wählt Samples aus useProjectStore.samples (Pick-Liste).
 *   3. Pro Slot: Name + Category + Oneshot editierbar.
 *   4. "Save As .all" → buildE2sBank → IPC saveKorgBankAs (Electron) ODER
 *      Blob-Download (Browser).
 *
 * Gated via PRO_FEATURE_KORG_BANK_WRITE (gated auch das Open-Flow).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProjectStore, type Sample } from "@/store/useProjectStore";
import { toast } from "@/store/useToastStore";
import {
  buildE2sBank,
  E2sBuildError,
  type E2sSlotInput,
} from "@/utils/korg/e2sBankBuilder";
import {
  parseE2sBank,
  E2sParseError,
} from "@/utils/korg/e2sBankReader";
import {
  convertToE2sSpec,
  AudioProcessError,
} from "@/utils/korg/audioProcessor";
import {
  E2S_CATEGORY_NAMES,
  E2S_MAX_SLOTS,
  E2S_SAMPLE_RATES,
  LOOP_TYPE_ONESHOT,
  MAX_BYTES_PER_SLOT,
} from "@/utils/korg/constants";
import {
  bankToOpenedSlots,
  countDirtySlots,
  countFilledSlots,
  deleteSlot,
  displayCategory,
  displayName,
  hasUnsavedChanges,
  openedSlotsToBuildInputs,
  patchOpenedSlot,
  replaceSlotSample,
  revertSlot,
  setSlotSlices,
  type OpenedSlot,
} from "@/utils/korg/bankEditorState";
import {
  MAX_ESLI_SLICES,
  onsetsToSlices as onsetsToEsliSlices,
  slicesToOnsets as esliSlicesToOnsets,
} from "@/utils/korg/sliceBridge";
import {
  autoSlice,
  type OnsetCandidate,
} from "@/utils/sampleSlicing";
import {
  extractSliceBuffer,
  playSliceWithContext,
  type SliceAuditionHandle,
} from "@/utils/korg/sliceAudition";
import { WaveformSliceCanvas } from "./WaveformSliceCanvas";
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
  /**
   * v3.7.0 — Optional externer File-Drop. Wenn der Caller hier einen .all-File
   * durchreicht (z.B. weil der User auf das offene Editor-Modal eine .all
   * gedroppt hat), öffnet der Editor das File automatisch im "edit" Modus.
   */
  externalOpenFile?: File | null;
  /** Wird aufgerufen sobald `externalOpenFile` verarbeitet wurde — Caller kann state resetten. */
  onExternalOpenFileConsumed?: () => void;
}

// ─── Internal State (Create-New mode) ─────────────────────────────────────────

interface NewModeSlot {
  rowId: string;
  slotIndex: number;
  source: Sample;
  name: string;
  category: number;
  oneshot: boolean;
  status: "pending" | "decoding" | "ready" | "error";
  pcm?: Float32Array;
  channels?: 1 | 2;
  sampleRate?: number;
  errorMessage?: string;
  frames?: number;
  pcmBytes?: number;
}

const TARGET_SAMPLE_RATE_OPTIONS: ReadonlyArray<44100 | 48000> = E2S_SAMPLE_RATES;

type EditorMode = "new" | "edit";

/**
 * v3.8.0 — Extrahiere einen Mono-Channel aus dem (möglicherweise interleaved
 * Stereo) PCM-Buffer für die Waveform-Visualisierung. Bei Stereo: Kanal 0
 * (Left). Mono: gibt die Eingabe unverändert zurück.
 *
 * Keine Allocation wenn schon Mono — sonst neue Float32Array.
 */
function extractMonoChannel(pcm: Float32Array, channels: 1 | 2): Float32Array {
  if (channels === 1) return pcm;
  const frames = Math.floor(pcm.length / 2);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = pcm[i * 2];
  }
  return out;
}

// ─── Public Component ─────────────────────────────────────────────────────────

export function KorgBankEditor({
  open,
  onClose,
  externalOpenFile = null,
  onExternalOpenFileConsumed,
}: KorgBankEditorProps): React.ReactElement | null {
  const project = useProjectStore();
  const samples = project.samples;

  // Mode
  const [mode, setMode] = useState<EditorMode>("new");

  // "new" mode state
  const [newSlots, setNewSlots] = useState<NewModeSlot[]>([]);
  const [targetSr, setTargetSr] = useState<44100 | 48000>(44100);
  const [forceMono, setForceMono] = useState<boolean>(false);
  const [filename, setFilename] = useState<string>("synthstudio_pack.all");

  // "edit" mode state
  const [openedSlots, setOpenedSlots] = useState<OpenedSlot[]>([]);
  const [openedSourceName, setOpenedSourceName] = useState<string>("");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

  // Shared
  const [busy, setBusy] = useState<boolean>(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  // v3.9.0 — Slice-Audition (Preview)
  const [auditionState, setAuditionState] = useState<{
    rowId: string;
    sliceIndex: number;
    startedAt: number;
    durationMs: number;
  } | null>(null);
  const auditionHandleRef = useRef<SliceAuditionHandle | null>(null);

  const stopCurrentAudition = useCallback((): void => {
    try { auditionHandleRef.current?.stop(); } catch { /* ignore */ }
    auditionHandleRef.current = null;
    setAuditionState(null);
  }, []);

  // Lazy-init shared AudioContext (closed beim Unmount).
  useEffect(() => {
    if (!open) return;
    return () => {
      // v3.9.0 — Stop laufende Audition vor Context-Close.
      try { auditionHandleRef.current?.stop(); } catch { /* ignore */ }
      auditionHandleRef.current = null;
      audioContextRef.current?.close().catch(() => {/* */});
      audioContextRef.current = null;
    };
  }, [open]);

  // v3.9.0 — Bei Slot-Wechsel oder Mode-Wechsel: Audition stoppen.
  useEffect(() => {
    stopCurrentAudition();
  }, [selectedRowId, mode, stopCurrentAudition]);

  // Reset state on close
  useEffect(() => {
    if (!open) {
      setNewSlots([]);
      setOpenedSlots([]);
      setOpenedSourceName("");
      setSelectedRowId(null);
      setResultMsg(null);
      setBusy(false);
      setMode("new");
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
    const res = await fetch(sample.path);
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const ab = await res.arrayBuffer();
    return decodeArrayBuffer(ab);
  }

  async function decodeArrayBuffer(ab: ArrayBuffer): Promise<{ pcm: Float32Array; sampleRate: number; channels: 1 | 2 }> {
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

  // ─── Mode Switching ────────────────────────────────────────────────────────

  function tryChangeMode(next: EditorMode): void {
    if (mode === next) return;
    const hasChanges =
      next === "new"
        ? hasUnsavedChanges(openedSlots) || openedSlots.length > 0
        : newSlots.length > 0;
    if (hasChanges) {
      const ok = window.confirm(
        "Ungespeicherte Änderungen gehen verloren. Trotzdem Modus wechseln?",
      );
      if (!ok) return;
    }
    if (next === "new") {
      setOpenedSlots([]);
      setOpenedSourceName("");
      setSelectedRowId(null);
    } else {
      setNewSlots([]);
    }
    setResultMsg(null);
    setMode(next);
  }

  // ─── Open Existing Bank ────────────────────────────────────────────────────

  const loadBankFromFile = useCallback(async (file: File): Promise<void> => {
    if (!requireProFeature(PRO_FEATURE_KORG_BANK_WRITE)) return;
    if (file.size === 0) {
      toast("Datei ist leer.", { kind: "error" });
      return;
    }
    setBusy(true);
    setResultMsg("Lade Bank...");
    try {
      const ab = await file.arrayBuffer();
      const bank = parseE2sBank(ab, file.name, { preserveRawRiff: true });
      const slots = bankToOpenedSlots(bank);
      setOpenedSlots(slots);
      setOpenedSourceName(file.name);
      setMode("edit");
      // Pre-select first filled slot if any.
      const firstFilled = slots.find((s) => !s.empty);
      setSelectedRowId(firstFilled ? firstFilled.rowId : null);
      // Filename default = source (sanitized at save time).
      setFilename(file.name);
      const filledCount = countFilledSlots(slots);
      toast(
        `Bank geladen: ${filledCount} Slot(s) — ${bank.warnings.length} Warnungen`,
        { kind: "success", duration: 4000 },
      );
      setResultMsg(`${filledCount} Slot(s) bereit zur Bearbeitung`);
    } catch (err) {
      const msg =
        err instanceof E2sParseError ? err.message :
        err instanceof Error ? err.message : String(err);
      toast(`Fehler beim Laden: ${msg}`, { kind: "error", duration: 6000 });
      setResultMsg(null);
    } finally {
      setBusy(false);
    }
  }, []);

  // v3.7: external file (drag-drop into editor) auto-open
  useEffect(() => {
    if (!open || !externalOpenFile) return;
    loadBankFromFile(externalOpenFile)
      .finally(() => onExternalOpenFileConsumed?.());
  }, [open, externalOpenFile, loadBankFromFile, onExternalOpenFileConsumed]);

  function handleOpenBankClick(): void {
    if (!requireProFeature(PRO_FEATURE_KORG_BANK_WRITE)) return;
    fileInputRef.current?.click();
  }

  function handleBankFileInput(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting same file
    if (f) loadBankFromFile(f);
  }

  // ─── "New" Mode Operations ─────────────────────────────────────────────────

  function addSampleAsSlot(source: Sample): void {
    if (newSlots.length >= E2S_MAX_SLOTS) {
      toast(`E2S unterstützt nur ${E2S_MAX_SLOTS} Slots`, { kind: "warning" });
      return;
    }
    if (newSlots.some((s) => s.source.id === source.id)) {
      toast("Sample bereits in der Liste", { kind: "info" });
      return;
    }
    const slot: NewModeSlot = {
      rowId: `slot-${Date.now()}-${source.id}`,
      slotIndex: newSlots.length,
      source,
      name: source.name.replace(/\.[^.]+$/, "").slice(0, 16),
      category: 0,
      oneshot: true,
      status: "pending",
    };
    setNewSlots((prev) => [...prev, slot]);
  }

  function removeNewSlot(rowId: string): void {
    setNewSlots((prev) => {
      const filtered = prev.filter((s) => s.rowId !== rowId);
      return filtered.map((s, i) => ({ ...s, slotIndex: i }));
    });
  }

  function updateNewSlot(rowId: string, patch: Partial<NewModeSlot>): void {
    setNewSlots((prev) => prev.map((s) => (s.rowId === rowId ? { ...s, ...patch } : s)));
  }

  // ─── "Edit" Mode Operations ────────────────────────────────────────────────

  function editSlotPatch(rowId: string, patch: Partial<OpenedSlot>): void {
    setOpenedSlots((prev) => patchOpenedSlot(prev, rowId, patch));
  }

  function editSlotDelete(rowId: string): void {
    setOpenedSlots((prev) => deleteSlot(prev, rowId));
  }

  function editSlotRevert(rowId: string): void {
    setOpenedSlots((prev) => revertSlot(prev, rowId));
  }

  async function editSlotReplaceSample(rowId: string, file: File): Promise<void> {
    setBusy(true);
    try {
      const ab = await file.arrayBuffer();
      const decoded = await decodeArrayBuffer(ab);
      const processed = convertToE2sSpec(decoded.pcm, decoded.sampleRate, decoded.channels, {
        targetSampleRate: targetSr,
        forceMono,
      });
      if (processed.estimatedPcmBytes > MAX_BYTES_PER_SLOT) {
        toast(`Sample zu groß (${(processed.estimatedPcmBytes / 1024 / 1024).toFixed(1)} MB > 10 MB)`, { kind: "error" });
        return;
      }
      setOpenedSlots((prev) =>
        replaceSlotSample(prev, rowId, processed.pcm, processed.sampleRate, processed.channels),
      );
      toast(`Sample ersetzt: ${file.name}`, { kind: "success", duration: 3000 });
    } catch (err) {
      const msg =
        err instanceof AudioProcessError ? err.message :
        err instanceof Error ? err.message : String(err);
      toast(`Fehler beim Ersetzen: ${msg}`, { kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  function handleReplaceClick(rowId: string): void {
    setSelectedRowId(rowId);
    replaceInputRef.current?.click();
  }

  // ─── Slice-Editor (v3.8.0) ─────────────────────────────────────────────────

  function editSlotSetSlices(
    rowId: string,
    slices: ReturnType<typeof onsetsToEsliSlices>,
  ): void {
    setOpenedSlots((prev) => setSlotSlices(prev, rowId, slices));
  }

  function handleAutoSlice(slot: OpenedSlot): void {
    if (!slot.pcmData || !slot.sampleRate || !slot.channels || !slot.frames) return;
    const mono = extractMonoChannel(slot.pcmData, slot.channels);
    try {
      const specs = autoSlice(mono, slot.sampleRate, {
        maxSlices: MAX_ESLI_SLICES,
        snapToZero: true,
        fillToMax: false,
      });
      const onsets: OnsetCandidate[] = specs.map((s) => ({
        frame: s.startFrame,
        strength: 1,
      }));
      // Auto-Slice gibt Frame-0-anchored Onsets — passt direkt zu ESLI-Slices.
      const eSlices = onsetsToEsliSlices(onsets, slot.frames);
      editSlotSetSlices(slot.rowId, eSlices);
    } catch (err) {
      console.error("[KorgBankEditor] autoSlice failed", err);
      toast("Auto-Slice fehlgeschlagen", { kind: "error" });
    }
  }

  function handleClearSlices(rowId: string): void {
    editSlotSetSlices(rowId, []);
  }

  function handleReplaceInput(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f && selectedRowId) editSlotReplaceSample(selectedRowId, f);
  }

  // ─── Build & Save ──────────────────────────────────────────────────────────

  async function decodeAllPendingNew(): Promise<NewModeSlot[]> {
    const updated: NewModeSlot[] = [];
    for (const slot of newSlots) {
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
    setNewSlots(updated);
    return updated;
  }

  async function handleSaveAs(): Promise<void> {
    if (!requireProFeature(PRO_FEATURE_KORG_BANK_WRITE)) return;

    let inputs: E2sSlotInput[];
    let savedMsgDetail = "";

    if (mode === "new") {
      if (newSlots.length === 0) {
        toast("Keine Samples in der Bank — bitte zuerst hinzufügen.", { kind: "warning" });
        return;
      }
      setBusy(true);
      setResultMsg("Decodiere Samples...");
      try {
        const decoded = await decodeAllPendingNew();
        const ready = decoded.filter((s) => s.status === "ready");
        const errored = decoded.filter((s) => s.status === "error");
        if (ready.length === 0) {
          toast("Keine gültigen Samples — alle Decodes fehlgeschlagen.", { kind: "error" });
          setResultMsg(null);
          setBusy(false);
          return;
        }
        if (errored.length > 0) {
          toast(`${errored.length} Slot(s) übersprungen wg. Decode-Fehler`, { kind: "warning" });
        }
        inputs = ready.map((s) => ({
          slotIndex: s.slotIndex,
          name: s.name,
          category: s.category,
          pcmData: s.pcm!,
          sampleRate: s.sampleRate!,
          channels: s.channels!,
          loopType: s.oneshot ? LOOP_TYPE_ONESHOT : 2,
          isDirty: true,
        }));
        savedMsgDetail = `${ready.length} neue Slots`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast(`Decode-Fehler: ${msg}`, { kind: "error" });
        setResultMsg(null);
        setBusy(false);
        return;
      }
    } else {
      // edit mode
      const filledCount = countFilledSlots(openedSlots);
      if (filledCount === 0) {
        toast("Bank ist leer — nichts zu speichern.", { kind: "warning" });
        return;
      }
      setBusy(true);
      setResultMsg("Baue Bank...");
      const built = openedSlotsToBuildInputs(openedSlots);
      inputs = built.inputs;
      savedMsgDetail = `${built.dirtyCount} geändert, ${built.passthroughCount} bit-exakt erhalten`;
      if (built.droppedCount > 0) {
        toast(`${built.droppedCount} korrupter Slot(s) verworfen`, { kind: "warning" });
      }
    }

    try {
      setResultMsg("Baue .all-Bank...");
      const result = buildE2sBank(inputs, { preserveRawRiff: true });
      if (result.warnings.length > 0) {
        console.warn("[KorgBankEditor] build warnings:", result.warnings);
      }
      const buf = result.buffer;
      const isElectron =
        typeof window !== "undefined" &&
        typeof window.electronAPI !== "undefined" &&
        typeof (window.electronAPI as { saveKorgBankAs?: unknown }).saveKorgBankAs === "function";

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
        toast(`E2S Bank gespeichert: ${saveResult.filePath} (${savedMsgDetail})`, { kind: "success", duration: 4000 });
        setResultMsg(`Gespeichert: ${saveResult.filePath}`);
      } else {
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
        toast(`E2S Bank heruntergeladen: ${finalName} (${savedMsgDetail})`, { kind: "success", duration: 4000 });
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

  const totalBytesNew = useMemo(
    () => newSlots.reduce((sum, s) => sum + (s.pcmBytes ?? 0), 0),
    [newSlots],
  );

  const availableSamples = useMemo(
    () => samples.filter((sm) => !newSlots.some((es) => es.source.id === sm.id)),
    [samples, newSlots],
  );

  const filledCountOpened = useMemo(() => countFilledSlots(openedSlots), [openedSlots]);
  const dirtyCountOpened = useMemo(() => countDirtySlots(openedSlots), [openedSlots]);
  const selectedSlot = useMemo(
    () => openedSlots.find((s) => s.rowId === selectedRowId) ?? null,
    [openedSlots, selectedRowId],
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
        <header className="px-4 py-3 border-b border-border-color flex items-center justify-between flex-shrink-0 gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <h2 className="text-base font-semibold text-text-primary flex items-center gap-2">
              KORG E2 Sample-Bank
              <ProLockBadge feature={PRO_FEATURE_KORG_BANK_WRITE} />
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              {mode === "new"
                ? `Erstelle neue Bank · ${newSlots.length}/${E2S_MAX_SLOTS} Slots · ${(totalBytesNew / 1024 / 1024).toFixed(1)} MB PCM`
                : `Editiere ${openedSourceName || "Bank"} · ${filledCountOpened}/${E2S_MAX_SLOTS} Slots · ${dirtyCountOpened} geändert`}
            </p>
          </div>

          {/* Mode Toggle */}
          <div
            data-testid="korg-bank-editor-mode-toggle"
            role="tablist"
            className="flex rounded border border-border-color overflow-hidden text-xs"
          >
            <button
              role="tab"
              data-testid="korg-bank-editor-mode-new"
              aria-selected={mode === "new"}
              onClick={() => tryChangeMode("new")}
              disabled={busy}
              className={`px-3 py-1 transition-colors disabled:opacity-40 ${
                mode === "new"
                  ? "bg-accent-primary text-bg-base"
                  : "bg-bg-elevated text-text-muted hover:text-text-primary"
              }`}
            >
              Neue Bank
            </button>
            <button
              role="tab"
              data-testid="korg-bank-editor-mode-edit"
              aria-selected={mode === "edit"}
              onClick={() => tryChangeMode("edit")}
              disabled={busy}
              className={`px-3 py-1 transition-colors disabled:opacity-40 ${
                mode === "edit"
                  ? "bg-accent-primary text-bg-base"
                  : "bg-bg-elevated text-text-muted hover:text-text-primary"
              }`}
            >
              Bank bearbeiten
            </button>
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

        {/* Hidden file inputs (browser-fallback file pickers) */}
        <input
          ref={fileInputRef}
          data-testid="korg-bank-editor-open-input"
          type="file"
          accept=".all"
          className="hidden"
          onChange={handleBankFileInput}
        />
        <input
          ref={replaceInputRef}
          data-testid="korg-bank-editor-replace-input"
          type="file"
          accept="audio/*,.wav"
          className="hidden"
          onChange={handleReplaceInput}
        />

        {/* Body */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          {mode === "new" ? renderNewModeBody() : renderEditModeBody()}
        </div>

        {/* Footer */}
        <footer className="px-4 py-3 border-t border-border-color flex items-center justify-between flex-shrink-0 gap-2 flex-wrap">
          <p className="text-xs text-text-muted">
            {mode === "new"
              ? `Total: ${newSlots.length} Slots · ${(totalBytesNew / 1024 / 1024).toFixed(2)} MB PCM`
              : `${filledCountOpened} Slots · ${dirtyCountOpened} geändert / ${filledCountOpened - dirtyCountOpened} bit-exakt`}
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
              disabled={
                busy ||
                (mode === "new" && newSlots.length === 0) ||
                (mode === "edit" && filledCountOpened === 0)
              }
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

  // ─── Render: New Mode (legacy v3.4 UI) ─────────────────────────────────────

  function renderNewModeBody(): React.ReactElement {
    return (
      <>
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
                    disabled={newSlots.length >= E2S_MAX_SLOTS}
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

          {newSlots.length === 0 ? (
            <p className="text-xs text-text-muted text-center py-8">
              Wähle links Samples aus, um sie der Bank hinzuzufügen.
            </p>
          ) : (
            <div className="space-y-1" data-testid="korg-bank-editor-list">
              {newSlots.map((slot) => (
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
                    onChange={(e) => updateNewSlot(slot.rowId, { name: e.target.value.slice(0, 16) })}
                    maxLength={16}
                    className="flex-1 min-w-[80px] bg-bg-base border border-border-color rounded px-1 py-0.5 text-text-primary"
                  />
                  <select
                    data-testid={`korg-bank-editor-cat-${slot.rowId}`}
                    value={slot.category}
                    onChange={(e) => updateNewSlot(slot.rowId, { category: Number(e.target.value) })}
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
                      onChange={(e) => updateNewSlot(slot.rowId, { oneshot: e.target.checked })}
                    />
                    1-Shot
                  </label>
                  <span className={`text-[10px] w-20 truncate ${slot.status === "error" ? "text-accent-danger" : "text-text-dim"}`}>
                    {slot.status === "ready" && slot.frames ? `${slot.frames} fr` : slot.status}
                  </span>
                  <button
                    data-testid={`korg-bank-editor-remove-${slot.rowId}`}
                    onClick={() => removeNewSlot(slot.rowId)}
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
      </>
    );
  }

  // ─── Render: Edit Mode (v3.7.0 Open-Bank-Flow) ─────────────────────────────

  function renderEditModeBody(): React.ReactElement {
    if (openedSlots.length === 0) {
      // Empty state — show Open-Bank prompt.
      return (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center space-y-3">
            <p className="text-sm text-text-muted">
              Lade eine existierende `.all` Sample-Bank zum Bearbeiten.
            </p>
            <button
              data-testid="korg-bank-editor-open"
              onClick={handleOpenBankClick}
              disabled={busy}
              className="px-4 py-2 rounded text-sm bg-accent-primary text-bg-base hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center gap-2 mx-auto"
            >
              📂 Bank öffnen
            </button>
            <p className="text-[10px] text-text-dim">
              Tipp: Du kannst auch eine `.all` Datei direkt in dieses Fenster ziehen.
            </p>
          </div>
        </div>
      );
    }

    return (
      <>
        {/* Left — Slot Browser */}
        <div className="md:w-2/5 border-r border-border-color overflow-y-auto p-2">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-text-primary">
              Slots ({filledCountOpened} belegt)
            </h3>
            <button
              data-testid="korg-bank-editor-open-another"
              onClick={handleOpenBankClick}
              disabled={busy}
              className="px-2 py-0.5 rounded text-[10px] bg-bg-elevated text-text-muted hover:text-text-primary transition-colors disabled:opacity-40"
              title="Andere Bank öffnen"
            >
              📂 Andere
            </button>
          </div>
          <ul className="space-y-0.5" data-testid="korg-bank-editor-slot-browser">
            {openedSlots.map((slot) => (
              <li key={slot.rowId}>
                <button
                  data-testid={`korg-bank-editor-slot-${slot.slotIndex}`}
                  onClick={() => setSelectedRowId(slot.rowId)}
                  className={`w-full flex items-center gap-2 px-2 py-1 rounded text-xs text-left transition-colors border ${
                    selectedRowId === slot.rowId
                      ? "border-accent-primary bg-bg-elevated"
                      : "border-transparent hover:bg-bg-elevated"
                  } ${slot.empty ? "opacity-50" : ""}`}
                >
                  <span className="font-mono text-text-dim w-10 flex-shrink-0">
                    #{slot.slotIndex}
                  </span>
                  <span className={`flex-1 truncate ${slot.empty ? "text-text-dim italic" : "text-text-primary"}`}>
                    {displayName(slot)}
                  </span>
                  {!slot.empty && (
                    <span className="text-[10px] text-text-dim w-16 truncate">
                      {displayCategory(slot)}
                    </span>
                  )}
                  {slot.isDirty && (
                    <span
                      data-testid={`korg-bank-editor-dirty-${slot.slotIndex}`}
                      className="text-[10px] text-accent-secondary flex-shrink-0"
                      title="geändert"
                    >
                      ●
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Right — Slot Detail */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {selectedSlot === null ? (
            <p className="text-xs text-text-muted text-center py-8">
              Wähle links einen Slot aus, um Details zu bearbeiten.
            </p>
          ) : selectedSlot.empty ? (
            <div data-testid="korg-bank-editor-detail-empty" className="text-center py-8 space-y-3">
              <p className="text-sm text-text-muted">
                Slot #{selectedSlot.slotIndex} ist leer.
              </p>
              {selectedSlot.original && (
                <button
                  data-testid="korg-bank-editor-revert"
                  onClick={() => editSlotRevert(selectedSlot.rowId)}
                  className="px-3 py-1 rounded text-xs bg-bg-elevated text-text-muted hover:text-text-primary transition-colors"
                >
                  ↺ Originalzustand wiederherstellen
                </button>
              )}
            </div>
          ) : (
            <div data-testid="korg-bank-editor-detail" className="space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-border-color">
                <span className="font-mono text-xs text-text-dim">Slot #{selectedSlot.slotIndex}</span>
                <div className="flex items-center gap-2">
                  {selectedSlot.isDirty && (
                    <span className="text-[10px] text-accent-secondary">● geändert</span>
                  )}
                  <button
                    data-testid="korg-bank-editor-revert"
                    onClick={() => editSlotRevert(selectedSlot.rowId)}
                    disabled={!selectedSlot.isDirty}
                    className="px-2 py-0.5 rounded text-[10px] bg-bg-elevated text-text-muted hover:text-text-primary transition-colors disabled:opacity-40"
                    title="Auf Originalzustand zurücksetzen"
                  >
                    ↺ Revert
                  </button>
                  <button
                    data-testid="korg-bank-editor-delete"
                    onClick={() => editSlotDelete(selectedSlot.rowId)}
                    className="px-2 py-0.5 rounded text-[10px] bg-bg-elevated text-text-muted hover:text-accent-danger transition-colors"
                    title="Slot leeren"
                  >
                    🗑 Löschen
                  </button>
                </div>
              </div>

              {/* Name */}
              <label className="block text-xs text-text-muted">
                Name (max 16 ASCII Zeichen)
                <input
                  data-testid="korg-bank-editor-detail-name"
                  type="text"
                  value={selectedSlot.name}
                  maxLength={16}
                  onChange={(e) =>
                    editSlotPatch(selectedSlot.rowId, { name: e.target.value.slice(0, 16) })
                  }
                  className="w-full mt-1 bg-bg-base border border-border-color rounded px-2 py-1 text-sm text-text-primary"
                />
              </label>

              {/* Category */}
              <label className="block text-xs text-text-muted">
                Category
                <select
                  data-testid="korg-bank-editor-detail-category"
                  value={selectedSlot.category}
                  onChange={(e) =>
                    editSlotPatch(selectedSlot.rowId, { category: Number(e.target.value) })
                  }
                  className="w-full mt-1 bg-bg-base border border-border-color rounded px-2 py-1 text-sm text-text-primary"
                >
                  {E2S_CATEGORY_NAMES.map((n, i) => (
                    <option key={i} value={i}>{n}</option>
                  ))}
                </select>
              </label>

              {/* Toggles */}
              <div className="flex items-center gap-4">
                <label className="text-xs text-text-muted flex items-center gap-2">
                  <input
                    data-testid="korg-bank-editor-detail-oneshot"
                    type="checkbox"
                    checked={selectedSlot.oneshot}
                    onChange={(e) =>
                      editSlotPatch(selectedSlot.rowId, { oneshot: e.target.checked })
                    }
                    className="accent-accent-primary"
                  />
                  Oneshot
                </label>
                <label className="text-xs text-text-muted flex items-center gap-2">
                  <input
                    data-testid="korg-bank-editor-detail-gain12db"
                    type="checkbox"
                    checked={selectedSlot.gain12db}
                    onChange={(e) =>
                      editSlotPatch(selectedSlot.rowId, { gain12db: e.target.checked })
                    }
                    className="accent-accent-primary"
                  />
                  +12 dB Gain
                </label>
              </div>

              {/* Sample-Tune */}
              <label className="block text-xs text-text-muted">
                Sample-Tune (Semitones): {selectedSlot.sampleTune}
                <input
                  data-testid="korg-bank-editor-detail-tune"
                  type="range"
                  min={-99}
                  max={99}
                  value={selectedSlot.sampleTune}
                  onChange={(e) =>
                    editSlotPatch(selectedSlot.rowId, { sampleTune: Number(e.target.value) })
                  }
                  className="w-full mt-1 accent-accent-primary"
                />
              </label>

              {/* Audio info + Replace */}
              <div className="text-xs text-text-muted space-y-1 pt-2 border-t border-border-color">
                <p>
                  Audio: {selectedSlot.channels === 2 ? "Stereo" : "Mono"} ·{" "}
                  {selectedSlot.sampleRate} Hz · {selectedSlot.frames} frames
                </p>
                <button
                  data-testid="korg-bank-editor-replace-sample"
                  onClick={() => handleReplaceClick(selectedSlot.rowId)}
                  disabled={busy}
                  className="px-3 py-1 rounded text-xs bg-bg-elevated text-text-primary hover:text-accent-primary transition-colors disabled:opacity-40"
                >
                  🎵 Sample ersetzen…
                </button>
              </div>

              {/* v3.8.0 — Slices */}
              {renderSliceEditor(selectedSlot)}
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
      </>
    );
  }

  // ─── Render: Slice-Editor (v3.8.0) ─────────────────────────────────────────

  function renderSliceEditor(slot: OpenedSlot): React.ReactElement | null {
    if (!slot.pcmData || !slot.sampleRate || !slot.channels || !slot.frames) {
      return null;
    }
    const mono = extractMonoChannel(slot.pcmData, slot.channels);
    // ESLI-Slice-Liste → Onset-Liste (für die Canvas-UI).
    const onsets = esliSlicesToOnsets(slot.slices);
    const sliceCount = onsets.length;

    const handleOnsetChange = (next: OnsetCandidate[]): void => {
      const eSlices = onsetsToEsliSlices(next, slot.frames ?? 0);
      editSlotSetSlices(slot.rowId, eSlices);
    };

    // v3.9.0 — Audition: Click auf eine Slice-Region → Web-Audio Playback.
    const handleAudition = (
      sliceIndex: number,
      startFrame: number,
      endFrame: number,
    ): void => {
      // Toggle: zweiter Klick auf dasselbe Slice stoppt es (kein Re-Play).
      if (
        auditionState &&
        auditionState.rowId === slot.rowId &&
        auditionState.sliceIndex === sliceIndex
      ) {
        stopCurrentAudition();
        return;
      }
      // Vorheriges Audition stoppen (kein Overlap).
      stopCurrentAudition();
      if (!slot.pcmData || !slot.channels || !slot.sampleRate) return;
      try {
        const ctx = getCtx();
        const buf = extractSliceBuffer(
          slot.pcmData,
          slot.channels,
          startFrame,
          endFrame,
        );
        if (buf.length === 0) return;
        const startedAt =
          typeof performance !== "undefined" ? performance.now() : Date.now();
        const durationMs = (buf.length / Math.max(1, slot.sampleRate)) * 1000;
        const handle = playSliceWithContext(ctx, buf, slot.sampleRate, {
          onEnded: (): void => {
            // Bei natürlichem Ende oder stop(): Audition-State leeren —
            // aber nur wenn es noch das aktuelle Audition ist.
            setAuditionState((prev) =>
              prev && prev.rowId === slot.rowId && prev.sliceIndex === sliceIndex
                ? null
                : prev,
            );
          },
        });
        if (handle) {
          auditionHandleRef.current = handle;
          setAuditionState({
            rowId: slot.rowId,
            sliceIndex,
            startedAt,
            durationMs,
          });
        }
      } catch (err) {
        console.warn("[KorgBankEditor] audition failed", err);
      }
    };

    const isPlayingThisSlot =
      auditionState !== null && auditionState.rowId === slot.rowId;

    return (
      <div
        data-testid="korg-bank-editor-slice-editor"
        className="pt-2 border-t border-border-color space-y-2"
      >
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-xs font-semibold text-text-primary flex items-center gap-2">
            <span>✂ Slices</span>
            <span
              data-testid="korg-bank-editor-slice-count"
              className="text-[10px] font-normal text-text-muted"
            >
              ({sliceCount}/{MAX_ESLI_SLICES})
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              data-testid="korg-bank-editor-slice-auto"
              onClick={() => handleAutoSlice(slot)}
              disabled={busy}
              className="px-2 py-0.5 rounded text-[10px] bg-accent-primary text-bg-base font-bold hover:opacity-90 transition-opacity disabled:opacity-40"
              title="Onset-Detection + automatische Slice-Marker setzen"
            >
              Auto-Slice
            </button>
            <button
              data-testid="korg-bank-editor-slice-clear"
              onClick={() => handleClearSlices(slot.rowId)}
              disabled={busy || sliceCount === 0}
              className="px-2 py-0.5 rounded text-[10px] bg-bg-elevated text-text-muted hover:text-accent-danger transition-colors disabled:opacity-40"
              title="Alle Slice-Marker entfernen"
            >
              Clear
            </button>
          </div>
        </div>

        <WaveformSliceCanvas
          channelData={mono}
          sampleRate={slot.sampleRate}
          onsets={onsets}
          onChange={handleOnsetChange}
          maxSlices={MAX_ESLI_SLICES}
          height={120}
          snapToZero={true}
          testId="korg-bank-editor-slice-canvas"
          className="rounded border border-border-color overflow-hidden"
          onAudition={handleAudition}
          playingSliceIndex={isPlayingThisSlot ? auditionState!.sliceIndex : null}
          playingStartedAt={isPlayingThisSlot ? auditionState!.startedAt : null}
          playingDurationMs={isPlayingThisSlot ? auditionState!.durationMs : null}
        />

        <p
          className="text-[10px] text-text-dim"
          data-testid="korg-bank-editor-slice-help"
        >
          {sliceCount > 0 ? (
            <>
              <span className="text-accent-primary font-semibold">▶ Klick auf Slice</span>
              {" "}= abspielen · Alt/Ctrl+Klick = Marker hinzufügen · Drag = verschieben ·
              Shift/Rechtsklick = entfernen · max {MAX_ESLI_SLICES} Slices
            </>
          ) : (
            <>Linksklick = Marker hinzufügen · max {MAX_ESLI_SLICES} Slices (E2S-Hardware-Limit)</>
          )}
        </p>
      </div>
    );
  }
}

export default KorgBankEditor;
