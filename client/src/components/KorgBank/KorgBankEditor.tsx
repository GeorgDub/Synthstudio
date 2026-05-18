/**
 * Synthstudio – KorgBankEditor (v3.7.0, useElectron-Refactor v3.10.0)
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
import { useElectron } from "../../../../electron/useElectron";
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
// v3.29.0 — ESX-1 Bank Pattern-Patch
import {
  parseEsxBank,
  EsxParseError,
  isEsxBuffer,
} from "@/utils/korg/esxParser";
import { buildEsxPatternBlock } from "@/utils/korg/esxPatternBuilder";
import {
  convertSynthstudioPatternToEsx,
  type SynthstudioPatternLike,
} from "@/utils/korg/esxPatternConvert";
import {
  buildEsxSampleSlotOverview,
  buildEsxSlotOverview,
  commitEsxPatchesAll,
  countPendingEsxPatches,
  countPendingEsxSamplePatches,
  filterEsxRows,
  filterEsxSampleRows,
  formatSampleLength,
  hasPendingEsxPatches,
  hasPendingEsxSamplePatches,
  stageEsxPatch,
  stageEsxSamplePatch,
  unstageEsxPatch,
  unstageEsxSamplePatch,
  type EsxSampleSlotRow,
  type EsxSamplePatchEntry,
  type EsxSlotRow,
} from "@/utils/korg/esxBankEditorState";
import { polyPhaseResample } from "@/utils/korg/audioProcessor";
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
   * v3.29.0 — Auch .esx-Files werden hier durchgereicht (ESX-Mode).
   */
  externalOpenFile?: File | null;
  /** Wird aufgerufen sobald `externalOpenFile` verarbeitet wurde — Caller kann state resetten. */
  onExternalOpenFileConsumed?: () => void;
  /**
   * v3.29.0 — Optionaler Zugriff auf das aktuell aktive Synthstudio-Pattern,
   * damit der User es in einen ESX-Slot replacen kann. Wird vom App-Root
   * durchgereicht (closure über `dm.getActivePattern()`). Wenn null/undefined
   * geliefert wird, deaktiviert sich der "Replace"-Button im ESX-Tab.
   */
  getActiveSynthPattern?: () => SynthstudioPatternLike | null;
  /** Globale BPM-Quelle (falls Pattern.bpm null ist — Fallback). */
  globalBpm?: number;
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

type EditorMode = "new" | "edit" | "esx";

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
  getActiveSynthPattern,
  globalBpm,
}: KorgBankEditorProps): React.ReactElement | null {
  const project = useProjectStore();
  const samples = project.samples;
  // v3.10.0 — Isomorpher Zugriff über useElectron() statt window.electronAPI.
  const electron = useElectron();

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

  // v3.29.0 — "esx" mode state
  const [esxBankBuffer, setEsxBankBuffer] = useState<ArrayBuffer | null>(null);
  const [esxRows, setEsxRows] = useState<EsxSlotRow[]>([]);
  const [esxPendingPatches, setEsxPendingPatches] = useState<Map<number, ArrayBuffer>>(
    () => new Map(),
  );
  const [esxSelectedSlot, setEsxSelectedSlot] = useState<number | null>(null);
  const [esxSearch, setEsxSearch] = useState<string>("");
  const [esxHideInit, setEsxHideInit] = useState<boolean>(true);
  const [esxHideEmpty, setEsxHideEmpty] = useState<boolean>(true);

  // v3.31.0 — ESX sample-tab state
  type EsxSubTab = "patterns" | "samples";
  const [esxSubTab, setEsxSubTab] = useState<EsxSubTab>("patterns");
  const [esxSampleRows, setEsxSampleRows] = useState<EsxSampleSlotRow[]>([]);
  const [esxSamplePending, setEsxSamplePending] = useState<
    Map<number, EsxSamplePatchEntry>
  >(() => new Map());
  const [esxSampleSelectedSlot, setEsxSampleSelectedSlot] = useState<number | null>(
    null,
  );
  const [esxSampleSearch, setEsxSampleSearch] = useState<string>("");
  const [esxSampleHideEmpty, setEsxSampleHideEmpty] = useState<boolean>(true);
  const [esxSampleDropTargetSlot, setEsxSampleDropTargetSlot] = useState<number | null>(
    null,
  );
  const esxSampleReplaceInputRef = useRef<HTMLInputElement | null>(null);
  const esxSampleReplaceTargetSlotRef = useRef<number | null>(null);

  // Shared
  const [busy, setBusy] = useState<boolean>(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const esxFileInputRef = useRef<HTMLInputElement | null>(null);

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
      // v3.29.0 — auch ESX-State zurücksetzen
      setEsxBankBuffer(null);
      setEsxRows([]);
      setEsxPendingPatches(new Map());
      setEsxSelectedSlot(null);
      setEsxSearch("");
      // v3.31.0 — Sample-Tab-State zurücksetzen
      setEsxSubTab("patterns");
      setEsxSampleRows([]);
      setEsxSamplePending(new Map());
      setEsxSampleSelectedSlot(null);
      setEsxSampleSearch("");
      setEsxSampleDropTargetSlot(null);
      esxSampleReplaceTargetSlotRef.current = null;
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
    // Detect "dirty" state in the *outgoing* mode and prompt before discarding.
    let hasChanges = false;
    if (mode === "new") {
      hasChanges = newSlots.length > 0;
    } else if (mode === "edit") {
      hasChanges = hasUnsavedChanges(openedSlots) || openedSlots.length > 0;
    } else if (mode === "esx") {
      hasChanges =
        hasPendingEsxPatches(esxPendingPatches) ||
        hasPendingEsxSamplePatches(esxSamplePending) ||
        esxBankBuffer !== null;
    }
    if (hasChanges) {
      const ok = window.confirm(
        "Ungespeicherte Änderungen gehen verloren. Trotzdem Modus wechseln?",
      );
      if (!ok) return;
    }
    // Clear the outgoing mode's state so re-entering starts fresh.
    if (mode === "new") {
      setNewSlots([]);
    } else if (mode === "edit") {
      setOpenedSlots([]);
      setOpenedSourceName("");
      setSelectedRowId(null);
    } else if (mode === "esx") {
      setEsxBankBuffer(null);
      setEsxRows([]);
      setEsxPendingPatches(new Map());
      setEsxSelectedSlot(null);
      setEsxSearch("");
      // v3.31.0 — auch Sample-Tab-State zurücksetzen
      setEsxSubTab("patterns");
      setEsxSampleRows([]);
      setEsxSamplePending(new Map());
      setEsxSampleSelectedSlot(null);
      setEsxSampleSearch("");
      setEsxSampleDropTargetSlot(null);
    }
    setResultMsg(null);
    setMode(next);
  }

  // ─── Open Existing Bank ────────────────────────────────────────────────────

  // v3.29.0 — Lädt eine .esx ESX-1 Bank in den ESX-Pattern-Mode.
  const loadEsxBankFromFile = useCallback(async (file: File): Promise<void> => {
    if (!requireProFeature(PRO_FEATURE_KORG_BANK_WRITE)) return;
    if (file.size === 0) {
      toast("Datei ist leer.", { kind: "error" });
      return;
    }
    setBusy(true);
    setResultMsg("Lade ESX-Bank...");
    try {
      const ab = await file.arrayBuffer();
      if (!isEsxBuffer(ab)) {
        toast(
          "Kein gültiges ESX-1-Format (KORG/ESX-Magic fehlt).",
          { kind: "error", duration: 5000 },
        );
        setBusy(false);
        setResultMsg(null);
        return;
      }
      const bank = parseEsxBank(ab, file.name);
      const rows = buildEsxSlotOverview(bank);
      const sampleRows = buildEsxSampleSlotOverview(bank);
      setEsxBankBuffer(ab);
      setEsxRows(rows);
      setEsxSampleRows(sampleRows);
      setEsxPendingPatches(new Map());
      setEsxSamplePending(new Map());
      setEsxSelectedSlot(null);
      setEsxSampleSelectedSlot(null);
      setEsxSubTab("patterns");
      setMode("esx");
      // Filename default for save: original name (user can rename).
      const baseName = file.name.replace(/\.[^.]+$/, "");
      const safeName = baseName.replace(/[^A-Za-z0-9._-]/g, "_");
      setFilename(`${safeName}.esx`);
      const filledRows = rows.filter((r) => !r.empty).length;
      toast(
        `ESX-Bank geladen: ${filledRows}/256 Pattern — ${bank.warnings.length} Warnungen`,
        { kind: "success", duration: 4000 },
      );
      setResultMsg(`${filledRows} Pattern bereit — wähle einen Slot zum Ersetzen.`);
    } catch (err) {
      const msg =
        err instanceof EsxParseError ? err.message :
        err instanceof Error ? err.message : String(err);
      toast(`Fehler beim Laden: ${msg}`, { kind: "error", duration: 6000 });
      setResultMsg(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const loadBankFromFile = useCallback(async (file: File): Promise<void> => {
    if (!requireProFeature(PRO_FEATURE_KORG_BANK_WRITE)) return;
    if (file.size === 0) {
      toast("Datei ist leer.", { kind: "error" });
      return;
    }
    // v3.29.0 — .esx → ESX-Mode, .all (default) → E2-Edit-Mode.
    if (file.name.toLowerCase().endsWith(".esx")) {
      await loadEsxBankFromFile(file);
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
  }, [loadEsxBankFromFile]);

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

  // ─── ESX-Pattern-Mode Operations (v3.29.0) ─────────────────────────────────

  function handleOpenEsxBankClick(): void {
    if (!requireProFeature(PRO_FEATURE_KORG_BANK_WRITE)) return;
    esxFileInputRef.current?.click();
  }

  function handleEsxBankFileInput(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting same file
    if (f) loadEsxBankFromFile(f);
  }

  function handleEsxReplaceSlot(slotIndex: number): void {
    if (!requireProFeature(PRO_FEATURE_KORG_BANK_WRITE)) return;
    if (!getActiveSynthPattern) {
      toast("Kein aktives Synthstudio-Pattern verfügbar.", { kind: "warning" });
      return;
    }
    const current = getActiveSynthPattern();
    if (!current) {
      toast("Kein aktives Synthstudio-Pattern.", { kind: "warning" });
      return;
    }
    try {
      // Apply BPM fallback if pattern.bpm is null/undefined.
      const patched: SynthstudioPatternLike =
        current.bpm == null && typeof globalBpm === "number"
          ? { ...current, bpm: globalBpm }
          : current;
      const esxInput = convertSynthstudioPatternToEsx(patched);
      const block = buildEsxPatternBlock(esxInput);
      setEsxPendingPatches((prev) => stageEsxPatch(prev, slotIndex, block));
      // Update overview row so the UI immediately reflects the new name/bpm.
      setEsxRows((prev) =>
        prev.map((r) =>
          r.index === slotIndex
            ? {
                index: slotIndex,
                empty: false,
                name: (patched.name ?? "").slice(0, 8),
                bpm:
                  typeof patched.bpm === "number" && Number.isFinite(patched.bpm)
                    ? patched.bpm
                    : 120,
                stepLength: patched.stepCount ?? 16,
              }
            : r,
        ),
      );
      toast(
        `Slot #${slotIndex} mit "${(patched.name ?? "").slice(0, 8) || "(unnamed)"}" ersetzt`,
        { kind: "success", duration: 2500 },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Fehler beim Ersetzen: ${msg}`, { kind: "error" });
    }
  }

  function handleEsxRevertSlot(slotIndex: number): void {
    setEsxPendingPatches((prev) => unstageEsxPatch(prev, slotIndex));
    // Refresh overview row from the (untouched) loaded bank by re-parsing —
    // cheap because parseEsxPattern is per-slot, but we already have the
    // pre-load snapshot in esxRows pre-stage. Simpler: re-build rows from the
    // original buffer.
    if (esxBankBuffer) {
      try {
        const bank = parseEsxBank(esxBankBuffer);
        const rows = buildEsxSlotOverview(bank);
        // Preserve any *other* still-staged slots' overview rows so the user
        // doesn't see them flicker back to the original.
        setEsxRows((prev) =>
          rows.map((r) => {
            if (esxPendingPatches.has(r.index) && r.index !== slotIndex) {
              const old = prev.find((p) => p.index === r.index);
              return old ?? r;
            }
            return r;
          }),
        );
      } catch {
        /* keep existing rows */
      }
    }
  }

  async function handleEsxSaveBank(): Promise<void> {
    if (!requireProFeature(PRO_FEATURE_KORG_BANK_WRITE)) return;
    if (!esxBankBuffer) {
      toast("Keine ESX-Bank geladen.", { kind: "warning" });
      return;
    }
    const patchCount = countPendingEsxPatches(esxPendingPatches);
    const sampleCount = countPendingEsxSamplePatches(esxSamplePending);
    if (patchCount === 0 && sampleCount === 0) {
      toast("Keine Slots zum Speichern modifiziert.", { kind: "warning" });
      return;
    }
    const summaryParts: string[] = [];
    if (patchCount > 0) summaryParts.push(`${patchCount} Pattern-Slot(s)`);
    if (sampleCount > 0) summaryParts.push(`${sampleCount} Sample-Slot(s)`);
    const ok = window.confirm(
      `${summaryParts.join(" + ")} wurden geändert.\n` +
        `Alle anderen Slots, Sample-Daten und Song-Daten bleiben bit-exakt erhalten.\n\n` +
        `Bank speichern?`,
    );
    if (!ok) return;
    setBusy(true);
    setResultMsg("Schreibe ESX-Bank...");
    try {
      const newBuffer = commitEsxPatchesAll(
        esxBankBuffer,
        esxPendingPatches,
        esxSamplePending,
      );
      const safeName = filename.replace(/[^A-Za-z0-9._-]/g, "_");
      const finalName = safeName.toLowerCase().endsWith(".esx")
        ? safeName
        : `${safeName}.esx`;
      const summaryMsg = summaryParts.join(" + ") + " geändert";
      if (electron.isElectron) {
        const result = await electron.saveEsxBankAs(finalName, newBuffer);
        if (!result.success) {
          if (result.error === "canceled") {
            setResultMsg(null);
            return;
          }
          toast(`Fehler beim Speichern: ${result.error}`, { kind: "error" });
          setResultMsg(null);
          return;
        }
        toast(
          `ESX-Bank gespeichert: ${result.filePath} (${summaryMsg})`,
          { kind: "success", duration: 4000 },
        );
        setResultMsg(`Gespeichert: ${result.filePath}`);
        // Update working copy + clear pending patches.
        setEsxBankBuffer(newBuffer);
        setEsxPendingPatches(new Map());
        setEsxSamplePending(new Map());
      } else {
        const blob = new Blob([newBuffer], { type: "application/octet-stream" });
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
        toast(
          `ESX-Bank heruntergeladen: ${finalName} (${summaryMsg})`,
          { kind: "success", duration: 4000 },
        );
        setResultMsg(`Download: ${finalName}`);
        setEsxBankBuffer(newBuffer);
        setEsxPendingPatches(new Map());
        setEsxSamplePending(new Map());
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Speichern fehlgeschlagen: ${msg}`, { kind: "error", duration: 6000 });
      setResultMsg(null);
    } finally {
      setBusy(false);
    }
  }

  // ─── ESX-Sample-Mode Operations (v3.31.0) ──────────────────────────────────

  /**
   * Decodes a WAV/AIFF/MP3 file, resamples to 44100 Hz (ESX-target), and
   * returns Float32 mono PCM. Stereo files are downmixed to mono (channel 0 +
   * channel 1 averaged) — v3.31 fokussiert auf mono. v3.32 wird stereo
   * unterstützen.
   */
  async function decodeWavForEsxSample(file: File): Promise<{
    pcm: Float32Array;
    sampleRate: number;
    channels: 1;
    name: string;
  }> {
    const ab = await file.arrayBuffer();
    const ctx = getCtx();
    const buf = await ctx.decodeAudioData(ab.slice(0));
    const numCh = buf.numberOfChannels;
    const frames = buf.length;
    // Downmix to mono.
    let mono: Float32Array;
    if (numCh === 1) {
      mono = new Float32Array(buf.getChannelData(0));
    } else {
      const l = buf.getChannelData(0);
      const r = buf.getChannelData(Math.min(1, numCh - 1));
      mono = new Float32Array(frames);
      for (let i = 0; i < frames; i++) mono[i] = (l[i] + r[i]) * 0.5;
    }
    // Resample to 44100 Hz (ESX-1 target rate).
    const ESX_TARGET_SR = 44100;
    if (buf.sampleRate !== ESX_TARGET_SR) {
      mono = polyPhaseResample(mono, buf.sampleRate, ESX_TARGET_SR, 1);
    }
    // Strip extension from filename for the slot-name.
    const baseName = file.name.replace(/\.[^.]+$/, "");
    return { pcm: mono, sampleRate: ESX_TARGET_SR, channels: 1, name: baseName };
  }

  function handleEsxSampleReplaceClick(slot: number): void {
    if (!requireProFeature(PRO_FEATURE_KORG_BANK_WRITE)) return;
    esxSampleReplaceTargetSlotRef.current = slot;
    esxSampleReplaceInputRef.current?.click();
  }

  async function handleEsxSampleReplaceInput(
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const f = e.target.files?.[0];
    e.target.value = "";
    const slot = esxSampleReplaceTargetSlotRef.current;
    esxSampleReplaceTargetSlotRef.current = null;
    if (!f || slot == null) return;
    await replaceEsxSampleSlot(slot, f);
  }

  async function replaceEsxSampleSlot(slot: number, file: File): Promise<void> {
    setBusy(true);
    try {
      const decoded = await decodeWavForEsxSample(file);
      const entry: EsxSamplePatchEntry = {
        pcmData: decoded.pcm,
        sampleRate: decoded.sampleRate,
        channels: decoded.channels,
        name: decoded.name.slice(0, 8),
        level: 100,
      };
      setEsxSamplePending((prev) => stageEsxSamplePatch(prev, slot, entry));
      setEsxSampleRows((prev) =>
        prev.map((r) =>
          r.index === slot
            ? {
                index: slot,
                empty: false,
                name: decoded.name.slice(0, 8),
                channels: 1,
                sampleRate: decoded.sampleRate,
                frames: decoded.pcm.length,
                level: 100,
              }
            : r,
        ),
      );
      toast(
        `Slot #${slot} → "${decoded.name.slice(0, 8) || "(unnamed)"}" (${decoded.pcm.length} frames)`,
        { kind: "success", duration: 2500 },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Fehler beim Replace: ${msg}`, { kind: "error", duration: 5000 });
    } finally {
      setBusy(false);
    }
  }

  function handleEsxSampleRevertSlot(slot: number): void {
    setEsxSamplePending((prev) => unstageEsxSamplePatch(prev, slot));
    // Refresh row from the (untouched) loaded bank by re-parsing.
    if (esxBankBuffer) {
      try {
        const bank = parseEsxBank(esxBankBuffer);
        const rows = buildEsxSampleSlotOverview(bank);
        setEsxSampleRows((prev) =>
          rows.map((r) => {
            if (esxSamplePending.has(r.index) && r.index !== slot) {
              const old = prev.find((p) => p.index === r.index);
              return old ?? r;
            }
            return r;
          }),
        );
      } catch {
        /* keep existing rows */
      }
    }
  }

  function handleEsxSampleDragOver(
    e: React.DragEvent<HTMLLIElement>,
    slot: number,
  ): void {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setEsxSampleDropTargetSlot(slot);
  }

  function handleEsxSampleDragLeave(): void {
    setEsxSampleDropTargetSlot(null);
  }

  async function handleEsxSampleDrop(
    e: React.DragEvent<HTMLLIElement>,
    slot: number,
  ): Promise<void> {
    e.preventDefault();
    setEsxSampleDropTargetSlot(null);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await replaceEsxSampleSlot(slot, file);
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

      const safeName = filename.replace(/[^A-Za-z0-9._-]/g, "_");
      const finalName = safeName.endsWith(".all") ? safeName : `${safeName}.all`;

      if (electron.isElectron) {
        const saveResult = await electron.saveKorgBankAs(finalName, buf);
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

  // v3.29.0 — ESX-Mode computed
  const esxFilledCount = useMemo(
    () => esxRows.filter((r) => !r.empty).length,
    [esxRows],
  );
  const esxPendingCount = useMemo(
    () => countPendingEsxPatches(esxPendingPatches),
    [esxPendingPatches],
  );
  const esxVisibleRows = useMemo(
    () => filterEsxRows(esxRows, esxSearch, esxHideInit, esxHideEmpty),
    [esxRows, esxSearch, esxHideInit, esxHideEmpty],
  );
  const esxSelectedRow = useMemo(
    () => (esxSelectedSlot == null ? null : esxRows.find((r) => r.index === esxSelectedSlot) ?? null),
    [esxRows, esxSelectedSlot],
  );

  // v3.31.0 — Sample-Tab computed
  const esxSampleFilledCount = useMemo(
    () => esxSampleRows.filter((r) => !r.empty).length,
    [esxSampleRows],
  );
  const esxSamplePendingCount = useMemo(
    () => countPendingEsxSamplePatches(esxSamplePending),
    [esxSamplePending],
  );
  const esxSampleVisibleRows = useMemo(
    () => filterEsxSampleRows(esxSampleRows, esxSampleSearch, esxSampleHideEmpty),
    [esxSampleRows, esxSampleSearch, esxSampleHideEmpty],
  );
  const esxSampleSelectedRow = useMemo(
    () =>
      esxSampleSelectedSlot == null
        ? null
        : esxSampleRows.find((r) => r.index === esxSampleSelectedSlot) ?? null,
    [esxSampleRows, esxSampleSelectedSlot],
  );
  const esxTotalPendingCount = esxPendingCount + esxSamplePendingCount;

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
              {mode === "esx" ? "KORG ESX-1 Bank" : "KORG E2 Sample-Bank"}
              <ProLockBadge feature={PRO_FEATURE_KORG_BANK_WRITE} />
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              {mode === "new"
                ? `Erstelle neue Bank · ${newSlots.length}/${E2S_MAX_SLOTS} Slots · ${(totalBytesNew / 1024 / 1024).toFixed(1)} MB PCM`
                : mode === "edit"
                  ? `Editiere ${openedSourceName || "Bank"} · ${filledCountOpened}/${E2S_MAX_SLOTS} Slots · ${dirtyCountOpened} geändert`
                  : esxBankBuffer
                    ? `ESX Bank-Edit · ${esxFilledCount}/256 Pat · ${esxSampleFilledCount}/256 Smp · ${esxTotalPendingCount} geändert`
                    : "ESX Bank-Edit · keine Bank geladen"}
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
            <button
              role="tab"
              data-testid="korg-bank-editor-mode-esx"
              aria-selected={mode === "esx"}
              onClick={() => tryChangeMode("esx")}
              disabled={busy}
              className={`px-3 py-1 transition-colors disabled:opacity-40 ${
                mode === "esx"
                  ? "bg-accent-primary text-bg-base"
                  : "bg-bg-elevated text-text-muted hover:text-text-primary"
              }`}
              title="KORG ESX-1 Pattern Bank-Patch"
            >
              ESX Patterns
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
        {/* v3.29.0 — ESX-Bank file picker */}
        <input
          ref={esxFileInputRef}
          data-testid="korg-bank-editor-esx-open-input"
          type="file"
          accept=".esx,.ESX"
          className="hidden"
          onChange={handleEsxBankFileInput}
        />
        {/* v3.31.0 — ESX-Sample WAV picker */}
        <input
          ref={esxSampleReplaceInputRef}
          data-testid="korg-bank-editor-esx-sample-replace-input"
          type="file"
          accept=".wav,.aiff,.aif,.mp3,audio/*"
          className="hidden"
          onChange={handleEsxSampleReplaceInput}
        />

        {/* Body */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          {mode === "new"
            ? renderNewModeBody()
            : mode === "edit"
              ? renderEditModeBody()
              : renderEsxModeBody()}
        </div>

        {/* Footer */}
        <footer className="px-4 py-3 border-t border-border-color flex items-center justify-between flex-shrink-0 gap-2 flex-wrap">
          <p className="text-xs text-text-muted">
            {mode === "new"
              ? `Total: ${newSlots.length} Slots · ${(totalBytesNew / 1024 / 1024).toFixed(2)} MB PCM`
              : mode === "edit"
                ? `${filledCountOpened} Slots · ${dirtyCountOpened} geändert / ${filledCountOpened - dirtyCountOpened} bit-exakt`
                : esxBankBuffer
                  ? `${esxFilledCount}/256 Pat · ${esxSampleFilledCount}/256 Smp · ${esxTotalPendingCount} Patch(es) ausstehend · Rest bit-exakt`
                  : "Keine ESX-Bank geladen"}
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
            {mode === "esx" ? (
              <button
                data-testid="korg-bank-editor-esx-save"
                onClick={handleEsxSaveBank}
                disabled={busy || !esxBankBuffer || esxTotalPendingCount === 0}
                className="px-3 py-1 rounded text-xs bg-accent-primary text-bg-base hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center gap-2"
              >
                {busy ? "Speichere..." : "Als .esx speichern"}
                <ProLockBadge feature={PRO_FEATURE_KORG_BANK_WRITE} />
              </button>
            ) : (
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
            )}
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

  // ─── Render: ESX-Pattern-Patch + Sample-Patch Mode (v3.29.0, v3.31.0) ──────

  function renderEsxModeBody(): React.ReactElement {
    if (!esxBankBuffer) {
      return (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center space-y-3">
            <p className="text-sm text-text-muted">
              Lade eine existierende <code className="text-text-primary">.esx</code>{" "}
              ESX-1 Bank (KORG ESX-1 Backup).
            </p>
            <p className="text-xs text-text-dim">
              Du kannst einzelne Pattern- oder Sample-Slots ersetzen. Alles
              andere (Songs, Globals, andere Slots) bleibt bit-exakt erhalten.
            </p>
            <button
              data-testid="korg-bank-editor-esx-open"
              onClick={handleOpenEsxBankClick}
              disabled={busy}
              className="px-4 py-2 rounded text-sm bg-accent-primary text-bg-base hover:opacity-90 transition-opacity disabled:opacity-40 inline-flex items-center gap-2"
            >
              📂 ESX-Bank öffnen
            </button>
            <p className="text-[10px] text-text-dim">
              Tipp: Du kannst auch eine <code>.esx</code>-Datei direkt in dieses
              Fenster ziehen.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="flex-1 flex flex-col min-h-0">
        {/* Sub-Tab Toggle (Patterns | Samples) */}
        <div
          data-testid="korg-bank-editor-esx-subtab-toggle"
          role="tablist"
          className="flex items-center gap-2 px-3 py-2 border-b border-border-color"
        >
          <button
            role="tab"
            data-testid="korg-bank-editor-esx-subtab-patterns"
            aria-selected={esxSubTab === "patterns"}
            onClick={() => setEsxSubTab("patterns")}
            disabled={busy}
            className={`px-3 py-1 rounded text-xs transition-colors disabled:opacity-40 ${
              esxSubTab === "patterns"
                ? "bg-accent-primary text-bg-base"
                : "bg-bg-elevated text-text-muted hover:text-text-primary"
            }`}
          >
            Patterns
            {esxPendingCount > 0 && (
              <span className="ml-1 text-[10px] text-accent-danger">
                ●{esxPendingCount}
              </span>
            )}
          </button>
          <button
            role="tab"
            data-testid="korg-bank-editor-esx-subtab-samples"
            aria-selected={esxSubTab === "samples"}
            onClick={() => setEsxSubTab("samples")}
            disabled={busy}
            className={`px-3 py-1 rounded text-xs transition-colors disabled:opacity-40 ${
              esxSubTab === "samples"
                ? "bg-accent-primary text-bg-base"
                : "bg-bg-elevated text-text-muted hover:text-text-primary"
            }`}
          >
            Samples (Mono)
            {esxSamplePendingCount > 0 && (
              <span className="ml-1 text-[10px] text-accent-danger">
                ●{esxSamplePendingCount}
              </span>
            )}
          </button>
          <span className="text-[10px] text-text-dim ml-auto">
            Stereo-Samples folgen in v3.32
          </span>
        </div>

        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          {esxSubTab === "patterns" ? renderEsxPatternsBody() : renderEsxSamplesBody()}
        </div>
      </div>
    );
  }

  function renderEsxPatternsBody(): React.ReactElement {
    return (
      <>
        {/* Left — Pattern-Slot-Liste mit Filter */}
        <div className="md:w-2/5 border-r border-border-color overflow-y-auto p-2 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-xs font-semibold text-text-primary">
              Pattern-Slots ({esxVisibleRows.length}/{esxRows.length})
            </h3>
            <button
              data-testid="korg-bank-editor-esx-open-another"
              onClick={handleOpenEsxBankClick}
              disabled={busy}
              className="px-2 py-0.5 rounded text-[10px] bg-bg-elevated text-text-muted hover:text-text-primary transition-colors disabled:opacity-40"
              title="Andere .esx-Bank öffnen"
            >
              📂 Andere
            </button>
          </div>

          {/* Filter row */}
          <div className="flex items-center gap-2 flex-wrap">
            <input
              data-testid="korg-bank-editor-esx-search"
              type="text"
              placeholder="Suchen (Name oder Index)"
              value={esxSearch}
              onChange={(e) => setEsxSearch(e.target.value)}
              className="flex-1 min-w-[120px] bg-bg-elevated border border-border-color rounded text-xs px-2 py-0.5 text-text-primary placeholder:text-text-dim"
            />
            <label className="text-[10px] text-text-muted flex items-center gap-1">
              <input
                data-testid="korg-bank-editor-esx-hide-init"
                type="checkbox"
                checked={esxHideInit}
                onChange={(e) => setEsxHideInit(e.target.checked)}
                className="accent-accent-primary"
              />
              Init verbergen
            </label>
            <label className="text-[10px] text-text-muted flex items-center gap-1">
              <input
                data-testid="korg-bank-editor-esx-hide-empty"
                type="checkbox"
                checked={esxHideEmpty}
                onChange={(e) => setEsxHideEmpty(e.target.checked)}
                className="accent-accent-primary"
              />
              Leere verbergen
            </label>
          </div>

          <ul
            className="space-y-0.5 flex-1 min-h-0"
            data-testid="korg-bank-editor-esx-slot-list"
          >
            {esxVisibleRows.length === 0 ? (
              <li className="text-xs text-text-dim italic py-4 text-center">
                Keine Slots passen zu deinem Filter.
              </li>
            ) : (
              esxVisibleRows.map((r) => {
                const dirty = esxPendingPatches.has(r.index);
                const selected = esxSelectedSlot === r.index;
                return (
                  <li key={r.index}>
                    <button
                      data-testid={`korg-bank-editor-esx-slot-${r.index}`}
                      onClick={() => setEsxSelectedSlot(r.index)}
                      className={`w-full flex items-center gap-2 px-2 py-1 rounded text-xs text-left transition-colors border ${
                        selected
                          ? "border-accent-primary bg-bg-elevated"
                          : "border-transparent hover:bg-bg-elevated"
                      } ${r.empty && !dirty ? "opacity-50" : ""}`}
                    >
                      <span className="font-mono text-text-dim w-10 flex-shrink-0">
                        #{r.index.toString().padStart(3, "0")}
                      </span>
                      <span
                        className={`flex-1 truncate ${
                          r.empty && !dirty
                            ? "text-text-dim italic"
                            : "text-text-primary"
                        }`}
                      >
                        {r.empty && !dirty ? "(empty)" : r.name || "(unnamed)"}
                      </span>
                      {!r.empty && (
                        <span className="text-[10px] text-text-dim w-16 truncate text-right">
                          {r.bpm > 0 ? `${r.bpm.toFixed(1)} BPM` : ""}
                        </span>
                      )}
                      {dirty && (
                        <span
                          data-testid={`korg-bank-editor-esx-dirty-${r.index}`}
                          className="text-[10px] text-accent-danger flex-shrink-0"
                          title="Slot wird beim Speichern überschrieben"
                        >
                          ●
                        </span>
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>

        {/* Right — Slot-Detail + Replace Action */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {esxSelectedRow === null ? (
            <p className="text-xs text-text-muted text-center py-8">
              Wähle links einen Pattern-Slot aus, um ihn mit dem aktuellen
              Synthstudio-Pattern zu ersetzen.
            </p>
          ) : (
            <div
              data-testid="korg-bank-editor-esx-detail"
              className="space-y-3"
            >
              <div className="flex items-center justify-between pb-2 border-b border-border-color">
                <span className="font-mono text-xs text-text-dim">
                  Slot #{esxSelectedRow.index.toString().padStart(3, "0")}
                </span>
                {esxPendingPatches.has(esxSelectedRow.index) && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-accent-danger">
                      ● wird ersetzt
                    </span>
                    <button
                      data-testid="korg-bank-editor-esx-revert"
                      onClick={() => handleEsxRevertSlot(esxSelectedRow.index)}
                      className="px-2 py-0.5 rounded text-[10px] bg-bg-elevated text-text-muted hover:text-text-primary transition-colors"
                      title="Patch verwerfen — Originalslot wiederherstellen"
                    >
                      ↺ Revert
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-1 text-xs text-text-muted">
                <p>
                  <span className="text-text-dim">Name:</span>{" "}
                  <span className="text-text-primary font-medium">
                    {esxSelectedRow.empty
                      ? "(empty)"
                      : esxSelectedRow.name || "(unnamed)"}
                  </span>
                </p>
                {!esxSelectedRow.empty && (
                  <>
                    <p>
                      <span className="text-text-dim">BPM:</span>{" "}
                      <span className="text-text-primary">
                        {esxSelectedRow.bpm.toFixed(1)}
                      </span>
                    </p>
                    <p>
                      <span className="text-text-dim">Step-Length:</span>{" "}
                      <span className="text-text-primary">
                        {esxSelectedRow.stepLength}
                      </span>
                    </p>
                  </>
                )}
              </div>

              <div className="pt-2 border-t border-border-color space-y-2">
                <p className="text-xs text-text-muted">
                  Den Slot mit dem aktuell aktiven Synthstudio-Pattern
                  ersetzen.
                </p>
                <button
                  data-testid="korg-bank-editor-esx-replace"
                  onClick={() => handleEsxReplaceSlot(esxSelectedRow.index)}
                  disabled={busy || !getActiveSynthPattern}
                  className="w-full px-3 py-2 rounded text-sm bg-accent-primary text-bg-base hover:opacity-90 transition-opacity disabled:opacity-40 inline-flex items-center justify-center gap-2"
                  title={
                    getActiveSynthPattern
                      ? "Slot mit aktuellem Synthstudio-Pattern überschreiben"
                      : "Kein Pattern verfügbar"
                  }
                >
                  ↻ Mit aktuellem Pattern ersetzen
                </button>
                {!getActiveSynthPattern && (
                  <p className="text-[10px] text-text-dim italic">
                    Kein Synthstudio-Pattern verfügbar.
                  </p>
                )}
              </div>

              {/* Dateiname */}
              <div className="pt-2 border-t border-border-color">
                <label className="block text-xs text-text-muted">
                  Dateiname beim Speichern
                  <input
                    data-testid="korg-bank-editor-esx-filename"
                    type="text"
                    value={filename}
                    onChange={(e) => setFilename(e.target.value)}
                    className="w-full mt-1 bg-bg-base border border-border-color rounded px-2 py-1 text-sm text-text-primary"
                  />
                </label>
              </div>
            </div>
          )}

          {resultMsg && (
            <p
              data-testid="korg-bank-editor-esx-status"
              className="text-xs text-text-muted pt-2 border-t border-border-color"
            >
              {resultMsg}
            </p>
          )}
        </div>
      </>
    );
  }

  // ─── Render: ESX-Sample-Patch Sub-Tab (v3.31.0) ────────────────────────────

  function renderEsxSamplesBody(): React.ReactElement {
    return (
      <>
        {/* Left — Sample-Slot-Liste mit Filter */}
        <div className="md:w-2/5 border-r border-border-color overflow-y-auto p-2 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-xs font-semibold text-text-primary">
              Mono-Sample-Slots ({esxSampleVisibleRows.length}/{esxSampleRows.length})
            </h3>
          </div>

          {/* Filter row */}
          <div className="flex items-center gap-2 flex-wrap">
            <input
              data-testid="korg-bank-editor-esx-sample-search"
              type="text"
              placeholder="Suchen (Name oder Index)"
              value={esxSampleSearch}
              onChange={(e) => setEsxSampleSearch(e.target.value)}
              className="flex-1 min-w-[120px] bg-bg-elevated border border-border-color rounded text-xs px-2 py-0.5 text-text-primary placeholder:text-text-dim"
            />
            <label className="text-[10px] text-text-muted flex items-center gap-1">
              <input
                data-testid="korg-bank-editor-esx-sample-hide-empty"
                type="checkbox"
                checked={esxSampleHideEmpty}
                onChange={(e) => setEsxSampleHideEmpty(e.target.checked)}
                className="accent-accent-primary"
              />
              Leere verbergen
            </label>
          </div>

          <ul
            className="space-y-0.5 flex-1 min-h-0"
            data-testid="korg-bank-editor-esx-sample-list"
          >
            {esxSampleVisibleRows.length === 0 ? (
              <li className="text-xs text-text-dim italic py-4 text-center">
                Keine Sample-Slots passen zu deinem Filter.
              </li>
            ) : (
              esxSampleVisibleRows.map((r) => {
                const dirty = esxSamplePending.has(r.index);
                const selected = esxSampleSelectedSlot === r.index;
                const isDropTarget = esxSampleDropTargetSlot === r.index;
                return (
                  <li
                    key={r.index}
                    onDragOver={(e) => handleEsxSampleDragOver(e, r.index)}
                    onDragLeave={handleEsxSampleDragLeave}
                    onDrop={(e) => handleEsxSampleDrop(e, r.index)}
                  >
                    <button
                      data-testid={`korg-bank-editor-esx-sample-slot-${r.index}`}
                      onClick={() => setEsxSampleSelectedSlot(r.index)}
                      className={`w-full flex items-center gap-2 px-2 py-1 rounded text-xs text-left transition-colors border ${
                        selected
                          ? "border-accent-primary bg-bg-elevated"
                          : isDropTarget
                            ? "border-accent-success bg-bg-elevated"
                            : "border-transparent hover:bg-bg-elevated"
                      } ${r.empty && !dirty ? "opacity-50" : ""}`}
                    >
                      <span className="font-mono text-text-dim w-10 flex-shrink-0">
                        #{r.index.toString().padStart(3, "0")}
                      </span>
                      <span
                        className={`flex-1 truncate ${
                          r.empty && !dirty
                            ? "text-text-dim italic"
                            : "text-text-primary"
                        }`}
                      >
                        {r.empty && !dirty ? "—Empty—" : r.name || "(unnamed)"}
                      </span>
                      {!r.empty && (
                        <span className="text-[10px] text-text-dim w-16 truncate text-right">
                          {formatSampleLength(r.frames, r.sampleRate)}
                        </span>
                      )}
                      {dirty && (
                        <span
                          data-testid={`korg-bank-editor-esx-sample-dirty-${r.index}`}
                          className="text-[10px] text-accent-danger flex-shrink-0"
                          title="Slot wird beim Speichern überschrieben"
                        >
                          ●
                        </span>
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>

        {/* Right — Sample-Slot-Detail */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {esxSampleSelectedRow === null ? (
            <p
              data-testid="korg-bank-editor-esx-sample-no-selection"
              className="text-xs text-text-muted text-center py-8"
            >
              Wähle links einen Sample-Slot aus, um ihn mit einer WAV-Datei zu
              ersetzen.
              <br />
              <span className="text-[10px] text-text-dim">
                Tipp: Du kannst auch eine WAV-Datei direkt auf einen Slot ziehen.
              </span>
            </p>
          ) : (
            <div
              data-testid="korg-bank-editor-esx-sample-detail"
              className="space-y-3"
            >
              <div className="flex items-center justify-between pb-2 border-b border-border-color">
                <span className="font-mono text-xs text-text-dim">
                  Mono-Sample-Slot #{esxSampleSelectedRow.index.toString().padStart(3, "0")}
                </span>
                {esxSamplePending.has(esxSampleSelectedRow.index) && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-accent-danger">
                      ● wird ersetzt
                    </span>
                    <button
                      data-testid="korg-bank-editor-esx-sample-revert"
                      onClick={() => handleEsxSampleRevertSlot(esxSampleSelectedRow.index)}
                      className="px-2 py-0.5 rounded text-[10px] bg-bg-elevated text-text-muted hover:text-text-primary transition-colors"
                      title="Patch verwerfen — Originalslot wiederherstellen"
                    >
                      ↺ Revert
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-1 text-xs text-text-muted">
                <p>
                  <span className="text-text-dim">Name:</span>{" "}
                  <span className="text-text-primary font-medium">
                    {esxSampleSelectedRow.empty
                      ? "—Empty—"
                      : esxSampleSelectedRow.name || "(unnamed)"}
                  </span>
                </p>
                {!esxSampleSelectedRow.empty && (
                  <>
                    <p>
                      <span className="text-text-dim">Channels:</span>{" "}
                      <span className="text-text-primary">
                        {esxSampleSelectedRow.channels === 1 ? "Mono" : "Stereo"}
                      </span>
                    </p>
                    <p>
                      <span className="text-text-dim">Sample-Rate:</span>{" "}
                      <span className="text-text-primary">
                        {esxSampleSelectedRow.sampleRate} Hz
                      </span>
                    </p>
                    <p>
                      <span className="text-text-dim">Länge:</span>{" "}
                      <span className="text-text-primary">
                        {formatSampleLength(
                          esxSampleSelectedRow.frames,
                          esxSampleSelectedRow.sampleRate,
                        )}{" "}
                        ({esxSampleSelectedRow.frames} fr)
                      </span>
                    </p>
                    <p>
                      <span className="text-text-dim">Level:</span>{" "}
                      <span className="text-text-primary">
                        {esxSampleSelectedRow.level}/127
                      </span>
                    </p>
                  </>
                )}
              </div>

              <div className="pt-2 border-t border-border-color space-y-2">
                <p className="text-xs text-text-muted">
                  Den Slot mit einer WAV/AIFF/MP3-Datei ersetzen. Wird auf
                  44100 Hz Mono resampelt (ESX-1 Hardware-Format).
                </p>
                <button
                  data-testid="korg-bank-editor-esx-sample-replace"
                  onClick={() => handleEsxSampleReplaceClick(esxSampleSelectedRow.index)}
                  disabled={busy}
                  className="w-full px-3 py-2 rounded text-sm bg-accent-primary text-bg-base hover:opacity-90 transition-opacity disabled:opacity-40 inline-flex items-center justify-center gap-2"
                >
                  🎵 Mit WAV-Datei ersetzen…
                </button>
              </div>

              {/* Dateiname */}
              <div className="pt-2 border-t border-border-color">
                <label className="block text-xs text-text-muted">
                  Dateiname beim Speichern
                  <input
                    data-testid="korg-bank-editor-esx-sample-filename"
                    type="text"
                    value={filename}
                    onChange={(e) => setFilename(e.target.value)}
                    className="w-full mt-1 bg-bg-base border border-border-color rounded px-2 py-1 text-sm text-text-primary"
                  />
                </label>
              </div>
            </div>
          )}

          {resultMsg && (
            <p
              data-testid="korg-bank-editor-esx-sample-status"
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
