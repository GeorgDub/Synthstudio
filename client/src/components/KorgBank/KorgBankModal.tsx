/**
 * Synthstudio – KorgBankModal (v3.3.0)
 *
 * Read-Only-Viewer für ESX-1 .esx und E2S .all Sample-Banks.
 *
 * Workflow:
 *   1. Caller setzt `file` → Modal lädt ArrayBuffer, detektiert Bank-Typ
 *      (Magic-Sniff), parsed und zeigt Sample-Liste.
 *   2. User kann pro Slot:
 *        - "Preview" → AudioEngine.playSliceBuffer (Float32 + sampleRate)
 *        - "Add to Project" → erzeugt eine WAV-Blob-URL + Sample in
 *          useProjectStore.addSamples (kategorie 'korg-esx'/'korg-e2s')
 *   3. "Import All" → Bulk-Add aller non-null Slots.
 *
 * Isomorph: parser sind pure-Funktionen, Audio-Preview nutzt AudioEngine
 *           (Web Audio API, gleich in Browser + Electron), Blob-URL für
 *           Sample-Library funktioniert in beiden Modi.
 *
 * Defensive:
 *   - Sehr große Banks (250 slots × bis zu 10 MB) → "Preview" und "Add" sind
 *     individuelle Aktionen; "Import All" bestätigt zuerst.
 *   - Beim Schließen werden erzeugte Blob-URLs NICHT revoked weil
 *     useProjectStore sie ggf. noch braucht (Caller-Pflicht).
 *
 * Semantic Tailwind classes only — kein hardcoded slate/cyan/etc.
 */

import React, { useEffect, useMemo, useState } from "react";
import { AudioEngine } from "@/audio/AudioEngine";
import {
  parseEsxBank,
  type EsxBank,
  type EsxPattern,
  type EsxSample,
  type EsxSong,
} from "@/utils/korg/esxParser";
import {
  convertEsxPatternToSynthstudio,
  convertEsxSongToSynthstudio,
  type SynthstudioPatternImport,
  type SynthstudioSongArrangement,
} from "@/utils/korg/esxPatternConvert";
import { buildSlotIndexMap } from "@/utils/korg/esxSampleLink";
import {
  parseE2sBank,
  type E2sBank,
  type E2sSlot,
} from "@/utils/korg/e2sBankReader";
import { detectKorgBankType, type KorgBankType } from "@/utils/korg/bankDetect";
import { toast } from "@/store/useToastStore";
import { useConfirm } from "@/components/common/ConfirmDialog";

// ─── Public Props ─────────────────────────────────────────────────────────────

export interface KorgBankModalProps {
  /** Die zu öffnende KORG-Bank-Datei (.esx oder .all). `null` schließt Modal. */
  file: File | null;
  /** Schließen-Callback. Caller darf File-State zurücksetzen. */
  onClose: () => void;
  /**
   * Wird pro Slot aufgerufen, wenn der User "Add to Project" klickt
   * (oder "Import All" benutzt). Liefert den dekodierten Slot + eine
   * Synthstudio-Sample-Spec (id/name/url/category) — Caller verbindet
   * das mit useProjectStore.addSamples / useDrumMachineStore etc.
   */
  onAddSample?: (sample: KorgBankSample) => void;
  /**
   * v3.5 — wird pro Pattern aufgerufen wenn der User "Import Pattern"
   * klickt. Liefert das konvertierte Synthstudio-Pattern; der Caller
   * wendet es auf useDrumMachineStore / useAutomationStore an.
   */
  onAddPattern?: (pattern: SynthstudioPatternImport) => void;
  /**
   * v3.89.0 — wird beim Import eines ESX-1 Songs aufgerufen. Liefert das
   * konvertierte Song-Arrangement (slots[]). Caller faechert das auf
   * useSongStore.createArrangement (siehe App.tsx-Wiring).
   */
  onAddSong?: (song: SynthstudioSongArrangement) => void;
}

/** Result-Spec, die der Caller in seinen Sample-Store überführen kann. */
export interface KorgBankSample {
  id: string;
  name: string;
  /** Blob-URL einer WAV-Datei (audio/wav). */
  url: string;
  /** Kategorie-Tag, z.B. "korg-esx-mono", "korg-e2s". */
  category: string;
  /** Sample-Rate. */
  sampleRate: number;
  /** Channels (1 oder 2). */
  channels: 1 | 2;
  /** Anzahl Frames. */
  frames: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface DisplayRow {
  /** Eindeutige Row-ID innerhalb der Modal-Liste. */
  rowId: string;
  index: number;
  name: string;
  category: string;
  channels: 1 | 2;
  sampleRate: number;
  frames: number;
  /** Sekundenangabe (frames / sampleRate), gerundet. */
  durationSec: number;
  pcmData: Float32Array;
}

/** Wandelt ein Float32-PCM-Buffer in eine WAV-Blob-URL (audio/wav). */
function encodeWav(
  pcm: Float32Array,
  sampleRate: number,
  channels: 1 | 2,
): Blob {
  // PCM Float32 → 16-bit LE WAV. Standard-Format.
  const numFrames = (pcm.length / channels) | 0;
  const byteRate = sampleRate * channels * 2;
  const blockAlign = channels * 2;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const dv = new DataView(buffer);
  // RIFF header
  dv.setUint8(0, 0x52); dv.setUint8(1, 0x49); dv.setUint8(2, 0x46); dv.setUint8(3, 0x46); // "RIFF"
  dv.setUint32(4, 36 + dataSize, true);
  dv.setUint8(8, 0x57); dv.setUint8(9, 0x41); dv.setUint8(10, 0x56); dv.setUint8(11, 0x45); // "WAVE"
  // fmt
  dv.setUint8(12, 0x66); dv.setUint8(13, 0x6d); dv.setUint8(14, 0x74); dv.setUint8(15, 0x20); // "fmt "
  dv.setUint32(16, 16, true); // size
  dv.setUint16(20, 1, true);  // PCM
  dv.setUint16(22, channels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, byteRate, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, 16, true);
  // data
  dv.setUint8(36, 0x64); dv.setUint8(37, 0x61); dv.setUint8(38, 0x74); dv.setUint8(39, 0x61); // "data"
  dv.setUint32(40, dataSize, true);
  // PCM-Daten
  let off = 44;
  for (let i = 0; i < pcm.length; i++) {
    let v = Math.max(-1, Math.min(1, pcm[i]));
    v = v < 0 ? v * 0x8000 : v * 0x7fff;
    dv.setInt16(off, v | 0, true);
    off += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function rowsFromEsx(bank: EsxBank): DisplayRow[] {
  const rows: DisplayRow[] = [];
  const make = (s: EsxSample, kind: "mono" | "stereo"): DisplayRow => ({
    rowId: `esx-${kind}-${s.index}`,
    index: s.index,
    name: s.name || `(${kind}-${s.index})`,
    category: kind === "mono" ? "ESX-1 Mono" : "ESX-1 Stereo",
    channels: s.channels,
    sampleRate: s.sampleRate,
    frames: s.frames,
    durationSec: s.sampleRate > 0 ? s.frames / s.sampleRate : 0,
    pcmData: s.pcmData,
  });
  for (const s of bank.monoSamples) rows.push(make(s, "mono"));
  for (const s of bank.stereoSamples) rows.push(make(s, "stereo"));
  return rows;
}

function rowsFromE2s(bank: E2sBank): DisplayRow[] {
  const rows: DisplayRow[] = [];
  for (const s of bank.slots) {
    if (!s) continue;
    rows.push({
      rowId: `e2s-${s.index}`,
      index: s.index,
      name: s.name || `(slot-${s.index})`,
      category: `E2S · ${s.categoryName}`,
      channels: s.channels,
      sampleRate: s.sampleRate,
      frames: s.frames,
      durationSec: s.sampleRate > 0 ? s.frames / s.sampleRate : 0,
      pcmData: s.pcmData,
    });
  }
  return rows;
}

interface ModalState {
  rows: DisplayRow[];
  /** v3.5 — Patterns (nur fuer ESX-1). E2S hat keine Patterns. */
  patterns: EsxPattern[];
  /** v3.89.0 — Songs (nur fuer ESX-1). E2S hat keine Songs. */
  songs: EsxSong[];
  bankType: KorgBankType;
  warnings: string[];
  loading: boolean;
  error: string | null;
}

type ModalTab = "samples" | "patterns" | "songs";

const INITIAL_STATE: ModalState = {
  rows: [],
  patterns: [],
  songs: [],
  bankType: "unknown",
  warnings: [],
  loading: false,
  error: null,
};

// ─── Component ────────────────────────────────────────────────────────────────

export function KorgBankModal({
  file,
  onClose,
  onAddSample,
  onAddPattern,
  onAddSong,
}: KorgBankModalProps): React.ReactElement | null {
  const [state, setState] = useState<ModalState>(INITIAL_STATE);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [previewSlot, setPreviewSlot] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ModalTab>("samples");
  const confirm = useConfirm();

  useEffect(() => {
    if (!file) {
      setState(INITIAL_STATE);
      return;
    }
    let cancelled = false;
    setState({ ...INITIAL_STATE, loading: true });

    file.arrayBuffer().then(
      (buf) => {
        if (cancelled) return;
        try {
          const u8 = new Uint8Array(buf);
          const type = detectKorgBankType(u8);
          if (type === "esx") {
            const bank = parseEsxBank(u8, file.name);
            const rows = rowsFromEsx(bank);
            setState({
              rows,
              patterns: bank.patterns,
              songs: bank.songs,
              bankType: "esx",
              warnings: bank.warnings,
              loading: false,
              error: null,
            });
          } else if (type === "e2s") {
            const bank = parseE2sBank(u8, file.name);
            const rows = rowsFromE2s(bank);
            setState({
              rows,
              patterns: [],
              songs: [],
              bankType: "e2s",
              warnings: bank.warnings,
              loading: false,
              error: null,
            });
          } else {
            setState({
              ...INITIAL_STATE,
              error: `Datei "${file.name}" ist keine erkennbare KORG-Sample-Bank (.esx/.all).`,
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setState({ ...INITIAL_STATE, error: msg });
        }
      },
      (err) => {
        if (cancelled) return;
        setState({ ...INITIAL_STATE, error: String(err) });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [file]);

  // ── Memoized filtered rows ─────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return state.rows;
    const q = searchQuery.trim().toLowerCase();
    return state.rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q),
    );
  }, [state.rows, searchQuery]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  function handlePreview(row: DisplayRow): void {
    setPreviewSlot(row.rowId);
    try {
      if (row.channels === 1) {
        AudioEngine.playSliceBuffer(row.pcmData, row.sampleRate);
      } else {
        // Stereo-Preview: nur den linken Kanal (deinterleaved). Stereo-Preview
        // im Slice-Player ist out-of-scope für v3.3.
        const frames = row.frames;
        const left = new Float32Array(frames);
        for (let i = 0; i < frames; i++) left[i] = row.pcmData[i * 2];
        AudioEngine.playSliceBuffer(left, row.sampleRate);
      }
    } catch {
      /* ignore — Audio-Init pflichtversagt → kein crash */
    }
    // Reset highlight nach kurzer Zeit
    setTimeout(() => setPreviewSlot((cur) => (cur === row.rowId ? null : cur)), 800);
  }

  function buildSample(row: DisplayRow): KorgBankSample {
    const blob = encodeWav(row.pcmData, row.sampleRate, row.channels);
    const url = URL.createObjectURL(blob);
    return {
      id: `korg-${Date.now()}-${row.rowId}`,
      name: `${row.name || `slot-${row.index}`}.wav`,
      url,
      category:
        state.bankType === "esx"
          ? row.channels === 1
            ? "korg-esx-mono"
            : "korg-esx-stereo"
          : "korg-e2s",
      sampleRate: row.sampleRate,
      channels: row.channels,
      frames: row.frames,
    };
  }

  function handleAddOne(row: DisplayRow): void {
    if (!onAddSample) return;
    try {
      onAddSample(buildSample(row));
      toast(`KORG: "${row.name}" zur Sample-Library hinzugefuegt`, { kind: "success", duration: 2000 });
    } catch (err) {
      toast(`Fehler beim Hinzufuegen: ${String(err)}`, { kind: "error" });
    }
  }

  async function handleImportAll(): Promise<void> {
    if (!onAddSample) {
      toast("Kein Sample-Receiver konfiguriert", { kind: "warning" });
      return;
    }
    const count = filteredRows.length;
    if (count === 0) return;
    const ok = await confirm({
      title: `${count} Sample(s) zur Sample-Library hinzufuegen?`,
      confirmLabel: "Hinzufuegen",
    });
    if (!ok) return;
    let added = 0;
    for (const row of filteredRows) {
      try {
        onAddSample(buildSample(row));
        added++;
      } catch {
        /* skip errored row */
      }
    }
    toast(`KORG: ${added}/${count} Samples importiert`, { kind: "success", duration: 3000 });
  }

  // ── Pattern Handlers (v3.5) ────────────────────────────────────────────────

  /**
   * v3.264: Reichert die konvertierten drumParts mit Blob-URLs der Bank-Samples
   * an (sampleId → Slot-Lookup). Ohne sampleUrl bleibt das importierte Pattern
   * beim Play stumm — genau der Synth.md-Bug. Blob-URLs werden pro sampleId
   * gecacht (mehrere Parts können dasselbe Sample referenzieren).
   */
  function enrichPatternWithSampleUrls(
    conv: SynthstudioPatternImport,
  ): SynthstudioPatternImport {
    const slotMap = buildSlotIndexMap(state.rows);
    const urlCache = new Map<number, string>();
    const drumParts = conv.drumParts.map((dp) => {
      // Nur Parts mit aktiven Steps verlinken. Unassigned-Parts kollabiert der
      // Parser auf sampleId 0 (Sentinel 0x8000 → 0); ohne diesen Guard würden
      // leere Parts fälschlich Mono-Slot 0 zugeordnet (Advisor-Hinweis).
      if (!dp.steps.some((active) => active)) return dp;
      const arrayIdx = slotMap.get(dp.sampleId);
      if (arrayIdx === undefined) return dp;
      let url = urlCache.get(dp.sampleId);
      if (!url) {
        try {
          url = buildSample(state.rows[arrayIdx]).url;
          urlCache.set(dp.sampleId, url);
        } catch {
          return dp; // Encode-Fehler → Part bleibt ohne URL (kein Crash).
        }
      }
      return { ...dp, sampleUrl: url };
    });
    return { ...conv, drumParts };
  }

  function handleImportPattern(pat: EsxPattern): void {
    if (!onAddPattern) {
      toast("Kein Pattern-Receiver konfiguriert", { kind: "warning" });
      return;
    }
    try {
      const conv = enrichPatternWithSampleUrls(convertEsxPatternToSynthstudio(pat));
      const linked = conv.drumParts.filter((d) => d.sampleUrl).length;
      onAddPattern(conv);
      toast(
        `KORG: Pattern "${conv.name}" importiert (${linked} Spur(en) mit Sample)`,
        { kind: "success", duration: 2500 },
      );
    } catch (err) {
      toast(`Pattern-Import-Fehler: ${String(err)}`, { kind: "error" });
    }
  }

  async function handleImportAllPatterns(): Promise<void> {
    if (!onAddPattern) {
      toast("Kein Pattern-Receiver konfiguriert", { kind: "warning" });
      return;
    }
    const count = state.patterns.length;
    if (count === 0) return;
    const ok = await confirm({
      title: `${count} Pattern(s) importieren?`,
      confirmLabel: "Importieren",
    });
    if (!ok) return;
    let added = 0;
    for (const pat of state.patterns) {
      try {
        onAddPattern(enrichPatternWithSampleUrls(convertEsxPatternToSynthstudio(pat)));
        added++;
      } catch {
        /* skip errored */
      }
    }
    toast(`KORG: ${added}/${count} Patterns importiert`, { kind: "success", duration: 3000 });
  }

  // ── Song Handlers (v3.89.0) ────────────────────────────────────────────────
  function handleImportSong(song: EsxSong): void {
    if (!onAddSong) {
      toast("Kein Song-Receiver konfiguriert", { kind: "warning" });
      return;
    }
    try {
      const conv = convertEsxSongToSynthstudio(song);
      if (conv.slots.length === 0) {
        toast(`KORG: Song "${conv.name}" hat keine Events`, { kind: "warning", duration: 2500 });
        return;
      }
      onAddSong(conv);
      toast(`KORG: Song "${conv.name}" mit ${conv.slots.length} Slots importiert`, {
        kind: "success",
        duration: 2500,
      });
    } catch (err) {
      toast(`Song-Import-Fehler: ${String(err)}`, { kind: "error" });
    }
  }

  if (!file) return null;

  return (
    <div
      data-testid="korg-bank-modal-overlay"
      className="fixed inset-0 z-50 bg-bg-base/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        // Only close on overlay-click, not on inner-element-click
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid="korg-bank-modal"
        className="bg-bg-panel border border-border-color rounded-lg shadow-xl max-w-4xl w-full max-h-[85vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <header className="px-4 py-3 border-b border-border-color flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-text-primary">
              KORG Sample-Bank
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              {file.name}
              {" · "}
              {state.bankType === "esx" && "ESX-1 Backup"}
              {state.bankType === "e2s" && "E2S Sample-Bank"}
              {state.bankType === "unknown" && (state.loading ? "wird geladen..." : "unbekannt")}
              {state.rows.length > 0 && ` · ${state.rows.length} Samples`}
            </p>
          </div>
          <button
            data-testid="korg-bank-close"
            onClick={onClose}
            className="px-2 py-1 text-xs rounded bg-bg-elevated text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors"
            title="Schliessen"
          >
            ✕
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
          {state.loading && (
            <p data-testid="korg-bank-loading" className="text-sm text-text-muted">
              Lade {file.name}...
            </p>
          )}

          {state.error && (
            <div
              data-testid="korg-bank-error"
              className="px-3 py-2 rounded border border-accent-danger bg-accent-danger/10 text-sm text-accent-danger"
            >
              {state.error}
            </div>
          )}

          {!state.loading && !state.error && (state.rows.length > 0 || state.patterns.length > 0 || state.songs.length > 0) && (
            <>
              {/* Tab-Bar (nur wenn Patterns oder Songs vorhanden, sonst nur Samples) */}
              {state.bankType === "esx" && (state.patterns.length > 0 || state.songs.length > 0) && (
                <div
                  data-testid="korg-bank-tabs"
                  className="flex items-center gap-1 border-b border-border-color -mt-1 mb-2"
                >
                  <button
                    data-testid="korg-bank-tab-samples"
                    onClick={() => setActiveTab("samples")}
                    className={`px-3 py-1 text-xs ${
                      activeTab === "samples"
                        ? "text-accent-primary border-b-2 border-accent-primary -mb-px"
                        : "text-text-muted hover:text-text-primary"
                    }`}
                  >
                    Samples ({state.rows.length})
                  </button>
                  {state.patterns.length > 0 && (
                    <button
                      data-testid="korg-bank-tab-patterns"
                      onClick={() => setActiveTab("patterns")}
                      className={`px-3 py-1 text-xs ${
                        activeTab === "patterns"
                          ? "text-accent-primary border-b-2 border-accent-primary -mb-px"
                          : "text-text-muted hover:text-text-primary"
                      }`}
                    >
                      Patterns ({state.patterns.length})
                    </button>
                  )}
                  {state.songs.length > 0 && (
                    <button
                      data-testid="korg-bank-tab-songs"
                      onClick={() => setActiveTab("songs")}
                      className={`px-3 py-1 text-xs ${
                        activeTab === "songs"
                          ? "text-accent-primary border-b-2 border-accent-primary -mb-px"
                          : "text-text-muted hover:text-text-primary"
                      }`}
                    >
                      Songs ({state.songs.length})
                    </button>
                  )}
                </div>
              )}

              {/* Toolbar */}
              {activeTab === "samples" && state.rows.length > 0 && (
                <div className="flex items-center justify-between gap-2 sticky top-0 bg-bg-panel pb-2 -mt-1">
                  <input
                    data-testid="korg-bank-search"
                    type="search"
                    placeholder="Filter nach Name / Kategorie..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="flex-1 px-2 py-1 rounded text-xs bg-bg-elevated border border-border-color text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-primary"
                  />
                  <button
                    data-testid="korg-bank-import-all"
                    onClick={handleImportAll}
                    disabled={!onAddSample || filteredRows.length === 0}
                    className="px-3 py-1 rounded text-xs bg-accent-primary text-bg-base hover:opacity-90 transition-opacity disabled:opacity-40"
                  >
                    Alle importieren ({filteredRows.length})
                  </button>
                </div>
              )}

              {activeTab === "patterns" && state.patterns.length > 0 && (
                <div className="flex items-center justify-between gap-2 sticky top-0 bg-bg-panel pb-2 -mt-1">
                  <p className="text-xs text-text-muted">
                    {state.patterns.length} Patterns geparst · Step-Daten Best-Effort
                  </p>
                  <button
                    data-testid="korg-bank-import-all-patterns"
                    onClick={handleImportAllPatterns}
                    disabled={!onAddPattern}
                    className="px-3 py-1 rounded text-xs bg-accent-primary text-bg-base hover:opacity-90 transition-opacity disabled:opacity-40"
                  >
                    Alle Patterns importieren ({state.patterns.length})
                  </button>
                </div>
              )}

              {state.warnings.length > 0 && (
                <details className="text-xs text-text-muted">
                  <summary className="cursor-pointer hover:text-text-primary">
                    {state.warnings.length} Warnung(en) beim Parsen
                  </summary>
                  <ul className="mt-1 pl-4 space-y-0.5">
                    {state.warnings.slice(0, 20).map((w, i) => (
                      <li key={i} className="text-text-dim">
                        • {w}
                      </li>
                    ))}
                    {state.warnings.length > 20 && (
                      <li className="text-text-dim">
                        ... und {state.warnings.length - 20} weitere
                      </li>
                    )}
                  </ul>
                </details>
              )}

              {/* Sample-Tabelle */}
              {activeTab === "samples" && (
              <div data-testid="korg-bank-list" className="space-y-1">
                {filteredRows.map((row) => (
                  <div
                    key={row.rowId}
                    data-testid={`korg-bank-row-${row.rowId}`}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${
                      previewSlot === row.rowId
                        ? "bg-accent-primary/15 border border-accent-primary/40"
                        : "bg-bg-elevated border border-transparent hover:border-border-color"
                    } transition-colors`}
                  >
                    <span className="font-mono text-text-dim w-12 flex-shrink-0">
                      #{row.index}
                    </span>
                    <span
                      className="flex-1 truncate text-text-primary"
                      title={row.name}
                    >
                      {row.name}
                    </span>
                    <span className="text-text-muted w-32 flex-shrink-0 truncate">
                      {row.category}
                    </span>
                    <span className="text-text-muted w-16 flex-shrink-0 text-right">
                      {row.durationSec.toFixed(2)}s
                    </span>
                    <span className="text-text-muted w-8 flex-shrink-0 text-right">
                      {row.channels === 2 ? "ST" : "M"}
                    </span>
                    <button
                      data-testid={`korg-bank-preview-${row.rowId}`}
                      onClick={() => handlePreview(row)}
                      className="px-2 py-0.5 rounded text-[10px] bg-bg-base text-text-muted hover:text-accent-primary transition-colors"
                      title="Vorhoeren"
                    >
                      ▶
                    </button>
                    <button
                      data-testid={`korg-bank-add-${row.rowId}`}
                      onClick={() => handleAddOne(row)}
                      disabled={!onAddSample}
                      className="px-2 py-0.5 rounded text-[10px] bg-bg-base text-text-muted hover:text-accent-success transition-colors disabled:opacity-40"
                      title="Zur Sample-Library hinzufuegen"
                    >
                      +
                    </button>
                  </div>
                ))}
                {filteredRows.length === 0 && (
                  <p className="text-xs text-text-muted text-center py-4">
                    Keine Treffer fuer „{searchQuery}"
                  </p>
                )}
              </div>
              )}

              {/* Pattern-Tabelle (v3.5) */}
              {activeTab === "patterns" && state.patterns.length > 0 && (
                <div data-testid="korg-bank-pattern-list" className="space-y-1">
                  {state.patterns.map((pat) => (
                    <div
                      key={`pattern-${pat.index}`}
                      data-testid={`korg-bank-pattern-${pat.index}`}
                      className="flex items-center gap-2 px-2 py-1.5 rounded text-xs bg-bg-elevated border border-transparent hover:border-border-color transition-colors"
                    >
                      <span className="font-mono text-text-dim w-12 flex-shrink-0">
                        P{pat.index + 1}
                      </span>
                      <span
                        className="flex-1 truncate text-text-primary"
                        title={pat.name || `(unnamed pattern ${pat.index + 1})`}
                      >
                        {pat.name || `(unbenanntes Pattern ${pat.index + 1})`}
                      </span>
                      <span className="text-text-muted w-20 flex-shrink-0 text-right">
                        {pat.bpm.toFixed(1)} BPM
                      </span>
                      <span className="text-text-muted w-16 flex-shrink-0 text-right">
                        {pat.lengthSteps} Steps
                      </span>
                      <button
                        data-testid={`korg-bank-pattern-add-${pat.index}`}
                        onClick={() => handleImportPattern(pat)}
                        disabled={!onAddPattern}
                        className="px-2 py-0.5 rounded text-[10px] bg-bg-base text-text-muted hover:text-accent-success transition-colors disabled:opacity-40"
                        title="Pattern importieren"
                      >
                        + Pattern
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Song-Tabelle (v3.89.0) */}
              {activeTab === "songs" && state.songs.length > 0 && (
                <div data-testid="korg-bank-song-list" className="space-y-1">
                  <p className="text-xs text-text-muted mb-1">
                    {state.songs.length} non-empty Songs · Event-Mapping Best-Effort (Format reverse-engineered)
                  </p>
                  {state.songs.map((song) => (
                    <div
                      key={`song-${song.index}`}
                      data-testid={`korg-bank-song-${song.index}`}
                      className="flex items-center gap-2 px-2 py-1.5 rounded text-xs bg-bg-elevated border border-transparent hover:border-border-color transition-colors"
                    >
                      <span className="font-mono text-text-dim w-12 flex-shrink-0">
                        S{song.index + 1}
                      </span>
                      <span
                        className="flex-1 truncate text-text-primary"
                        title={song.name || `(unnamed song ${song.index + 1})`}
                      >
                        {song.name || `(unbenannter Song ${song.index + 1})`}
                      </span>
                      <span className="text-text-muted w-20 flex-shrink-0 text-right">
                        {song.bpm} BPM
                      </span>
                      <span className="text-text-muted w-20 flex-shrink-0 text-right">
                        {song.eventCount} Events
                      </span>
                      <button
                        data-testid={`korg-bank-song-add-${song.index}`}
                        onClick={() => handleImportSong(song)}
                        disabled={!onAddSong}
                        className="px-2 py-0.5 rounded text-[10px] bg-bg-base text-text-muted hover:text-accent-success transition-colors disabled:opacity-40"
                        title="Song importieren (→ useSongStore.createArrangement)"
                      >
                        + Song
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {!state.loading && !state.error && state.rows.length === 0 && state.patterns.length === 0 && state.songs.length === 0 && state.bankType !== "unknown" && (
            <p className="text-sm text-text-muted">
              Bank enthaelt keine Samples, Patterns oder Songs.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default KorgBankModal;
