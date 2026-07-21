/**
 * E2sHacktribeRemap.tsx — Tools-Panel: bestehende E2S-Pattern-Bank
 * (.e2sallpat / e2sSample.all mit Patterns) hacktribe-kompatibel machen.
 *
 * hacktribe verbietet die Factory-Sample-Slots (1–500). Dieser Helfer sammelt
 * die in den Patterns genutzten Factory-Oscs, baut die Standard-Umbelegung in den
 * User-Bereich (ab 501/„--ofs 18") und schreibt alle 250×16 Part-Osc-Refs um —
 * bit-exakt nach bangcorrupts e2_recode_sample_pat.py (Pattern-Seite).
 *
 * ⚠️ Nur die Pattern-Seite: die zugehörigen Sample-Blöcke im .all müssen separat
 * verschoben werden (ESX→E2S-Converter / .all-Builder). Hier geht es darum, eine
 * bereits nach 501+ verschobene Sample-Bank mit den passenden Patterns zu paaren.
 */
import { useCallback, useRef, useState } from "react";
import { toast } from "@/store/useToastStore";
import {
  collectAllpatOscRefs,
  buildFactoryShiftMap,
  remapOscRefsInAllpat,
  FACTORY_SAMPLE_MIN,
  FACTORY_SAMPLE_MAX,
} from "@/utils/korg/e2PatternRemap";

function downloadBlob(data: Uint8Array, filename: string, mime: string): void {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const blob = new Blob([copy], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface RemapResult {
  out: Uint8Array;
  base: string;
  factoryUsed: number[];
  remapped: number;
  overflow: number[];
  offset: number;
}

export function E2sHacktribeRemap() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [offset, setOffset] = useState(18);
  const [res, setRes] = useState<RemapResult | null>(null);

  const process = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const used = collectAllpatOscRefs(buf);
        const factoryUsed = used.filter(
          o => o >= FACTORY_SAMPLE_MIN && o <= FACTORY_SAMPLE_MAX
        );
        if (factoryUsed.length === 0) {
          toast(
            "Keine Factory-Sample-Oscs (18–500) in den Patterns — bereits hacktribe-kompatibel.",
            { kind: "info", duration: 4000 }
          );
          setRes(null);
          return;
        }
        const { mapping, overflow } = buildFactoryShiftMap(used, offset);
        const out = remapOscRefsInAllpat(buf, mapping);
        const base =
          file.name
            .replace(/\.(e2sallpat|all)$/i, "")
            .replace(/[^A-Za-z0-9._-]+/g, "_")
            .slice(0, 50) || "patterns";
        setRes({
          out,
          base,
          factoryUsed,
          remapped: mapping.size,
          overflow,
          offset,
        });
        toast(
          `Umgeschrieben: ${mapping.size} Osc-Referenzen` +
            (overflow.length ? ` (${overflow.length} ohne freien Slot)` : ""),
          { kind: "success", duration: 3500 }
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast(`Remap fehlgeschlagen: ${msg}`, {
          kind: "error",
          duration: 5000,
        });
      } finally {
        setBusy(false);
      }
    },
    [offset]
  );

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (f) void process(f);
    },
    [process]
  );

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="max-w-2xl space-y-4">
        <div>
          <h2 className="text-sm font-bold text-text-primary flex items-center gap-2">
            🩹 Hacktribe Pattern-Remap (≥501)
          </h2>
          <p className="text-xs text-text-muted mt-1">
            Lade eine E2S-Pattern-Bank (<code>.e2sallpat</code> /{" "}
            <code>.all</code>). Alle Parts, die auf Factory-Samples (18–500)
            zeigen, werden in den User-Bereich ab 501 umgeschrieben — damit die
            Patterns unter hacktribe die richtigen Samples triggern.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-text-muted">User-Offset</label>
          <input
            data-testid="e2s-remap-offset"
            type="number"
            min={0}
            max={499}
            value={offset}
            onChange={e =>
              setOffset(Math.max(0, Math.min(499, Number(e.target.value) || 0)))
            }
            className="w-16 text-xs px-1.5 py-1 rounded bg-bg-base border border-border-color text-text-primary"
          />
          <span className="text-[10px] text-text-dim">
            Startslot = 500 + Offset (Default 18 → Slot 519 human, wie{" "}
            <code>--ofs 18</code>)
          </span>
        </div>

        {/* Drop / Pick */}
        <div
          onClick={() => !busy && inputRef.current?.click()}
          onDragOver={e => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void process(f);
          }}
          className={`border-2 border-dashed rounded-lg px-6 py-10 text-center cursor-pointer transition-colors ${
            drag
              ? "border-accent-primary bg-bg-elevated"
              : "border-border-color hover:border-accent-primary/60"
          }`}
          data-testid="e2s-remap-dropzone"
        >
          <div className="text-text-primary text-sm">
            {busy ? "Verarbeite…" : "Pattern-Bank hierher ziehen oder klicken"}
          </div>
          <div className="text-text-dim text-xs mt-1">.e2sallpat / .all</div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".e2sallpat,.all"
          className="hidden"
          onChange={onPick}
          data-testid="e2s-remap-input"
        />

        {res && (
          <div
            className="bg-bg-panel border border-border-color rounded-lg p-4 space-y-3"
            data-testid="e2s-remap-result"
          >
            <div className="text-xs text-text-muted grid grid-cols-2 gap-x-4 gap-y-1">
              <span>Factory-Oscs genutzt:</span>
              <span className="text-text-primary">
                {res.factoryUsed.length}
              </span>
              <span>Refs umgeschrieben:</span>
              <span className="text-text-primary">{res.remapped}</span>
              <span>Ohne freien Slot:</span>
              <span
                className={
                  res.overflow.length
                    ? "text-accent-danger"
                    : "text-text-primary"
                }
              >
                {res.overflow.length}
              </span>
            </div>
            {res.overflow.length > 0 && (
              <p className="text-[10px] text-accent-danger">
                Überlauf: Oscs {res.overflow.join(", ")} — der User-Bereich (bis
                999) ist voll. Diese Refs bleiben unverändert; Offset
                verkleinern oder Samples reduzieren.
              </p>
            )}
            <button
              onClick={() =>
                downloadBlob(
                  res.out,
                  `${res.base}-hacktribe.e2sallpat`,
                  "application/octet-stream"
                )
              }
              className="px-3 py-1.5 rounded text-xs bg-accent-primary text-bg-base font-medium hover:opacity-90 transition-opacity"
              data-testid="e2s-remap-download"
            >
              ⬇ {res.base}-hacktribe.e2sallpat
            </button>
            <p className="text-[10px] text-text-dim">
              Auf die SD-Karte legen und am Gerät importieren. Die zugehörige
              Sample-Bank muss die Samples bereits ab 501 enthalten (z.&nbsp;B.
              via ESX→E2S-Converter oder dem .all-Builder).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
