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

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useProjectStore, type Sample } from "@/store/useProjectStore";
import { toast } from "@/store/useToastStore";
import { useElectron } from "../../../../electron/useElectron";
// v3.65.0: Pre-Action AutoBackup vor irreversiblen Bank-Operationen.
import { getRegisteredAutoBackup } from "@/utils/autoBackupController";
import {
  buildE2sBank,
  E2sBuildError,
  type E2sSlotInput,
} from "@/utils/korg/e2sBankBuilder";
import {
  parseE2sBank,
  E2sParseError,
  type E2sBank,
} from "@/utils/korg/e2sBankReader";
import { bundleE2sSamplesToZip } from "@/utils/korg/e2sSampleExport";
import { trimE2sSlotPcm, stereoToMonoE2s } from "@/utils/korg/e2sSampleEdit";
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
  moveOrSwapSlot,
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
// v3.48.0 — full from-scratch ESX-1 Bank Builder (closes last KORG-write gap)
import { buildEsxBankFromScratch } from "@/utils/korg/esxBankBuilder";
import {
  convertSynthstudioPatternToEsx,
  type SynthstudioPatternLike,
} from "@/utils/korg/esxPatternConvert";
import {
  buildEsxSampleSlotOverview,
  buildEsxSlotOverview,
  buildEsxStereoSampleSlotOverview,
  commitEsxPatchesAll,
  commitEsxStereoSamplePatches,
  commitEsxSampleRenames,
  countPendingEsxPatches,
  countPendingEsxSamplePatches,
  countPendingEsxStereoSamplePatches,
  countPendingEsxSampleRenames,
  filterEsxRows,
  filterEsxSampleRows,
  filterEsxStereoSampleRows,
  formatSampleLength,
  hasPendingEsxPatches,
  hasPendingEsxSamplePatches,
  hasPendingEsxStereoSamplePatches,
  stageEsxPatch,
  stageEsxSamplePatch,
  stageEsxStereoSamplePatch,
  stageEsxSampleRename,
  esxSampleRenameKey,
  unstageEsxPatch,
  unstageEsxSamplePatch,
  unstageEsxStereoSamplePatch,
  unstageEsxSampleRename,
  type EsxSampleSlotRow,
  type EsxSamplePatchEntry,
  type EsxSampleRename,
  type EsxSlotRow,
  type EsxStereoSampleSlotRow,
  // v3.38.0 — Undo/Redo
  createEsxEditorHistory,
  pushEsxHistory,
  undoEsxEditor,
  redoEsxEditor,
  canUndoEsxEditor,
  canRedoEsxEditor,
  type EsxEditorHistory,
  type EsxEditorSnapshot,
} from "@/utils/korg/esxBankEditorState";
import {
  compactEsxBank,
  inspectEsxBankWaste,
  EsxBankCompactError,
} from "@/utils/korg/esxBankCompacter";
import { polyPhaseResample } from "@/utils/korg/audioProcessor";
import {
  MAX_ESLI_SLICES,
  onsetsToSlices as onsetsToEsliSlices,
  slicesToOnsets as esliSlicesToOnsets,
} from "@/utils/korg/sliceBridge";
import { autoSlice, type OnsetCandidate } from "@/utils/sampleSlicing";
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
import { useConfirm } from "@/components/common/ConfirmDialog";

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

const TARGET_SAMPLE_RATE_OPTIONS: ReadonlyArray<44100 | 48000> =
  E2S_SAMPLE_RATES;

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
  const confirm = useConfirm();

  // Mode
  const [mode, setMode] = useState<EditorMode>("new");

  // "new" mode state
  const [newSlots, setNewSlots] = useState<NewModeSlot[]>([]);
  const [targetSr, setTargetSr] = useState<44100 | 48000>(44100);
  const [forceMono, setForceMono] = useState<boolean>(false);
  const [filename, setFilename] = useState<string>("synthstudio_pack.all");

  // "edit" mode state
  const [openedSlots, setOpenedSlots] = useState<OpenedSlot[]>([]);
  // v3.284 — die geparste E2S-Bank behalten, damit „Samples als WAV" das
  // originale PCM exportieren kann (Oe2sSLE „Export sample to WAV").
  const [e2sSourceBank, setE2sSourceBank] = useState<E2sBank | null>(null);
  const [openedSourceName, setOpenedSourceName] = useState<string>("");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

  // v3.29.0 — "esx" mode state
  const [esxBankBuffer, setEsxBankBuffer] = useState<ArrayBuffer | null>(null);
  const [esxRows, setEsxRows] = useState<EsxSlotRow[]>([]);
  const [esxPendingPatches, setEsxPendingPatches] = useState<
    Map<number, ArrayBuffer>
  >(() => new Map());
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
  const [esxSampleSelectedSlot, setEsxSampleSelectedSlot] = useState<
    number | null
  >(null);
  const [esxSampleSearch, setEsxSampleSearch] = useState<string>("");
  const [esxSampleHideEmpty, setEsxSampleHideEmpty] = useState<boolean>(true);
  const [esxSampleDropTargetSlot, setEsxSampleDropTargetSlot] = useState<
    number | null
  >(null);
  const esxSampleReplaceInputRef = useRef<HTMLInputElement | null>(null);
  const esxSampleReplaceTargetSlotRef = useRef<number | null>(null);
  // v3.284 — Sample-Rename-Staging (name-only, bit-exakt). Nicht Teil der
  // Undo-History (leichtgewichtig, per-Slot über die UI revert-bar).
  const [esxSampleRenamePending, setEsxSampleRenamePending] = useState<
    Map<string, EsxSampleRename>
  >(() => new Map());

  // v3.32.0 — ESX stereo-sample state + sample-channel-toggle
  type EsxSampleChannelMode = "mono" | "stereo";
  const [esxSampleChannelMode, setEsxSampleChannelMode] =
    useState<EsxSampleChannelMode>("mono");
  const [esxStereoSampleRows, setEsxStereoSampleRows] = useState<
    EsxStereoSampleSlotRow[]
  >([]);
  const [esxStereoSamplePending, setEsxStereoSamplePending] = useState<
    Map<number, EsxSamplePatchEntry>
  >(() => new Map());
  const [esxStereoSampleSelectedSlot, setEsxStereoSampleSelectedSlot] =
    useState<number | null>(null);
  const esxStereoSampleReplaceInputRef = useRef<HTMLInputElement | null>(null);
  const esxStereoSampleReplaceTargetSlotRef = useRef<number | null>(null);

  // v3.38.0 — Undo/Redo history for the ESX editor.
  const [esxHistory, setEsxHistory] = useState<EsxEditorHistory>(() =>
    createEsxEditorHistory()
  );

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
    try {
      auditionHandleRef.current?.stop();
    } catch {
      /* ignore */
    }
    auditionHandleRef.current = null;
    setAuditionState(null);
  }, []);

  // Lazy-init shared AudioContext (closed beim Unmount).
  useEffect(() => {
    if (!open) return;
    return () => {
      // v3.9.0 — Stop laufende Audition vor Context-Close.
      try {
        auditionHandleRef.current?.stop();
      } catch {
        /* ignore */
      }
      auditionHandleRef.current = null;
      audioContextRef.current?.close().catch(() => {
        /* */
      });
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
      setE2sSourceBank(null);
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
      // v3.32.0 — Stereo sample state
      setEsxSampleChannelMode("mono");
      setEsxStereoSampleRows([]);
      setEsxStereoSamplePending(new Map());
      setEsxSampleRenamePending(new Map());
      setEsxStereoSampleSelectedSlot(null);
      esxStereoSampleReplaceTargetSlotRef.current = null;
      // v3.38.0 — Undo/Redo history
      setEsxHistory(createEsxEditorHistory());
    }
  }, [open]);

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function getCtx(): AudioContext {
    if (!audioContextRef.current) {
      const Ctor =
        window.AudioContext ||
        (window as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) throw new Error("AudioContext nicht verfügbar");
      audioContextRef.current = new Ctor();
    }
    return audioContextRef.current;
  }

  async function decodeSample(
    sample: Sample
  ): Promise<{ pcm: Float32Array; sampleRate: number; channels: 1 | 2 }> {
    const res = await fetch(sample.path);
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const ab = await res.arrayBuffer();
    return decodeArrayBuffer(ab);
  }

  async function decodeArrayBuffer(
    ab: ArrayBuffer
  ): Promise<{ pcm: Float32Array; sampleRate: number; channels: 1 | 2 }> {
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

  // ─── v3.38.0 — Undo/Redo Helpers ───────────────────────────────────────────

  /**
   * v3.38.0 — Capture the current ESX-pending state and push it onto the
   * history stack BEFORE applying a new edit. Use this right before every
   * stageEsxPatch / unstageEsxPatch / stage/unstage sample-call so that
   * Undo restores the prior pending-set.
   */
  const pushEsxHistorySnapshot = useCallback((): void => {
    setEsxHistory(prev =>
      pushEsxHistory(prev, {
        patternMap: esxPendingPatches,
        sampleMap: esxSamplePending,
        stereoSampleMap: esxStereoSamplePending,
      })
    );
  }, [esxPendingPatches, esxSamplePending, esxStereoSamplePending]);

  /**
   * v3.38.0 — Undo last ESX edit. Re-applies the prior snapshot and pushes
   * the *current* state onto the redo stack. Re-parses overview rows from
   * the bank for visual consistency.
   */
  const handleEsxUndo = useCallback((): void => {
    setEsxHistory(prevHist => {
      const result = undoEsxEditor(prevHist, {
        patternMap: esxPendingPatches,
        sampleMap: esxSamplePending,
        stereoSampleMap: esxStereoSamplePending,
      });
      if (!result) return prevHist;
      // Apply the restored snapshot.
      setEsxPendingPatches(result.snapshot.patternMap);
      setEsxSamplePending(result.snapshot.sampleMap);
      setEsxStereoSamplePending(result.snapshot.stereoSampleMap);
      // Refresh overview rows from the (untouched) bank buffer so name/bpm
      // fall back to the on-disk values when a patch is removed.
      if (esxBankBuffer) {
        try {
          const bank = parseEsxBank(esxBankBuffer);
          setEsxRows(buildEsxSlotOverview(bank));
          setEsxSampleRows(buildEsxSampleSlotOverview(bank));
          setEsxStereoSampleRows(buildEsxStereoSampleSlotOverview(bank));
        } catch {
          /* Defensive — keep stale rows if re-parse fails. */
        }
      }
      return result.history;
    });
  }, [
    esxBankBuffer,
    esxPendingPatches,
    esxSamplePending,
    esxStereoSamplePending,
  ]);

  /**
   * v3.38.0 — Redo last undone edit. Mirror of handleEsxUndo.
   */
  const handleEsxRedo = useCallback((): void => {
    setEsxHistory(prevHist => {
      const result = redoEsxEditor(prevHist, {
        patternMap: esxPendingPatches,
        sampleMap: esxSamplePending,
        stereoSampleMap: esxStereoSamplePending,
      });
      if (!result) return prevHist;
      setEsxPendingPatches(result.snapshot.patternMap);
      setEsxSamplePending(result.snapshot.sampleMap);
      setEsxStereoSamplePending(result.snapshot.stereoSampleMap);
      if (esxBankBuffer) {
        try {
          const bank = parseEsxBank(esxBankBuffer);
          setEsxRows(buildEsxSlotOverview(bank));
          setEsxSampleRows(buildEsxSampleSlotOverview(bank));
          setEsxStereoSampleRows(buildEsxStereoSampleSlotOverview(bank));
        } catch {
          /* Defensive */
        }
      }
      return result.history;
    });
  }, [
    esxBankBuffer,
    esxPendingPatches,
    esxSamplePending,
    esxStereoSamplePending,
  ]);

  const esxCanUndo = canUndoEsxEditor(esxHistory);
  const esxCanRedo = canRedoEsxEditor(esxHistory);

  // v3.38.0 — Keyboard shortcuts: Ctrl+Z undo, Ctrl+Shift+Z redo.
  // Only active while the editor is open AND in ESX mode (where the
  // undo stack is meaningful). Avoids hijacking shortcuts from text-inputs
  // inside Settings / DrumMachine.
  useEffect(() => {
    if (!open || mode !== "esx") return;
    function onKeyDown(e: KeyboardEvent): void {
      // Allow native undo/redo inside text inputs.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      if (!isCtrlOrMeta) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleEsxUndo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        handleEsxRedo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, mode, handleEsxUndo, handleEsxRedo]);

  // ─── Mode Switching ────────────────────────────────────────────────────────

  async function tryChangeMode(next: EditorMode): Promise<void> {
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
        hasPendingEsxStereoSamplePatches(esxStereoSamplePending) ||
        esxBankBuffer !== null;
    }
    if (hasChanges) {
      const ok = await confirm({
        title:
          "Ungespeicherte Änderungen gehen verloren. Trotzdem Modus wechseln?",
        confirmLabel: "Wechseln",
        destructive: true,
      });
      if (!ok) return;
    }
    // Clear the outgoing mode's state so re-entering starts fresh.
    if (mode === "new") {
      setNewSlots([]);
    } else if (mode === "edit") {
      setOpenedSlots([]);
      setE2sSourceBank(null);
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
      // v3.32.0 — Stereo
      setEsxSampleChannelMode("mono");
      setEsxStereoSampleRows([]);
      setEsxStereoSamplePending(new Map());
      setEsxSampleRenamePending(new Map());
      setEsxStereoSampleSelectedSlot(null);
      // v3.38.0 — clear history when leaving ESX mode
      setEsxHistory(createEsxEditorHistory());
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
        toast("Kein gültiges ESX-1-Format (KORG/ESX-Magic fehlt).", {
          kind: "error",
          duration: 5000,
        });
        setBusy(false);
        setResultMsg(null);
        return;
      }
      const bank = parseEsxBank(ab, file.name);
      const rows = buildEsxSlotOverview(bank);
      const sampleRows = buildEsxSampleSlotOverview(bank);
      const stereoSampleRows = buildEsxStereoSampleSlotOverview(bank);
      setEsxBankBuffer(ab);
      setEsxRows(rows);
      setEsxSampleRows(sampleRows);
      setEsxStereoSampleRows(stereoSampleRows);
      setEsxPendingPatches(new Map());
      setEsxSamplePending(new Map());
      setEsxStereoSamplePending(new Map());
      setEsxSampleRenamePending(new Map());
      setEsxSelectedSlot(null);
      setEsxSampleSelectedSlot(null);
      setEsxStereoSampleSelectedSlot(null);
      setEsxSampleChannelMode("mono");
      setEsxSubTab("patterns");
      // v3.38.0 — reset history when loading a fresh bank
      setEsxHistory(createEsxEditorHistory());
      setMode("esx");
      // Filename default for save: original name (user can rename).
      const baseName = file.name.replace(/\.[^.]+$/, "");
      const safeName = baseName.replace(/[^A-Za-z0-9._-]/g, "_");
      setFilename(`${safeName}.esx`);
      const filledRows = rows.filter(r => !r.empty).length;
      toast(
        `ESX-Bank geladen: ${filledRows}/256 Pattern — ${bank.warnings.length} Warnungen`,
        { kind: "success", duration: 4000 }
      );
      setResultMsg(
        `${filledRows} Pattern bereit — wähle einen Slot zum Ersetzen.`
      );
    } catch (err) {
      const msg =
        err instanceof EsxParseError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      toast(`Fehler beim Laden: ${msg}`, { kind: "error", duration: 6000 });
      setResultMsg(null);
    } finally {
      setBusy(false);
    }
  }, []);

  // v3.48.0 — Build a fresh empty ESX-1 bank from scratch and open it for editing.
  const handleNewEsxBankFromScratch = useCallback((): void => {
    if (!requireProFeature(PRO_FEATURE_KORG_BANK_WRITE)) return;
    setBusy(true);
    setResultMsg("Erzeuge frische ESX-Bank...");
    try {
      const ab = buildEsxBankFromScratch({});
      const bank = parseEsxBank(ab, "new-bank.esx");
      const rows = buildEsxSlotOverview(bank);
      const sampleRows = buildEsxSampleSlotOverview(bank);
      const stereoSampleRows = buildEsxStereoSampleSlotOverview(bank);
      setEsxBankBuffer(ab);
      setEsxRows(rows);
      setEsxSampleRows(sampleRows);
      setEsxStereoSampleRows(stereoSampleRows);
      setEsxPendingPatches(new Map());
      setEsxSamplePending(new Map());
      setEsxStereoSamplePending(new Map());
      setEsxSampleRenamePending(new Map());
      setEsxSelectedSlot(null);
      setEsxSampleSelectedSlot(null);
      setEsxStereoSampleSelectedSlot(null);
      setEsxSampleChannelMode("mono");
      setEsxSubTab("patterns");
      setEsxHistory(createEsxEditorHistory());
      setMode("esx");
      setFilename("new-bank.esx");
      toast(
        `Frische ESX-Bank erzeugt — 256 leere Pattern + 0 Samples (${(ab.byteLength / 1024 / 1024).toFixed(2)} MB)`,
        { kind: "success", duration: 4000 }
      );
      setResultMsg(
        "Leere ESX-Bank bereit — füge Pattern + Samples ein. Speichern via Save-Button."
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Fehler beim Erzeugen: ${msg}`, { kind: "error", duration: 6000 });
      setResultMsg(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const loadBankFromFile = useCallback(
    async (file: File): Promise<void> => {
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
        setE2sSourceBank(bank);
        setOpenedSourceName(file.name);
        setMode("edit");
        // Pre-select first filled slot if any.
        const firstFilled = slots.find(s => !s.empty);
        setSelectedRowId(firstFilled ? firstFilled.rowId : null);
        // Filename default = source (sanitized at save time).
        setFilename(file.name);
        const filledCount = countFilledSlots(slots);
        toast(
          `Bank geladen: ${filledCount} Slot(s) — ${bank.warnings.length} Warnungen`,
          { kind: "success", duration: 4000 }
        );
        setResultMsg(`${filledCount} Slot(s) bereit zur Bearbeitung`);
      } catch (err) {
        const msg =
          err instanceof E2sParseError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        toast(`Fehler beim Laden: ${msg}`, { kind: "error", duration: 6000 });
        setResultMsg(null);
      } finally {
        setBusy(false);
      }
    },
    [loadEsxBankFromFile]
  );

  // v3.7: external file (drag-drop into editor) auto-open
  useEffect(() => {
    if (!open || !externalOpenFile) return;
    loadBankFromFile(externalOpenFile).finally(() =>
      onExternalOpenFileConsumed?.()
    );
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
    if (newSlots.some(s => s.source.id === source.id)) {
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
    setNewSlots(prev => [...prev, slot]);
  }

  function removeNewSlot(rowId: string): void {
    setNewSlots(prev => {
      const filtered = prev.filter(s => s.rowId !== rowId);
      return filtered.map((s, i) => ({ ...s, slotIndex: i }));
    });
  }

  function updateNewSlot(rowId: string, patch: Partial<NewModeSlot>): void {
    setNewSlots(prev =>
      prev.map(s => (s.rowId === rowId ? { ...s, ...patch } : s))
    );
  }

  // ─── "Edit" Mode Operations ────────────────────────────────────────────────

  function editSlotPatch(rowId: string, patch: Partial<OpenedSlot>): void {
    setOpenedSlots(prev => patchOpenedSlot(prev, rowId, patch));
  }

  function editSlotDelete(rowId: string): void {
    setOpenedSlots(prev => deleteSlot(prev, rowId));
  }

  function editSlotRevert(rowId: string): void {
    setOpenedSlots(prev => revertSlot(prev, rowId));
  }

  // v3.284 — Oe2sSLE „Trim": PCM auf den Loop-Bereich [loopStart, loopEnd]
  // schneiden, Loop-Punkte auf das neue Sample zurücksetzen. Nur sinnvoll bei
  // einem echten Bereich (loopEnd > loopStart) mit vorhandenem PCM.
  function editSlotTrimToLoop(rowId: string): void {
    setOpenedSlots(prev => {
      const slot = prev.find(s => s.rowId === rowId);
      if (!slot || !slot.pcmData || slot.channels == null) return prev;
      const { pcmData, frames } = trimE2sSlotPcm(
        slot.pcmData,
        slot.channels,
        slot.loopStart,
        slot.loopEnd
      );
      if (frames === slot.frames) return prev; // No-op → nichts markieren
      return patchOpenedSlot(prev, rowId, {
        pcmData,
        frames,
        loopStart: 0,
        loopEnd: Math.max(0, frames - 1),
      });
    });
  }

  // v3.284 — Oe2sSLE „Move / Exchange / #Num": Inhalt eines Slots auf eine andere
  // Nummer verschieben (Ziel frei) bzw. tauschen (Ziel belegt). Die Selektion
  // folgt dem Inhalt zur Ziel-Nummer.
  function editSlotMoveTo(rowId: string, toIndex: number): void {
    const from = openedSlots.find(s => s.rowId === rowId);
    const target = openedSlots.find(s => s.slotIndex === toIndex);
    if (!from || !target || from.slotIndex === toIndex) return;
    setOpenedSlots(prev => moveOrSwapSlot(prev, rowId, toIndex));
    setSelectedRowId(target.rowId);
  }

  // v3.284 — Oe2sSLE „Stereo → Mono": zentrierter Downmix (mix=0), setzt
  // channels=1 (Builder schreibt dann useChan1=false). Frame-Zahl bleibt gleich.
  function editSlotStereoToMono(rowId: string): void {
    setOpenedSlots(prev => {
      const slot = prev.find(s => s.rowId === rowId);
      if (!slot || !slot.pcmData || slot.channels !== 2) return prev;
      const mono = stereoToMonoE2s(slot.pcmData, 0);
      return patchOpenedSlot(prev, rowId, { pcmData: mono, channels: 1 });
    });
  }

  async function editSlotReplaceSample(
    rowId: string,
    file: File
  ): Promise<void> {
    setBusy(true);
    try {
      const ab = await file.arrayBuffer();
      const decoded = await decodeArrayBuffer(ab);
      const processed = convertToE2sSpec(
        decoded.pcm,
        decoded.sampleRate,
        decoded.channels,
        {
          targetSampleRate: targetSr,
          forceMono,
        }
      );
      if (processed.estimatedPcmBytes > MAX_BYTES_PER_SLOT) {
        toast(
          `Sample zu groß (${(processed.estimatedPcmBytes / 1024 / 1024).toFixed(1)} MB > 10 MB)`,
          { kind: "error" }
        );
        return;
      }
      setOpenedSlots(prev =>
        replaceSlotSample(
          prev,
          rowId,
          processed.pcm,
          processed.sampleRate,
          processed.channels
        )
      );
      toast(`Sample ersetzt: ${file.name}`, {
        kind: "success",
        duration: 3000,
      });
    } catch (err) {
      const msg =
        err instanceof AudioProcessError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
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

  function handleEsxBankFileInput(
    e: React.ChangeEvent<HTMLInputElement>
  ): void {
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
      // v3.38.0 — push history snapshot BEFORE applying the patch.
      pushEsxHistorySnapshot();
      setEsxPendingPatches(prev => stageEsxPatch(prev, slotIndex, block));
      // Update overview row so the UI immediately reflects the new name/bpm.
      setEsxRows(prev =>
        prev.map(r =>
          r.index === slotIndex
            ? {
                index: slotIndex,
                empty: false,
                name: (patched.name ?? "").slice(0, 8),
                bpm:
                  typeof patched.bpm === "number" &&
                  Number.isFinite(patched.bpm)
                    ? patched.bpm
                    : 120,
                stepLength: patched.stepCount ?? 16,
              }
            : r
        )
      );
      toast(
        `Slot #${slotIndex} mit "${(patched.name ?? "").slice(0, 8) || "(unnamed)"}" ersetzt`,
        { kind: "success", duration: 2500 }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Fehler beim Ersetzen: ${msg}`, { kind: "error" });
    }
  }

  function handleEsxRevertSlot(slotIndex: number): void {
    // v3.38.0 — capture pre-revert snapshot for undo.
    pushEsxHistorySnapshot();
    setEsxPendingPatches(prev => unstageEsxPatch(prev, slotIndex));
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
        setEsxRows(prev =>
          rows.map(r => {
            if (esxPendingPatches.has(r.index) && r.index !== slotIndex) {
              const old = prev.find(p => p.index === r.index);
              return old ?? r;
            }
            return r;
          })
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
    const stereoSampleCount = countPendingEsxStereoSamplePatches(
      esxStereoSamplePending
    );
    const renameCount = countPendingEsxSampleRenames(esxSampleRenamePending);
    if (
      patchCount === 0 &&
      sampleCount === 0 &&
      stereoSampleCount === 0 &&
      renameCount === 0
    ) {
      toast("Keine Slots zum Speichern modifiziert.", { kind: "warning" });
      return;
    }
    const summaryParts: string[] = [];
    if (patchCount > 0) summaryParts.push(`${patchCount} Pattern-Slot(s)`);
    if (sampleCount > 0)
      summaryParts.push(`${sampleCount} Mono-Sample-Slot(s)`);
    if (stereoSampleCount > 0)
      summaryParts.push(`${stereoSampleCount} Stereo-Sample-Slot(s)`);
    if (renameCount > 0)
      summaryParts.push(`${renameCount} Sample-Umbenennung(en)`);
    const ok = await confirm({
      title: `${summaryParts.join(" + ")} wurden geändert.`,
      message:
        `Alle anderen Slots, Sample-Daten und Song-Daten bleiben bit-exakt erhalten.\n\n` +
        `Bank speichern?`,
      confirmLabel: "Speichern",
    });
    if (!ok) return;
    setBusy(true);
    setResultMsg("Schreibe ESX-Bank...");
    try {
      let newBuffer = commitEsxPatchesAll(
        esxBankBuffer,
        esxPendingPatches,
        esxSamplePending
      );
      // v3.32.0 — apply stereo patches after mono/patterns.
      if (stereoSampleCount > 0) {
        newBuffer = commitEsxStereoSamplePatches(
          newBuffer,
          esxStereoSamplePending
        );
      }
      // v3.284 — Sample-Renames zuletzt (name-only, bit-exakt).
      if (renameCount > 0) {
        newBuffer = commitEsxSampleRenames(newBuffer, esxSampleRenamePending);
      }
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
        toast(`ESX-Bank gespeichert: ${result.filePath} (${summaryMsg})`, {
          kind: "success",
          duration: 4000,
        });
        setResultMsg(`Gespeichert: ${result.filePath}`);
        // Update working copy + clear pending patches.
        setEsxBankBuffer(newBuffer);
        setEsxPendingPatches(new Map());
        setEsxSamplePending(new Map());
        setEsxStereoSamplePending(new Map());
        setEsxSampleRenamePending(new Map());
        // v3.38.0 — reset history after save (committed state is the new baseline).
        setEsxHistory(createEsxEditorHistory());
      } else {
        const blob = new Blob([newBuffer], {
          type: "application/octet-stream",
        });
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
        toast(`ESX-Bank heruntergeladen: ${finalName} (${summaryMsg})`, {
          kind: "success",
          duration: 4000,
        });
        setResultMsg(`Download: ${finalName}`);
        setEsxBankBuffer(newBuffer);
        setEsxPendingPatches(new Map());
        setEsxSamplePending(new Map());
        setEsxStereoSamplePending(new Map());
        setEsxSampleRenamePending(new Map());
        // v3.38.0 — reset history after save.
        setEsxHistory(createEsxEditorHistory());
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Speichern fehlgeschlagen: ${msg}`, {
        kind: "error",
        duration: 6000,
      });
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
    return {
      pcm: mono,
      sampleRate: ESX_TARGET_SR,
      channels: 1,
      name: baseName,
    };
  }

  function handleEsxSampleReplaceClick(slot: number): void {
    if (!requireProFeature(PRO_FEATURE_KORG_BANK_WRITE)) return;
    esxSampleReplaceTargetSlotRef.current = slot;
    esxSampleReplaceInputRef.current?.click();
  }

  async function handleEsxSampleReplaceInput(
    e: React.ChangeEvent<HTMLInputElement>
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
      // v3.38.0 — push history snapshot BEFORE applying the patch.
      pushEsxHistorySnapshot();
      setEsxSamplePending(prev => stageEsxSamplePatch(prev, slot, entry));
      setEsxSampleRows(prev =>
        prev.map(r =>
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
            : r
        )
      );
      toast(
        `Slot #${slot} → "${decoded.name.slice(0, 8) || "(unnamed)"}" (${decoded.pcm.length} frames)`,
        { kind: "success", duration: 2500 }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Fehler beim Replace: ${msg}`, { kind: "error", duration: 5000 });
    } finally {
      setBusy(false);
    }
  }

  function handleEsxSampleRevertSlot(slot: number): void {
    // v3.38.0 — push history snapshot BEFORE applying the revert.
    pushEsxHistorySnapshot();
    setEsxSamplePending(prev => unstageEsxSamplePatch(prev, slot));
    // Refresh row from the (untouched) loaded bank by re-parsing.
    if (esxBankBuffer) {
      try {
        const bank = parseEsxBank(esxBankBuffer);
        const rows = buildEsxSampleSlotOverview(bank);
        setEsxSampleRows(prev =>
          rows.map(r => {
            if (esxSamplePending.has(r.index) && r.index !== slot) {
              const old = prev.find(p => p.index === r.index);
              return old ?? r;
            }
            return r;
          })
        );
      } catch {
        /* keep existing rows */
      }
    }
  }

  function handleEsxSampleDragOver(
    e: React.DragEvent<HTMLLIElement>,
    slot: number
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
    slot: number
  ): Promise<void> {
    e.preventDefault();
    setEsxSampleDropTargetSlot(null);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await replaceEsxSampleSlot(slot, file);
  }

  // ─── ESX-Stereo-Sample-Mode Operations (v3.32.0) ──────────────────────────

  /**
   * v3.32.0 — Decode a file into Float32 STEREO (interleaved L,R,L,R …).
   * - Mono input → duplicates the channel to L=R.
   * - Stereo input → preserves channels separately (NO downmix).
   * - Resamples to 44100 Hz (ESX target).
   */
  async function decodeWavForEsxStereoSample(file: File): Promise<{
    pcm: Float32Array;
    sampleRate: number;
    channels: 2;
    name: string;
  }> {
    const ab = await file.arrayBuffer();
    const ctx = getCtx();
    const buf = await ctx.decodeAudioData(ab.slice(0));
    const frames = buf.length;
    let leftSrc: Float32Array;
    let rightSrc: Float32Array;
    if (buf.numberOfChannels === 1) {
      // Duplicate mono → L=R
      const m = buf.getChannelData(0);
      leftSrc = new Float32Array(m);
      rightSrc = new Float32Array(m);
    } else {
      leftSrc = new Float32Array(buf.getChannelData(0));
      rightSrc = new Float32Array(buf.getChannelData(1));
    }
    // Resample each channel separately to 44100 Hz (ESX-1 target).
    const ESX_TARGET_SR = 44100;
    if (buf.sampleRate !== ESX_TARGET_SR) {
      leftSrc = polyPhaseResample(leftSrc, buf.sampleRate, ESX_TARGET_SR, 1);
      rightSrc = polyPhaseResample(rightSrc, buf.sampleRate, ESX_TARGET_SR, 1);
    }
    const newFrames = Math.min(leftSrc.length, rightSrc.length);
    const interleaved = new Float32Array(newFrames * 2);
    for (let i = 0; i < newFrames; i++) {
      interleaved[i * 2] = leftSrc[i];
      interleaved[i * 2 + 1] = rightSrc[i];
    }
    const baseName = file.name.replace(/\.[^.]+$/, "");
    return {
      pcm: interleaved,
      sampleRate: ESX_TARGET_SR,
      channels: 2,
      name: baseName,
    };
    // Note: frames counter is implicit (interleaved length / 2).
  }

  function handleEsxStereoSampleReplaceClick(slot: number): void {
    if (!requireProFeature(PRO_FEATURE_KORG_BANK_WRITE)) return;
    esxStereoSampleReplaceTargetSlotRef.current = slot;
    esxStereoSampleReplaceInputRef.current?.click();
  }

  async function handleEsxStereoSampleReplaceInput(
    e: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> {
    const f = e.target.files?.[0];
    e.target.value = "";
    const slot = esxStereoSampleReplaceTargetSlotRef.current;
    esxStereoSampleReplaceTargetSlotRef.current = null;
    if (!f || slot == null) return;
    await replaceEsxStereoSampleSlot(slot, f);
  }

  async function replaceEsxStereoSampleSlot(
    slot: number,
    file: File
  ): Promise<void> {
    setBusy(true);
    try {
      const decoded = await decodeWavForEsxStereoSample(file);
      const frames = decoded.pcm.length / 2;
      const entry: EsxSamplePatchEntry = {
        pcmData: decoded.pcm,
        sampleRate: decoded.sampleRate,
        channels: 2,
        name: decoded.name.slice(0, 8),
        level: 100,
      };
      // v3.38.0 — push history snapshot BEFORE applying the patch.
      pushEsxHistorySnapshot();
      setEsxStereoSamplePending(prev =>
        stageEsxStereoSamplePatch(prev, slot, entry)
      );
      setEsxStereoSampleRows(prev =>
        prev.map(r =>
          r.index === slot
            ? {
                index: slot,
                empty: false,
                name: decoded.name.slice(0, 8),
                channels: 2,
                sampleRate: decoded.sampleRate,
                frames,
                level: 100,
              }
            : r
        )
      );
      toast(
        `Stereo-Slot #${slot} → "${decoded.name.slice(0, 8) || "(unnamed)"}" (${frames} fr)`,
        { kind: "success", duration: 2500 }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Fehler beim Stereo-Replace: ${msg}`, {
        kind: "error",
        duration: 5000,
      });
    } finally {
      setBusy(false);
    }
  }

  function handleEsxStereoSampleRevertSlot(slot: number): void {
    // v3.38.0 — push history snapshot BEFORE applying the revert.
    pushEsxHistorySnapshot();
    setEsxStereoSamplePending(prev => unstageEsxStereoSamplePatch(prev, slot));
    if (esxBankBuffer) {
      try {
        const bank = parseEsxBank(esxBankBuffer);
        const rows = buildEsxStereoSampleSlotOverview(bank);
        setEsxStereoSampleRows(prev =>
          rows.map(r => {
            if (esxStereoSamplePending.has(r.index) && r.index !== slot) {
              const old = prev.find(p => p.index === r.index);
              return old ?? r;
            }
            return r;
          })
        );
      } catch {
        /* keep existing rows */
      }
    }
  }

  // ─── ESX-Compact-Action (v3.32.0) ─────────────────────────────────────────

  /**
   * v3.32.0 — Compact the PCM region of the loaded ESX-bank in-memory.
   * Removes orphan bytes left behind by Mode-A append-replace. Headers, magic,
   * patterns and song-data stay bit-exact. Bank buffer + sample-rows are
   * refreshed; pending sample-patches are dropped to avoid stale-offset
   * conflicts (user must re-stage them).
   */
  async function handleEsxCompactBank(): Promise<void> {
    if (!requireProFeature(PRO_FEATURE_KORG_BANK_WRITE)) return;
    if (!esxBankBuffer) {
      toast("Keine ESX-Bank geladen.", { kind: "warning" });
      return;
    }
    const report = inspectEsxBankWaste(esxBankBuffer);
    if (!report) {
      toast("Bank-Buffer ist beschädigt — Compaction nicht möglich.", {
        kind: "error",
      });
      return;
    }
    if (report.orphanBytes === 0) {
      toast("Bank ist bereits compact (keine Orphan-Bytes).", { kind: "info" });
      return;
    }
    const mb = (report.orphanBytes / 1024 / 1024).toFixed(2);
    const ok = await confirm({
      title: `Compact spart ${report.orphanBytes.toLocaleString()} Bytes (~${mb} MB).`,
      message:
        "Alle Patterns, Globals und Song-Daten bleiben bit-exakt erhalten. " +
        "Bereits-gestagte (aber noch nicht gespeicherte) Sample-Patches gehen verloren.\n\n" +
        "Bank compactieren?",
      confirmLabel: "Compactieren",
    });
    if (!ok) return;
    // v3.65.0: Pre-Action AutoBackup vor irreversiblem Compact.
    // Non-blocking — wir warten ab (fire-and-forget hier sicher, da
    // setBusy(true) gleich folgt + Compact-Workflow eh asynchron).
    await getRegisteredAutoBackup()("Compact ESX-Bank").catch(() => {
      /* silent — Action darf nicht blockiert werden */
    });
    setBusy(true);
    setResultMsg("Compactiere ESX-Bank…");
    try {
      const compacted = compactEsxBank(esxBankBuffer);
      // Refresh state: new buffer + fresh rows. Drop pending sample-patches
      // (they reference old offsets) — keep pattern-pending (offsets are
      // fixed inside the pattern region).
      const bank = parseEsxBank(compacted);
      setEsxBankBuffer(compacted);
      setEsxSampleRows(buildEsxSampleSlotOverview(bank));
      setEsxStereoSampleRows(buildEsxStereoSampleSlotOverview(bank));
      setEsxSamplePending(new Map());
      setEsxStereoSamplePending(new Map());
      setEsxSampleRenamePending(new Map());
      setEsxSampleSelectedSlot(null);
      setEsxStereoSampleSelectedSlot(null);
      // v3.38.0 — reset history after compact (compaction is a non-undoable rewrite).
      setEsxHistory(createEsxEditorHistory());
      toast(`Bank compactiert · ${mb} MB gespart`, {
        kind: "success",
        duration: 3500,
      });
      setResultMsg(
        `Compact: ${report.orphanBytes.toLocaleString()} Bytes Orphans entfernt (~${mb} MB)`
      );
    } catch (err) {
      const msg =
        err instanceof EsxBankCompactError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      toast(`Compact fehlgeschlagen: ${msg}`, {
        kind: "error",
        duration: 6000,
      });
      setResultMsg(null);
    } finally {
      setBusy(false);
    }
  }

  // ─── Slice-Editor (v3.8.0) ─────────────────────────────────────────────────

  function editSlotSetSlices(
    rowId: string,
    slices: ReturnType<typeof onsetsToEsliSlices>
  ): void {
    setOpenedSlots(prev => setSlotSlices(prev, rowId, slices));
  }

  function handleAutoSlice(slot: OpenedSlot): void {
    if (!slot.pcmData || !slot.sampleRate || !slot.channels || !slot.frames)
      return;
    const mono = extractMonoChannel(slot.pcmData, slot.channels);
    try {
      const specs = autoSlice(mono, slot.sampleRate, {
        maxSlices: MAX_ESLI_SLICES,
        snapToZero: true,
        fillToMax: false,
      });
      const onsets: OnsetCandidate[] = specs.map(s => ({
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
        const processed = convertToE2sSpec(
          dec.pcm,
          dec.sampleRate,
          dec.channels,
          {
            targetSampleRate: targetSr,
            forceMono,
          }
        );
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
          err instanceof AudioProcessError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        updated.push({ ...slot, status: "error", errorMessage: msg });
      }
    }
    setNewSlots(updated);
    return updated;
  }

  // v3.284 — Oe2sSLE „Export all as wav": alle belegten Slots der geladenen
  // E2S-Bank als WAV-ZIP herunterladen (originales PCM der geladenen Datei).
  async function handleE2sExportSamples(): Promise<void> {
    if (!e2sSourceBank) {
      toast("Keine E2S-Bank geladen.", { kind: "warning" });
      return;
    }
    setBusy(true);
    try {
      const res = await bundleE2sSamplesToZip(e2sSourceBank);
      if (res.sampleCount === 0) {
        toast("Keine Samples in dieser Bank zum Exportieren.", {
          kind: "warning",
        });
        return;
      }
      const copy = new Uint8Array(res.zip.byteLength);
      copy.set(new Uint8Array(res.zip));
      const url = URL.createObjectURL(
        new Blob([copy.buffer], { type: "application/zip" })
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = res.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast(
        `${res.sampleCount} Sample(s) als WAV exportiert → ${res.fileName}`,
        {
          kind: "success",
          duration: 4000,
        }
      );
    } catch (err) {
      toast(
        `Sample-Export fehlgeschlagen: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { kind: "error" }
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveAs(): Promise<void> {
    if (!requireProFeature(PRO_FEATURE_KORG_BANK_WRITE)) return;

    let inputs: E2sSlotInput[];
    let savedMsgDetail = "";

    if (mode === "new") {
      if (newSlots.length === 0) {
        toast("Keine Samples in der Bank — bitte zuerst hinzufügen.", {
          kind: "warning",
        });
        return;
      }
      setBusy(true);
      setResultMsg("Decodiere Samples...");
      try {
        const decoded = await decodeAllPendingNew();
        const ready = decoded.filter(s => s.status === "ready");
        const errored = decoded.filter(s => s.status === "error");
        if (ready.length === 0) {
          toast("Keine gültigen Samples — alle Decodes fehlgeschlagen.", {
            kind: "error",
          });
          setResultMsg(null);
          setBusy(false);
          return;
        }
        if (errored.length > 0) {
          toast(`${errored.length} Slot(s) übersprungen wg. Decode-Fehler`, {
            kind: "warning",
          });
        }
        inputs = ready.map(s => ({
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
        toast(`${built.droppedCount} korrupter Slot(s) verworfen`, {
          kind: "warning",
        });
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
      const finalName = safeName.endsWith(".all")
        ? safeName
        : `${safeName}.all`;

      if (electron.isElectron) {
        const saveResult = await electron.saveKorgBankAs(finalName, buf);
        if (!saveResult.success) {
          if (saveResult.error === "canceled") {
            setResultMsg(null);
            return;
          }
          toast(`Fehler beim Speichern: ${saveResult.error}`, {
            kind: "error",
          });
          setResultMsg(null);
          return;
        }
        toast(
          `E2S Bank gespeichert: ${saveResult.filePath} (${savedMsgDetail})`,
          { kind: "success", duration: 4000 }
        );
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
        toast(`E2S Bank heruntergeladen: ${finalName} (${savedMsgDetail})`, {
          kind: "success",
          duration: 4000,
        });
        setResultMsg(`Download: ${finalName}`);
      }
    } catch (err) {
      const msg =
        err instanceof E2sBuildError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      toast(`Build-Fehler: ${msg}`, { kind: "error", duration: 6000 });
      setResultMsg(null);
    } finally {
      setBusy(false);
    }
  }

  // ─── Computed ──────────────────────────────────────────────────────────────

  const totalBytesNew = useMemo(
    () => newSlots.reduce((sum, s) => sum + (s.pcmBytes ?? 0), 0),
    [newSlots]
  );

  const availableSamples = useMemo(
    () => samples.filter(sm => !newSlots.some(es => es.source.id === sm.id)),
    [samples, newSlots]
  );

  const filledCountOpened = useMemo(
    () => countFilledSlots(openedSlots),
    [openedSlots]
  );
  const dirtyCountOpened = useMemo(
    () => countDirtySlots(openedSlots),
    [openedSlots]
  );
  const selectedSlot = useMemo(
    () => openedSlots.find(s => s.rowId === selectedRowId) ?? null,
    [openedSlots, selectedRowId]
  );

  // v3.29.0 — ESX-Mode computed
  const esxFilledCount = useMemo(
    () => esxRows.filter(r => !r.empty).length,
    [esxRows]
  );
  const esxPendingCount = useMemo(
    () => countPendingEsxPatches(esxPendingPatches),
    [esxPendingPatches]
  );
  const esxVisibleRows = useMemo(
    () => filterEsxRows(esxRows, esxSearch, esxHideInit, esxHideEmpty),
    [esxRows, esxSearch, esxHideInit, esxHideEmpty]
  );
  const esxSelectedRow = useMemo(
    () =>
      esxSelectedSlot == null
        ? null
        : (esxRows.find(r => r.index === esxSelectedSlot) ?? null),
    [esxRows, esxSelectedSlot]
  );

  // v3.31.0 — Sample-Tab computed
  const esxSampleFilledCount = useMemo(
    () => esxSampleRows.filter(r => !r.empty).length,
    [esxSampleRows]
  );
  const esxSamplePendingCount = useMemo(
    () => countPendingEsxSamplePatches(esxSamplePending),
    [esxSamplePending]
  );
  const esxSampleVisibleRows = useMemo(
    () =>
      filterEsxSampleRows(esxSampleRows, esxSampleSearch, esxSampleHideEmpty),
    [esxSampleRows, esxSampleSearch, esxSampleHideEmpty]
  );
  const esxSampleSelectedRow = useMemo(
    () =>
      esxSampleSelectedSlot == null
        ? null
        : (esxSampleRows.find(r => r.index === esxSampleSelectedSlot) ?? null),
    [esxSampleRows, esxSampleSelectedSlot]
  );

  // v3.32.0 — Stereo computed
  const esxStereoSampleFilledCount = useMemo(
    () => esxStereoSampleRows.filter(r => !r.empty).length,
    [esxStereoSampleRows]
  );
  const esxStereoSamplePendingCount = useMemo(
    () => countPendingEsxStereoSamplePatches(esxStereoSamplePending),
    [esxStereoSamplePending]
  );
  const esxStereoSampleVisibleRows = useMemo(
    () =>
      filterEsxStereoSampleRows(
        esxStereoSampleRows,
        esxSampleSearch,
        esxSampleHideEmpty
      ),
    [esxStereoSampleRows, esxSampleSearch, esxSampleHideEmpty]
  );
  const esxStereoSampleSelectedRow = useMemo(
    () =>
      esxStereoSampleSelectedSlot == null
        ? null
        : (esxStereoSampleRows.find(
            r => r.index === esxStereoSampleSelectedSlot
          ) ?? null),
    [esxStereoSampleRows, esxStereoSampleSelectedSlot]
  );
  const esxCompactReport = useMemo(
    () => (esxBankBuffer ? inspectEsxBankWaste(esxBankBuffer) : null),
    [esxBankBuffer]
  );
  const esxTotalPendingCount =
    esxPendingCount + esxSamplePendingCount + esxStereoSamplePendingCount;

  if (!open) return null;

  return (
    <div
      data-testid="korg-bank-editor-overlay"
      className="fixed inset-0 z-50 bg-bg-base/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={e => {
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
                    ? `ESX Bank-Edit · ${esxFilledCount}/256 Pat · ${esxSampleFilledCount}M/${esxStereoSampleFilledCount}S Smp · ${esxTotalPendingCount} geändert${esxCompactReport && esxCompactReport.orphanBytes > 0 ? ` · ${(esxCompactReport.orphanBytes / 1024 / 1024).toFixed(1)} MB Waste` : ""}`
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
        {/* v3.31.0 — ESX-Sample WAV picker (mono) */}
        <input
          ref={esxSampleReplaceInputRef}
          data-testid="korg-bank-editor-esx-sample-replace-input"
          type="file"
          accept=".wav,.aiff,.aif,.mp3,audio/*"
          className="hidden"
          onChange={handleEsxSampleReplaceInput}
        />
        {/* v3.32.0 — ESX-Stereo-Sample WAV picker */}
        <input
          ref={esxStereoSampleReplaceInputRef}
          data-testid="korg-bank-editor-esx-stereo-sample-replace-input"
          type="file"
          accept=".wav,.aiff,.aif,.mp3,audio/*"
          className="hidden"
          onChange={handleEsxStereoSampleReplaceInput}
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
              <>
                {mode === "edit" && e2sSourceBank && (
                  <button
                    data-testid="korg-bank-editor-e2s-export-samples"
                    onClick={handleE2sExportSamples}
                    disabled={busy}
                    className="px-3 py-1 rounded text-xs bg-bg-elevated text-text-primary hover:brightness-125 transition-all disabled:opacity-40 flex items-center gap-2"
                    title="Alle Samples der geladenen Bank als WAV-ZIP exportieren"
                  >
                    🎵 Samples als WAV
                  </button>
                )}
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
              </>
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
              Alle Project-Samples sind bereits in der Bank, oder die
              Sample-Library ist leer.
            </p>
          ) : (
            <ul className="space-y-1" data-testid="korg-bank-editor-picker">
              {availableSamples.map(s => (
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
                onChange={e =>
                  setTargetSr(Number(e.target.value) as 44100 | 48000)
                }
                className="bg-bg-elevated border border-border-color rounded text-xs px-1 py-0.5 text-text-primary"
              >
                {TARGET_SAMPLE_RATE_OPTIONS.map(r => (
                  <option key={r} value={r}>
                    {r} Hz
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-text-muted flex items-center gap-1">
              <input
                data-testid="korg-bank-editor-force-mono"
                type="checkbox"
                checked={forceMono}
                onChange={e => setForceMono(e.target.checked)}
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
                onChange={e => setFilename(e.target.value)}
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
              {newSlots.map(slot => (
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
                    onChange={e =>
                      updateNewSlot(slot.rowId, {
                        name: e.target.value.slice(0, 16),
                      })
                    }
                    maxLength={16}
                    className="flex-1 min-w-[80px] bg-bg-base border border-border-color rounded px-1 py-0.5 text-text-primary"
                  />
                  <select
                    data-testid={`korg-bank-editor-cat-${slot.rowId}`}
                    value={slot.category}
                    onChange={e =>
                      updateNewSlot(slot.rowId, {
                        category: Number(e.target.value),
                      })
                    }
                    className="bg-bg-base border border-border-color rounded text-xs px-1 py-0.5 text-text-primary w-24 flex-shrink-0"
                  >
                    {E2S_CATEGORY_NAMES.map((n, i) => (
                      <option key={i} value={i}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <label className="text-text-muted flex items-center gap-1 text-[10px]">
                    <input
                      type="checkbox"
                      checked={slot.oneshot}
                      onChange={e =>
                        updateNewSlot(slot.rowId, { oneshot: e.target.checked })
                      }
                    />
                    1-Shot
                  </label>
                  <span
                    className={`text-[10px] w-20 truncate ${slot.status === "error" ? "text-accent-danger" : "text-text-dim"}`}
                  >
                    {slot.status === "ready" && slot.frames
                      ? `${slot.frames} fr`
                      : slot.status}
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
              Tipp: Du kannst auch eine `.all` Datei direkt in dieses Fenster
              ziehen.
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
          <ul
            className="space-y-0.5"
            data-testid="korg-bank-editor-slot-browser"
          >
            {openedSlots.map(slot => (
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
                  <span
                    className={`flex-1 truncate ${slot.empty ? "text-text-dim italic" : "text-text-primary"}`}
                  >
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
            <div
              data-testid="korg-bank-editor-detail-empty"
              className="text-center py-8 space-y-3"
            >
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
                <span className="font-mono text-xs text-text-dim">
                  Slot #{selectedSlot.slotIndex}
                </span>
                <div className="flex items-center gap-2">
                  {selectedSlot.isDirty && (
                    <span className="text-[10px] text-accent-secondary">
                      ● geändert
                    </span>
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
                  onChange={e =>
                    editSlotPatch(selectedSlot.rowId, {
                      name: e.target.value.slice(0, 16),
                    })
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
                  onChange={e =>
                    editSlotPatch(selectedSlot.rowId, {
                      category: Number(e.target.value),
                    })
                  }
                  className="w-full mt-1 bg-bg-base border border-border-color rounded px-2 py-1 text-sm text-text-primary"
                >
                  {E2S_CATEGORY_NAMES.map((n, i) => (
                    <option key={i} value={i}>
                      {n}
                    </option>
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
                    onChange={e =>
                      editSlotPatch(selectedSlot.rowId, {
                        oneshot: e.target.checked,
                      })
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
                    onChange={e =>
                      editSlotPatch(selectedSlot.rowId, {
                        gain12db: e.target.checked,
                      })
                    }
                    className="accent-accent-primary"
                  />
                  +12 dB Gain
                </label>
              </div>

              {/* Sample-Tune (Oe2sSLE Coarse-Tune -63..+63) */}
              <label className="block text-xs text-text-muted">
                Sample-Tune: {selectedSlot.sampleTune}
                <input
                  data-testid="korg-bank-editor-detail-tune"
                  type="range"
                  min={-63}
                  max={63}
                  value={selectedSlot.sampleTune}
                  onChange={e =>
                    editSlotPatch(selectedSlot.rowId, {
                      sampleTune: Number(e.target.value),
                    })
                  }
                  className="w-full mt-1 accent-accent-primary"
                />
              </label>

              {/* Level (playVolume 0..127) */}
              <label className="block text-xs text-text-muted">
                Level: {selectedSlot.level}
                <input
                  data-testid="korg-bank-editor-detail-level"
                  type="range"
                  min={0}
                  max={127}
                  value={selectedSlot.level}
                  onChange={e =>
                    editSlotPatch(selectedSlot.rowId, {
                      level: Number(e.target.value),
                    })
                  }
                  className="w-full mt-1 accent-accent-primary"
                />
              </label>

              {/* Loop-Punkte (nur bei Forward-Loop, Oe2sSLE „Edit loop") */}
              {!selectedSlot.oneshot && (
                <div
                  className="space-y-2 pt-2 border-t border-border-color"
                  data-testid="korg-bank-editor-detail-loop"
                >
                  <div className="text-[11px] text-text-muted">
                    Loop-Punkte (Frames · von {selectedSlot.frames ?? 0})
                  </div>
                  <label className="block text-xs text-text-muted">
                    Loop-Start: {selectedSlot.loopStart}
                    <input
                      data-testid="korg-bank-editor-detail-loop-start"
                      type="range"
                      min={0}
                      max={Math.max(0, (selectedSlot.frames ?? 1) - 1)}
                      value={selectedSlot.loopStart}
                      onChange={e =>
                        editSlotPatch(selectedSlot.rowId, {
                          loopStart: Math.min(
                            Number(e.target.value),
                            selectedSlot.loopEnd
                          ),
                        })
                      }
                      className="w-full mt-1 accent-accent-primary"
                    />
                  </label>
                  <label className="block text-xs text-text-muted">
                    Loop-Ende: {selectedSlot.loopEnd}
                    <input
                      data-testid="korg-bank-editor-detail-loop-end"
                      type="range"
                      min={0}
                      max={Math.max(0, (selectedSlot.frames ?? 1) - 1)}
                      value={selectedSlot.loopEnd}
                      onChange={e =>
                        editSlotPatch(selectedSlot.rowId, {
                          loopEnd: Math.max(
                            Number(e.target.value),
                            selectedSlot.loopStart
                          ),
                        })
                      }
                      className="w-full mt-1 accent-accent-primary"
                    />
                  </label>
                  <button
                    data-testid="korg-bank-editor-detail-trim"
                    onClick={() => editSlotTrimToLoop(selectedSlot.rowId)}
                    disabled={
                      busy || selectedSlot.loopEnd <= selectedSlot.loopStart
                    }
                    className="px-2 py-1 rounded text-[11px] bg-bg-elevated text-text-primary hover:text-accent-primary transition-colors disabled:opacity-40"
                    title="PCM auf den Loop-Bereich schneiden (destruktiv, per Revert rückgängig)"
                  >
                    ✂ Auf Loop-Bereich trimmen
                  </button>
                </div>
              )}

              {/* Audio info + Replace */}
              <div className="text-xs text-text-muted space-y-1 pt-2 border-t border-border-color">
                <p>
                  Audio: {selectedSlot.channels === 2 ? "Stereo" : "Mono"} ·{" "}
                  {selectedSlot.sampleRate} Hz · {selectedSlot.frames} frames
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    data-testid="korg-bank-editor-replace-sample"
                    onClick={() => handleReplaceClick(selectedSlot.rowId)}
                    disabled={busy}
                    className="px-3 py-1 rounded text-xs bg-bg-elevated text-text-primary hover:text-accent-primary transition-colors disabled:opacity-40"
                  >
                    🎵 Sample ersetzen…
                  </button>
                  {selectedSlot.channels === 2 && (
                    <button
                      data-testid="korg-bank-editor-detail-stereo-to-mono"
                      onClick={() => editSlotStereoToMono(selectedSlot.rowId)}
                      disabled={busy}
                      className="px-3 py-1 rounded text-xs bg-bg-elevated text-text-primary hover:text-accent-primary transition-colors disabled:opacity-40"
                      title="Stereo auf Mono mischen (zentriert; per Revert rückgängig)"
                    >
                      ⇥ Stereo → Mono
                    </button>
                  )}
                </div>
                {/* #Num verschieben/tauschen (Oe2sSLE Move/Exchange) */}
                <label className="flex items-center gap-2 text-xs text-text-muted pt-1">
                  <span>#Num (verschieben / tauschen):</span>
                  <input
                    key={selectedSlot.rowId}
                    data-testid="korg-bank-editor-detail-move-num"
                    type="number"
                    min={0}
                    max={E2S_MAX_SLOTS - 1}
                    defaultValue={selectedSlot.slotIndex}
                    disabled={busy}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        editSlotMoveTo(
                          selectedSlot.rowId,
                          Number((e.target as HTMLInputElement).value)
                        );
                      }
                    }}
                    onBlur={e =>
                      editSlotMoveTo(selectedSlot.rowId, Number(e.target.value))
                    }
                    className="w-20 bg-bg-base border border-border-color rounded px-2 py-0.5 text-text-primary disabled:opacity-40"
                    title="Ziel-Nummer eingeben + Enter: leer → verschieben, belegt → tauschen"
                  />
                </label>
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
          <div className="text-center space-y-3 max-w-md">
            <p className="text-sm text-text-muted">
              Lade eine existierende{" "}
              <code className="text-text-primary">.esx</code> ESX-1 Bank (KORG
              ESX-1 Backup).
            </p>
            <p className="text-xs text-text-dim">
              Du kannst einzelne Pattern- oder Sample-Slots ersetzen. Alles
              andere (Songs, Globals, andere Slots) bleibt bit-exakt erhalten.
            </p>
            <div className="flex flex-col sm:flex-row items-stretch justify-center gap-2 pt-2">
              <button
                data-testid="korg-bank-editor-esx-open"
                onClick={handleOpenEsxBankClick}
                disabled={busy}
                className="px-4 py-2 rounded text-sm bg-accent-primary text-bg-base hover:opacity-90 transition-opacity disabled:opacity-40 inline-flex items-center justify-center gap-2"
              >
                📂 ESX-Bank öffnen
              </button>
              <button
                data-testid="korg-bank-editor-esx-new-from-scratch"
                onClick={handleNewEsxBankFromScratch}
                disabled={busy}
                className="px-4 py-2 rounded text-sm bg-accent-secondary text-bg-base hover:opacity-90 transition-opacity disabled:opacity-40 inline-flex items-center justify-center gap-2"
                title="Frische 256-Pattern ESX-1 Bank erzeugen (alle Slots leer, init-Pattern + keine Samples)"
              >
                🆕 Neue Bank from Scratch
              </button>
            </div>
            <p className="text-[10px] text-text-dim pt-1">
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
            Samples
            {esxSamplePendingCount + esxStereoSamplePendingCount > 0 && (
              <span className="ml-1 text-[10px] text-accent-danger">
                ●{esxSamplePendingCount + esxStereoSamplePendingCount}
              </span>
            )}
          </button>

          {/* v3.32.0 — Mono/Stereo Channel-Mode-Toggle (only in samples tab) */}
          {esxSubTab === "samples" && (
            <div
              role="tablist"
              data-testid="korg-bank-editor-esx-sample-channel-toggle"
              className="flex rounded border border-border-color overflow-hidden text-[10px] ml-2"
            >
              <button
                role="tab"
                data-testid="korg-bank-editor-esx-sample-channel-mono"
                aria-selected={esxSampleChannelMode === "mono"}
                onClick={() => setEsxSampleChannelMode("mono")}
                disabled={busy}
                className={`px-2 py-0.5 transition-colors disabled:opacity-40 ${
                  esxSampleChannelMode === "mono"
                    ? "bg-accent-secondary text-bg-base"
                    : "bg-bg-elevated text-text-muted hover:text-text-primary"
                }`}
              >
                Mono ({esxSampleFilledCount})
              </button>
              <button
                role="tab"
                data-testid="korg-bank-editor-esx-sample-channel-stereo"
                aria-selected={esxSampleChannelMode === "stereo"}
                onClick={() => setEsxSampleChannelMode("stereo")}
                disabled={busy}
                className={`px-2 py-0.5 transition-colors disabled:opacity-40 ${
                  esxSampleChannelMode === "stereo"
                    ? "bg-accent-secondary text-bg-base"
                    : "bg-bg-elevated text-text-muted hover:text-text-primary"
                }`}
              >
                Stereo ({esxStereoSampleFilledCount})
              </button>
            </div>
          )}

          {/* v3.38.0 — Undo/Redo-Buttons (always visible in ESX mode, right-side) */}
          <div
            className="ml-auto flex items-center gap-1"
            data-testid="korg-bank-editor-esx-history-controls"
          >
            <button
              data-testid="korg-bank-editor-esx-undo"
              onClick={handleEsxUndo}
              disabled={busy || !esxCanUndo}
              className="px-2 py-0.5 rounded text-[11px] bg-bg-elevated text-text-muted hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title={`Rückgängig (Ctrl+Z) — ${esxHistory.past.length} verfügbar`}
              aria-label="Undo"
            >
              ↶ Undo{" "}
              {esxHistory.past.length > 0 && (
                <span className="text-[9px] text-text-dim ml-0.5">
                  ({esxHistory.past.length})
                </span>
              )}
            </button>
            <button
              data-testid="korg-bank-editor-esx-redo"
              onClick={handleEsxRedo}
              disabled={busy || !esxCanRedo}
              className="px-2 py-0.5 rounded text-[11px] bg-bg-elevated text-text-muted hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title={`Wiederholen (Ctrl+Shift+Z) — ${esxHistory.future.length} verfügbar`}
              aria-label="Redo"
            >
              ↷ Redo{" "}
              {esxHistory.future.length > 0 && (
                <span className="text-[9px] text-text-dim ml-0.5">
                  ({esxHistory.future.length})
                </span>
              )}
            </button>
          </div>

          {/* v3.32.0 — Compact-Bank-Button (only in samples tab) */}
          {esxSubTab === "samples" &&
            esxCompactReport &&
            esxCompactReport.orphanBytes > 0 && (
              <button
                data-testid="korg-bank-editor-esx-compact"
                onClick={handleEsxCompactBank}
                disabled={busy}
                className="px-2 py-0.5 rounded text-[10px] bg-accent-secondary text-bg-base hover:opacity-90 transition-opacity disabled:opacity-40"
                title={`Spare ${(esxCompactReport.orphanBytes / 1024 / 1024).toFixed(2)} MB durch Compaction`}
              >
                🗜 Compact Bank (
                {(esxCompactReport.orphanBytes / 1024 / 1024).toFixed(2)} MB)
              </button>
            )}
        </div>

        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          {esxSubTab === "patterns"
            ? renderEsxPatternsBody()
            : esxSampleChannelMode === "mono"
              ? renderEsxSamplesBody()
              : renderEsxStereoSamplesBody()}
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
              onChange={e => setEsxSearch(e.target.value)}
              className="flex-1 min-w-[120px] bg-bg-elevated border border-border-color rounded text-xs px-2 py-0.5 text-text-primary placeholder:text-text-dim"
            />
            <label className="text-[10px] text-text-muted flex items-center gap-1">
              <input
                data-testid="korg-bank-editor-esx-hide-init"
                type="checkbox"
                checked={esxHideInit}
                onChange={e => setEsxHideInit(e.target.checked)}
                className="accent-accent-primary"
              />
              Init verbergen
            </label>
            <label className="text-[10px] text-text-muted flex items-center gap-1">
              <input
                data-testid="korg-bank-editor-esx-hide-empty"
                type="checkbox"
                checked={esxHideEmpty}
                onChange={e => setEsxHideEmpty(e.target.checked)}
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
              esxVisibleRows.map(r => {
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
                  Den Slot mit dem aktuell aktiven Synthstudio-Pattern ersetzen.
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
                    onChange={e => setFilename(e.target.value)}
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
              Mono-Sample-Slots ({esxSampleVisibleRows.length}/
              {esxSampleRows.length})
            </h3>
          </div>

          {/* Filter row */}
          <div className="flex items-center gap-2 flex-wrap">
            <input
              data-testid="korg-bank-editor-esx-sample-search"
              type="text"
              placeholder="Suchen (Name oder Index)"
              value={esxSampleSearch}
              onChange={e => setEsxSampleSearch(e.target.value)}
              className="flex-1 min-w-[120px] bg-bg-elevated border border-border-color rounded text-xs px-2 py-0.5 text-text-primary placeholder:text-text-dim"
            />
            <label className="text-[10px] text-text-muted flex items-center gap-1">
              <input
                data-testid="korg-bank-editor-esx-sample-hide-empty"
                type="checkbox"
                checked={esxSampleHideEmpty}
                onChange={e => setEsxSampleHideEmpty(e.target.checked)}
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
              esxSampleVisibleRows.map(r => {
                const dirty = esxSamplePending.has(r.index);
                const selected = esxSampleSelectedSlot === r.index;
                const isDropTarget = esxSampleDropTargetSlot === r.index;
                return (
                  <li
                    key={r.index}
                    onDragOver={e => handleEsxSampleDragOver(e, r.index)}
                    onDragLeave={handleEsxSampleDragLeave}
                    onDrop={e => handleEsxSampleDrop(e, r.index)}
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
                Tipp: Du kannst auch eine WAV-Datei direkt auf einen Slot
                ziehen.
              </span>
            </p>
          ) : (
            <div
              data-testid="korg-bank-editor-esx-sample-detail"
              className="space-y-3"
            >
              <div className="flex items-center justify-between pb-2 border-b border-border-color">
                <span className="font-mono text-xs text-text-dim">
                  Mono-Sample-Slot #
                  {esxSampleSelectedRow.index.toString().padStart(3, "0")}
                </span>
                {esxSamplePending.has(esxSampleSelectedRow.index) && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-accent-danger">
                      ● wird ersetzt
                    </span>
                    <button
                      data-testid="korg-bank-editor-esx-sample-revert"
                      onClick={() =>
                        handleEsxSampleRevertSlot(esxSampleSelectedRow.index)
                      }
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
                        {esxSampleSelectedRow.channels === 1
                          ? "Mono"
                          : "Stereo"}
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
                          esxSampleSelectedRow.sampleRate
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

              {/* v3.284 — Sample umbenennen (name-only, bit-exakt) */}
              {!esxSampleSelectedRow.empty && (
                <div className="pt-2 border-t border-border-color space-y-1">
                  <label className="block text-xs text-text-muted">
                    Umbenennen (max 8 ASCII Zeichen)
                    <input
                      data-testid="korg-bank-editor-esx-sample-rename"
                      type="text"
                      maxLength={8}
                      value={
                        esxSampleRenamePending.get(
                          esxSampleRenameKey(1, esxSampleSelectedRow.index)
                        )?.name ?? esxSampleSelectedRow.name
                      }
                      onChange={e => {
                        const name = e.target.value.slice(0, 8);
                        const idx = esxSampleSelectedRow.index;
                        if (name === esxSampleSelectedRow.name) {
                          // Zurück zum Original → Rename ausstagen.
                          setEsxSampleRenamePending(prev =>
                            unstageEsxSampleRename(prev, 1, idx)
                          );
                        } else {
                          setEsxSampleRenamePending(prev =>
                            stageEsxSampleRename(prev, {
                              index: idx,
                              channels: 1,
                              name,
                            })
                          );
                        }
                      }}
                      className="w-full mt-1 bg-bg-base border border-border-color rounded px-2 py-1 text-sm text-text-primary"
                    />
                  </label>
                  {esxSampleRenamePending.has(
                    esxSampleRenameKey(1, esxSampleSelectedRow.index)
                  ) && (
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[10px] text-accent-secondary"
                        data-testid="korg-bank-editor-esx-sample-rename-badge"
                      >
                        ● wird umbenannt
                      </span>
                      <button
                        onClick={() =>
                          setEsxSampleRenamePending(prev =>
                            unstageEsxSampleRename(
                              prev,
                              1,
                              esxSampleSelectedRow.index
                            )
                          )
                        }
                        className="px-2 py-0.5 rounded text-[10px] bg-bg-elevated text-text-muted hover:text-text-primary transition-colors"
                        title="Umbenennung verwerfen"
                      >
                        ↺ Revert
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-2 border-t border-border-color space-y-2">
                <p className="text-xs text-text-muted">
                  Den Slot mit einer WAV/AIFF/MP3-Datei ersetzen. Wird auf 44100
                  Hz Mono resampelt (ESX-1 Hardware-Format).
                </p>
                <button
                  data-testid="korg-bank-editor-esx-sample-replace"
                  onClick={() =>
                    handleEsxSampleReplaceClick(esxSampleSelectedRow.index)
                  }
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
                    onChange={e => setFilename(e.target.value)}
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

  // ─── Render: ESX-Stereo-Sample-Patch Sub-Tab (v3.32.0) ────────────────────

  function renderEsxStereoSamplesBody(): React.ReactElement {
    return (
      <>
        {/* Left — Stereo-Sample-Slot-Liste */}
        <div className="md:w-2/5 border-r border-border-color overflow-y-auto p-2 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-xs font-semibold text-text-primary">
              Stereo-Sample-Slots ({esxStereoSampleVisibleRows.length}/
              {esxStereoSampleRows.length})
            </h3>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <input
              data-testid="korg-bank-editor-esx-stereo-sample-search"
              type="text"
              placeholder="Suchen (Name oder Index)"
              value={esxSampleSearch}
              onChange={e => setEsxSampleSearch(e.target.value)}
              className="flex-1 min-w-[120px] bg-bg-elevated border border-border-color rounded text-xs px-2 py-0.5 text-text-primary placeholder:text-text-dim"
            />
            <label className="text-[10px] text-text-muted flex items-center gap-1">
              <input
                data-testid="korg-bank-editor-esx-stereo-sample-hide-empty"
                type="checkbox"
                checked={esxSampleHideEmpty}
                onChange={e => setEsxSampleHideEmpty(e.target.checked)}
                className="accent-accent-primary"
              />
              Leere verbergen
            </label>
          </div>

          <ul
            className="space-y-0.5 flex-1 min-h-0"
            data-testid="korg-bank-editor-esx-stereo-sample-list"
          >
            {esxStereoSampleVisibleRows.length === 0 ? (
              <li className="text-xs text-text-dim italic py-4 text-center">
                Keine Stereo-Slots passen zu deinem Filter.
              </li>
            ) : (
              esxStereoSampleVisibleRows.map(r => {
                const dirty = esxStereoSamplePending.has(r.index);
                const selected = esxStereoSampleSelectedSlot === r.index;
                return (
                  <li key={r.index}>
                    <button
                      data-testid={`korg-bank-editor-esx-stereo-sample-slot-${r.index}`}
                      onClick={() => setEsxStereoSampleSelectedSlot(r.index)}
                      className={`w-full flex items-center gap-2 px-2 py-1 rounded text-xs text-left transition-colors border ${
                        selected
                          ? "border-accent-primary bg-bg-elevated"
                          : "border-transparent hover:bg-bg-elevated"
                      } ${r.empty && !dirty ? "opacity-50" : ""}`}
                    >
                      <span className="font-mono text-text-dim w-10 flex-shrink-0">
                        S#{r.index.toString().padStart(3, "0")}
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
                          data-testid={`korg-bank-editor-esx-stereo-sample-dirty-${r.index}`}
                          className="text-[10px] text-accent-danger flex-shrink-0"
                          title="Stereo-Slot wird beim Speichern überschrieben"
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

        {/* Right — Stereo-Sample-Slot-Detail */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {esxStereoSampleSelectedRow === null ? (
            <p
              data-testid="korg-bank-editor-esx-stereo-sample-no-selection"
              className="text-xs text-text-muted text-center py-8"
            >
              Wähle links einen Stereo-Sample-Slot aus, um ihn mit einer
              WAV-Datei zu ersetzen.
              <br />
              <span className="text-[10px] text-text-dim">
                Stereo-Inputs bleiben L+R; Mono-Inputs werden auf beide Channels
                dupliziert.
              </span>
            </p>
          ) : (
            <div
              data-testid="korg-bank-editor-esx-stereo-sample-detail"
              className="space-y-3"
            >
              <div className="flex items-center justify-between pb-2 border-b border-border-color">
                <span className="font-mono text-xs text-text-dim">
                  Stereo-Sample-Slot S#
                  {esxStereoSampleSelectedRow.index.toString().padStart(3, "0")}
                </span>
                {esxStereoSamplePending.has(
                  esxStereoSampleSelectedRow.index
                ) && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-accent-danger">
                      ● wird ersetzt
                    </span>
                    <button
                      data-testid="korg-bank-editor-esx-stereo-sample-revert"
                      onClick={() =>
                        handleEsxStereoSampleRevertSlot(
                          esxStereoSampleSelectedRow.index
                        )
                      }
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
                    {esxStereoSampleSelectedRow.empty
                      ? "—Empty—"
                      : esxStereoSampleSelectedRow.name || "(unnamed)"}
                  </span>
                </p>
                {!esxStereoSampleSelectedRow.empty && (
                  <>
                    <p>
                      <span className="text-text-dim">Channels:</span>{" "}
                      <span className="text-text-primary">Stereo (L+R)</span>
                    </p>
                    <p>
                      <span className="text-text-dim">Sample-Rate:</span>{" "}
                      <span className="text-text-primary">
                        {esxStereoSampleSelectedRow.sampleRate} Hz
                      </span>
                    </p>
                    <p>
                      <span className="text-text-dim">Länge:</span>{" "}
                      <span className="text-text-primary">
                        {formatSampleLength(
                          esxStereoSampleSelectedRow.frames,
                          esxStereoSampleSelectedRow.sampleRate
                        )}{" "}
                        ({esxStereoSampleSelectedRow.frames} fr / Kanal)
                      </span>
                    </p>
                    <p>
                      <span className="text-text-dim">Level:</span>{" "}
                      <span className="text-text-primary">
                        {esxStereoSampleSelectedRow.level}/127
                      </span>
                    </p>
                  </>
                )}
              </div>

              <div className="pt-2 border-t border-border-color space-y-2">
                <p className="text-xs text-text-muted">
                  Den Stereo-Slot mit einer WAV/AIFF/MP3-Datei ersetzen. Wird
                  auf 44100 Hz resampelt. Mono-Inputs → L=R dupliziert.
                </p>
                <button
                  data-testid="korg-bank-editor-esx-stereo-sample-replace"
                  onClick={() =>
                    handleEsxStereoSampleReplaceClick(
                      esxStereoSampleSelectedRow.index
                    )
                  }
                  disabled={busy}
                  className="w-full px-3 py-2 rounded text-sm bg-accent-primary text-bg-base hover:opacity-90 transition-opacity disabled:opacity-40 inline-flex items-center justify-center gap-2"
                >
                  🎵 Mit Stereo-WAV ersetzen…
                </button>
              </div>

              <div className="pt-2 border-t border-border-color">
                <label className="block text-xs text-text-muted">
                  Dateiname beim Speichern
                  <input
                    data-testid="korg-bank-editor-esx-stereo-sample-filename"
                    type="text"
                    value={filename}
                    onChange={e => setFilename(e.target.value)}
                    className="w-full mt-1 bg-bg-base border border-border-color rounded px-2 py-1 text-sm text-text-primary"
                  />
                </label>
              </div>
            </div>
          )}

          {resultMsg && (
            <p
              data-testid="korg-bank-editor-esx-stereo-sample-status"
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
      endFrame: number
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
          endFrame
        );
        if (buf.length === 0) return;
        const startedAt =
          typeof performance !== "undefined" ? performance.now() : Date.now();
        const durationMs = (buf.length / Math.max(1, slot.sampleRate)) * 1000;
        const handle = playSliceWithContext(ctx, buf, slot.sampleRate, {
          onEnded: (): void => {
            // Bei natürlichem Ende oder stop(): Audition-State leeren —
            // aber nur wenn es noch das aktuelle Audition ist.
            setAuditionState(prev =>
              prev &&
              prev.rowId === slot.rowId &&
              prev.sliceIndex === sliceIndex
                ? null
                : prev
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
          playingSliceIndex={
            isPlayingThisSlot ? auditionState!.sliceIndex : null
          }
          playingStartedAt={isPlayingThisSlot ? auditionState!.startedAt : null}
          playingDurationMs={
            isPlayingThisSlot ? auditionState!.durationMs : null
          }
        />

        <p
          className="text-[10px] text-text-dim"
          data-testid="korg-bank-editor-slice-help"
        >
          {sliceCount > 0 ? (
            <>
              <span className="text-accent-primary font-semibold">
                ▶ Klick auf Slice
              </span>{" "}
              = abspielen · Alt/Ctrl+Klick = Marker hinzufügen · Drag =
              verschieben · Shift/Rechtsklick = entfernen · max{" "}
              {MAX_ESLI_SLICES} Slices
            </>
          ) : (
            <>
              Linksklick = Marker hinzufügen · max {MAX_ESLI_SLICES} Slices
              (E2S-Hardware-Limit)
            </>
          )}
        </p>
      </div>
    );
  }
}

export default KorgBankEditor;
