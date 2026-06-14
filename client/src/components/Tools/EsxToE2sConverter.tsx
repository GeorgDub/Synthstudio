/**
 * EsxToE2sConverter.tsx — Tools-Panel: KORG ESX-1 (.esx) → Electribe 2 Sampler.
 *
 * ESX-Datei laden → erzeugt direkt eine `.e2sallpat`-Pattern-Bank UND eine
 * `.all`-Sample-Bank (User-Samples ab 501, Parts repointet), die man auf die
 * E2S importieren kann. Reine Logik in `convertEsxToE2sBank`; hier nur File-
 * Laden + Download (isomorph via Blob).
 */

import { useCallback, useRef, useState } from "react";
import { parseEsxBank } from "@/utils/korg/esxParser";
import { convertEsxToE2sBank, type EsxToE2sResult } from "@/utils/korg/esxToE2sBank";
import { toast } from "@/store/useToastStore";
import { requireProFeature, PRO_FEATURE_E2_PATTERN_EXPORT } from "@/utils/proFeatures";

function downloadBlob(data: Uint8Array | string, filename: string, mime: string): void {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function EsxToE2sConverter() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [out, setOut] = useState<{ res: EsxToE2sResult; base: string } | null>(null);

  const convert = useCallback(async (file: File) => {
    if (!requireProFeature(PRO_FEATURE_E2_PATTERN_EXPORT)) return;
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const esx = parseEsxBank(new Uint8Array(buf), file.name);
      if (esx.patterns.length === 0 && esx.monoSamples.length === 0) {
        toast(`Keine Patterns/Samples in "${file.name}" gefunden`, { kind: "warning" });
        return;
      }
      const res = convertEsxToE2sBank(esx);
      const base =
        file.name.replace(/\.(esx|ess)$/i, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 50) || "esx";
      setOut({ res, base });
      toast(
        `Konvertiert: ${res.stats.patterns} Patterns, ${res.stats.samples} Samples` +
          (res.stats.droppedSamples ? ` (${res.stats.droppedSamples} wg. Speicher weggelassen)` : ""),
        { kind: "success", duration: 3500 },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Konvertierung fehlgeschlagen: ${msg}`, { kind: "error", duration: 5000 });
    } finally {
      setBusy(false);
    }
  }, []);

  const onPick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) void convert(f);
  }, [convert]);

  const stats = out?.res.stats;

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="max-w-2xl space-y-4">
        <div>
          <h2 className="text-sm font-bold text-text-primary flex items-center gap-2">
            🔁 ESX → E2 Sampler Converter
          </h2>
          <p className="text-xs text-text-muted mt-1">
            Lade ein KORG ESX-1-Backup (<code>.esx</code>) und erhalte direkt eine
            Pattern-Bank (<code>.e2sallpat</code>) plus Sample-Bank (<code>.all</code>)
            für die Electribe 2 Sampler — Samples ab Nr.&nbsp;501, Patterns bereits verknüpft.
          </p>
        </div>

        {/* Drop / Pick */}
        <div
          onClick={() => !busy && inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void convert(f);
          }}
          className={`border-2 border-dashed rounded-lg px-6 py-10 text-center cursor-pointer transition-colors ${
            drag ? "border-accent-primary bg-bg-elevated" : "border-border-color hover:border-accent-primary/60"
          }`}
          data-testid="esx2e2s-dropzone"
        >
          <div className="text-text-primary text-sm">
            {busy ? "Konvertiere…" : "ESX-Datei hierher ziehen oder klicken"}
          </div>
          <div className="text-text-dim text-xs mt-1">.esx / .ess</div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".esx,.ess"
          className="hidden"
          onChange={onPick}
          data-testid="esx2e2s-input"
        />

        {/* Result */}
        {out && stats && (
          <div className="bg-bg-panel border border-border-color rounded-lg p-4 space-y-3" data-testid="esx2e2s-result">
            <div className="text-xs text-text-muted grid grid-cols-2 gap-x-4 gap-y-1">
              <span>Patterns:</span><span className="text-text-primary">{stats.patterns}</span>
              <span>Samples:</span>
              <span className="text-text-primary">
                {stats.samples} · {stats.audioSeconds.toFixed(0)}s
                {stats.droppedSamples > 0 && (
                  <span className="text-accent-danger"> (+{stats.droppedSamples} weggelassen)</span>
                )}
              </span>
              <span>Parts mit Sample:</span>
              <span className="text-text-primary">{stats.linkedParts}/{stats.activeParts}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => downloadBlob(out.res.all, `${out.base}-samples.all`, "application/octet-stream")}
                className="px-3 py-1.5 rounded text-xs bg-accent-primary text-bg-base font-medium hover:opacity-90 transition-opacity"
                data-testid="esx2e2s-dl-all"
              >
                ⬇ {out.base}-samples.all
              </button>
              <button
                onClick={() => downloadBlob(out.res.allpat, `${out.base}.e2sallpat`, "application/octet-stream")}
                className="px-3 py-1.5 rounded text-xs bg-accent-primary text-bg-base font-medium hover:opacity-90 transition-opacity"
                data-testid="esx2e2s-dl-allpat"
              >
                ⬇ {out.base}.e2sallpat
              </button>
              <button
                onClick={() => downloadBlob(out.res.mapping, `${out.base}-mapping.md`, "text/markdown")}
                className="px-3 py-1.5 rounded text-xs bg-bg-elevated text-text-muted hover:text-text-primary transition-colors"
                data-testid="esx2e2s-dl-mapping"
              >
                ⬇ Anleitung (.md)
              </button>
            </div>
            <p className="text-[10px] text-text-dim">
              Beide Dateien auf die SD-Karte legen (Sample-/Pattern-Ordner) und am Gerät importieren.
              Die <code>.all</code>-Samples erscheinen ab Nr.&nbsp;501; die Patterns triggern sie direkt.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
