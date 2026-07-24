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
  toggleImportedStep,
  clearImportedPart,
} from "@/utils/imports/editImportedPattern";
import { type StepReductionStrategy } from "@/utils/patternStepReduce";

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
  // v3.285: editierbare Vorschau. Wir bauen das ImportResult (mit echten Steps,
  // OHNE Sample-URLs — die sind teuer und nur fürs hörbare Laden nötig) sofort
  // beim Parsen und halten es als editierbaren State. Der User kann Steps VOR
  // dem Laden togglen; die Sample-URLs werden erst in handleLoad nachgereicht.
  const [editable, setEditable] = useState<ImportResult | null>(null);
  const [selectedPatternIdx, setSelectedPatternIdx] = useState(0);
  // v3.286: Step-Cap für Anzeige + Laden. 128 = volle Länge (nichts kürzen);
  // 64/32/16 = auf die ersten N Steps abschneiden.
  const [stepCap, setStepCap] = useState<16 | 32 | 64 | 128>(128);
  // v3.287: beim „In Sequenzer laden" auch die Bank-Samples den Parts zuweisen
  // (hörbar). Default an — der User kann es im Dialog abwählen.
  const [loadSamples, setLoadSamples] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!file) {
      setPreview(null);
      setBank(null);
      setEditable(null);
      setSelectedPatternIdx(0);
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
        // Editierbares ImportResult (Steps, keine URLs) aufbauen.
        const { esxBankToImportResult } =
          await import("@/utils/imports/electribeImport");
        if (cancelled) return;
        const result = esxBankToImportResult(parsed, file.name);
        setEditable(result);
        // Auf das inhaltsreichste Pattern vorselektieren.
        let bestIdx = 0;
        let bestActive = -1;
        result.patterns.forEach((p, i) => {
          const a = p.parts.reduce(
            (acc, pt) => acc + pt.steps.filter(s => s.active).length,
            0
          );
          if (a > bestActive) {
            bestActive = a;
            bestIdx = i;
          }
        });
        setSelectedPatternIdx(bestIdx);
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

  const handleToggleStep = (
    patternIdx: number,
    partIdx: number,
    stepIdx: number
  ) => {
    setEditable(prev =>
      prev ? toggleImportedStep(prev, patternIdx, partIdx, stepIdx) : prev
    );
  };

  const handleClearPart = (patternIdx: number, partIdx: number) => {
    setEditable(prev =>
      prev ? clearImportedPart(prev, patternIdx, partIdx) : prev
    );
  };

  // Fallback: falls das editierbare Result (aus welchem Grund auch immer) noch
  // nicht steht, frisch aus der Bank ableiten (ohne Edits).
  const deriveResultFromBank = async (): Promise<ImportResult> => {
    const { esxBankToImportResult } =
      await import("@/utils/imports/electribeImport");
    return esxBankToImportResult(bank, file.name);
  };

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
      // v3.285: die (evtl. editierte) Vorschau laden, nicht neu aus der Bank
      // ableiten — so landen die User-Edits im Sequenzer.
      const result = editable ?? (await deriveResultFromBank());

      // v3.287: Sample-Audio nur wenn der User es will (Dialog-Checkbox).
      // PCM jedes Bank-Slots → WAV → Blob-URL, per sampleId an die Parts hängen.
      let linked = result;
      let linkedCount = 0;
      if (loadSamples) {
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
        const attached = attachSampleUrlsToImportResult(result, urlBySampleId);
        linked = attached.result;
        linkedCount = attached.linkedCount;

        // v3.290: die mitgeladenen Samples zusätzlich in den Sample-Browser
        // (Project-Store) legen, damit man sie bei Bedarf auf andere Parts
        // tauschen kann. Der Project-Store lebt in App.tsx (per-Instance-useState),
        // deshalb via CustomEvent-Bridge (analog esx:load-song).
        try {
          const { buildEsxLibrarySamples } =
            await import("@/utils/korg/esxLibrarySamples");
          const librarySamples = buildEsxLibrarySamples(
            bank,
            urlBySampleId,
            wavMap
          );
          if (librarySamples.length > 0) {
            window.dispatchEvent(
              new CustomEvent("esx:add-library-samples", {
                detail: { samples: librarySamples },
              })
            );
          }
        } catch (err) {
          console.warn("[ESX] Library-Samples-Bridge fehlgeschlagen", err);
        }
      }

      // v3.286: auf den gewählten Step-Cap kürzen (128 = volle Länge → No-op).
      const { result: reduced, reducedCount } = reduceImportResultSteps(
        linked,
        stepCap,
        strategy
      );
      onLoadResult(reduced);
      onToast?.(
        `${reduced.patterns.length} Pattern(s) in den Sequenzer geladen` +
          (linkedCount > 0 ? `, ${linkedCount} Spur(en) mit Sample` : "") +
          (reducedCount > 0
            ? ` (${reducedCount} auf ${stepCap} Steps gekürzt)`
            : ""),
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

  const handleOpenBankEditor = () => {
    // Bank/Sample-Editor (KorgBankModal) für dieselbe Datei öffnen — via
    // korg:bank:open, das App.tsx abfängt. Danach den Import-Dialog schließen.
    try {
      window.dispatchEvent(
        new CustomEvent<File>("korg:bank:open", { detail: file })
      );
    } catch {
      /* test-env without CustomEvent */
    }
    onClose();
  };

  return (
    <EsxImportDialog
      preview={preview}
      editable={editable}
      selectedPatternIdx={selectedPatternIdx}
      onSelectPattern={setSelectedPatternIdx}
      onToggleStep={handleToggleStep}
      onClearPart={handleClearPart}
      stepCap={stepCap}
      onSetStepCap={setStepCap}
      loadSamples={loadSamples}
      onSetLoadSamples={setLoadSamples}
      busy={busy}
      onConvert={handleConvert}
      onLoadToSequencer={handleLoad}
      onExportSamples={handleExportSamples}
      onOpenBankEditor={handleOpenBankEditor}
      onLoadSong={onLoadSong ? handleLoadSong : undefined}
      onCancel={onClose}
    />
  );
}
