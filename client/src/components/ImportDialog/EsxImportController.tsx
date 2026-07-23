/**
 * EsxImportController.tsx — verbindet die ESX-Datei mit dem Import-Dialog.
 *
 * Nimmt eine `File`, parst sie (parseEsxBank), baut die Vorschau und rendert den
 * `EsxImportDialog`. Führt die beiden Aktionen aus:
 *   - Konvertieren → `.e2sallpat` + `.all` erzeugen und herunterladen.
 *   - In Sequenzer laden → ESX-Bank → ImportResult, auf 64 Steps reduzieren (mit
 *     der gewählten Strategie) und an `onLoadResult` durchreichen (der Parent
 *     verdrahtet das an den DrumMachine-Store).
 *
 * Isomorph: der Download nutzt Blob + Object-URL (funktioniert im Browser UND im
 * Electron-Renderer). Kein direkter window.electronAPI-Zugriff.
 */
import { useEffect, useState } from "react";
import { EsxImportDialog } from "./EsxImportDialog";
import {
  buildEsxImportPreview,
  type EsxImportPreview,
} from "@/utils/imports/esxImportPreview";
import { reduceImportResultSteps } from "@/utils/imports/reduceImportedPattern";
import type { ImportResult } from "@/utils/imports/types";
import {
  E2_MAX_STEPS,
  type StepReductionStrategy,
} from "@/utils/patternStepReduce";

export interface EsxImportControllerProps {
  /** Zu importierende Datei; null = Dialog geschlossen. */
  file: File | null;
  onClose: () => void;
  /**
   * Wird beim „In Sequenzer laden" mit dem (bereits reduzierten) ImportResult
   * aufgerufen. Der Parent macht daraus PatternData + addPatternsData.
   */
  onLoadResult: (result: ImportResult) => void;
  /**
   * Wird beim „Song laden" mit dem konvertierten Arrangement aufgerufen. Der
   * Parent verdrahtet das an useSongStore.createArrangement (via CustomEvent-
   * Bridge in App.tsx).
   */
  onLoadSong?: (arrangement: {
    name: string;
    bpm: number;
    slots: Array<{ bank: "A" | "B" | "C" | "D"; repeats: number }>;
  }) => void;
  /** Optionales Feedback (Toast) — Erfolg/Fehler. */
  onToast?: (message: string, kind: "success" | "error") => void;
}

function downloadBytes(bytes: Uint8Array, fileName: string): void {
  // Frische ArrayBuffer-Kopie → TS-sauber als BlobPart (vermeidet den
  // SharedArrayBuffer-Union der generischen Uint8Array).
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function EsxImportController({
  file,
  onClose,
  onLoadResult,
  onLoadSong,
  onToast,
}: EsxImportControllerProps) {
  const [preview, setPreview] = useState<EsxImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  // Der geparste Bank-Zustand lebt in einem Ref-artigen State, damit die
  // Aktionen ihn ohne Reparse nutzen.
  const [bank, setBank] = useState<
    import("@/utils/korg/esxParser").EsxBank | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    if (!file) {
      setPreview(null);
      setBank(null);
      return;
    }
    (async () => {
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const { parseEsxBank } = await import("@/utils/korg/esxParser");
        const parsed = parseEsxBank(buf, file.name);
        if (cancelled) return;
        setBank(parsed);
        setPreview(buildEsxImportPreview(parsed));
      } catch (err) {
        if (cancelled) return;
        onToast?.(
          `ESX konnte nicht gelesen werden: ${
            err instanceof Error ? err.message : String(err)
          }`,
          "error"
        );
        onClose();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, onClose, onToast]);

  if (!file || !preview || !bank) return null;

  const handleConvert = async (strategy: StepReductionStrategy) => {
    setBusy(true);
    try {
      const { convertEsxToE2sBank } = await import("@/utils/korg/esxToE2sBank");
      const res = convertEsxToE2sBank(bank);
      const stem = file.name.replace(/\.[^.]+$/, "");
      downloadBytes(res.allpat, `${stem}.e2sallpat`);
      downloadBytes(res.all, `${stem}.all`);
      onToast?.(
        `Konvertiert: ${res.stats.patterns} Pattern(s), ${res.stats.samples} Sample(s) → .e2sallpat + .all`,
        "success"
      );
      // strategy fließt in die spätere Pattern-Reduktion beim Convert ein
      // (aktuell nutzt convertEsxToE2sBank die 16-Step-Bodies direkt); der
      // Parameter ist durchgereicht für die kommende >64-Konvertierung.
      void strategy;
      onClose();
    } catch (err) {
      onToast?.(
        `Konvertieren fehlgeschlagen: ${
          err instanceof Error ? err.message : String(err)
        }`,
        "error"
      );
    } finally {
      setBusy(false);
    }
  };

  const handleLoad = async (strategy: StepReductionStrategy) => {
    setBusy(true);
    try {
      const { esxBankToImportResult } =
        await import("@/utils/imports/electribeImport");
      const result = esxBankToImportResult(bank, file.name);

      // Sample-Audio hörbar machen: PCM jedes Bank-Slots → WAV → Blob-URL,
      // dann per sampleId an die Parts hängen (rein via attachSampleUrls).
      // Encoding ist ein Browser-Seiteneffekt → hier im Controller.
      const { buildEsxSampleWavMap } =
        await import("@/utils/korg/esxSampleWav");
      const { attachSampleUrlsToImportResult } =
        await import("@/utils/imports/attachSampleUrls");
      const wavMap = buildEsxSampleWavMap(bank);
      const urlBySampleId = new Map<number, string>();
      for (const [sampleId, bytes] of wavMap) {
        // Frische Kopie → sauberer BlobPart (kein SharedArrayBuffer-Union).
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        urlBySampleId.set(
          sampleId,
          URL.createObjectURL(new Blob([copy.buffer], { type: "audio/wav" }))
        );
      }
      const { result: linked, linkedCount } = attachSampleUrlsToImportResult(
        result,
        urlBySampleId
      );

      const { result: reduced, reducedCount } = reduceImportResultSteps(
        linked,
        E2_MAX_STEPS,
        strategy
      );
      onLoadResult(reduced);
      onToast?.(
        `${reduced.patterns.length} Pattern(s) in den Sequenzer geladen` +
          (linkedCount > 0 ? `, ${linkedCount} Spur(en) mit Sample` : "") +
          (reducedCount > 0 ? ` (${reducedCount} auf 64 Steps reduziert)` : ""),
        "success"
      );
      onClose();
    } catch (err) {
      onToast?.(
        `Laden fehlgeschlagen: ${
          err instanceof Error ? err.message : String(err)
        }`,
        "error"
      );
    } finally {
      setBusy(false);
    }
  };

  const handleExportSamples = async () => {
    setBusy(true);
    try {
      const { bundleEsxSamplesToZip } =
        await import("@/utils/korg/esxSampleExport");
      const res = await bundleEsxSamplesToZip(bank);
      if (res.sampleCount === 0) {
        onToast?.("Keine Samples in dieser Bank zum Exportieren.", "error");
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
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      onToast?.(
        `${res.sampleCount} Sample(s) als WAV exportiert → ${res.fileName}`,
        "success"
      );
    } catch (err) {
      onToast?.(
        `Sample-Export fehlgeschlagen: ${
          err instanceof Error ? err.message : String(err)
        }`,
        "error"
      );
    } finally {
      setBusy(false);
    }
  };

  const handleLoadSong = async (songIndex: number) => {
    if (!onLoadSong) return;
    setBusy(true);
    try {
      const target = (bank.songs ?? []).find(s => s.index === songIndex);
      if (!target) {
        onToast?.("Song nicht gefunden.", "error");
        return;
      }
      const { convertEsxSongToSynthstudio } =
        await import("@/utils/korg/esxPatternConvert");
      const arrangement = convertEsxSongToSynthstudio(target);
      if (arrangement.slots.length === 0) {
        onToast?.(`Song „${arrangement.name}" hat keine Slots.`, "error");
        return;
      }
      onLoadSong(arrangement);
      onToast?.(
        `Song „${arrangement.name}" mit ${arrangement.slots.length} Slots geladen (Song-Modus)`,
        "success"
      );
      onClose();
    } catch (err) {
      onToast?.(
        `Song-Laden fehlgeschlagen: ${
          err instanceof Error ? err.message : String(err)
        }`,
        "error"
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <EsxImportDialog
      preview={preview}
      busy={busy}
      onConvert={handleConvert}
      onLoadToSequencer={handleLoad}
      onExportSamples={handleExportSamples}
      onLoadSong={onLoadSong ? handleLoadSong : undefined}
      onCancel={onClose}
    />
  );
}
