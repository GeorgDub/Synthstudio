/**
 * E2sBankExport.tsx — Tools-Panel: SynthStudio-Patterns in eine
 * geräteladbare `.e2sallpat`-Bank schreiben.
 *
 * „Ohne Haftung"-Design: der Container wird NICHT fabriziert. Du lädst eine echte
 * Basis-Bank vom Gerät (oder deine hacktribe-Init), wir überschreiben nur die
 * gewählten Pattern-Slots mit device-validen Bodies (aus `synthstudioPatternToBody`,
 * basiert auf einem echten Init-Template + nur verifizierte Felder). Header/Filler/
 * Footer + nicht angefasste Slots bleiben byte-exakt. Verifiziertes Slot-Layout
 * (0x10100 + i*0x4000), bit-exakt vs. bangcorrupts e2_merge_patterns.py.
 */
import { useCallback, useRef, useState } from "react";
import { toast } from "@/store/useToastStore";
import { useDrumMachineStore } from "@/store/useDrumMachineStore";
import { synthstudioPatternToBody } from "@/utils/korg/synthstudioToE2Pattern";
import {
  writePatternBodiesIntoAllpat,
  isFullAllpatContainer,
  allpatMinSizeFor,
  ALLPAT_PATTERN_COUNT,
  E2AllpatError,
} from "@/utils/korg/e2AllpatBuild";

function downloadBytes(bytes: Uint8Array, filename: string): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const url = URL.createObjectURL(
    new Blob([copy], { type: "application/octet-stream" })
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function E2sBankExport() {
  const dm = useDrumMachineStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [startSlot, setStartSlot] = useState(0);
  const [busy, setBusy] = useState(false);

  const patternCount = dm.patterns.length;
  const writable = Math.max(
    0,
    Math.min(patternCount, ALLPAT_PATTERN_COUNT - startSlot)
  );

  const onBase = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f) return;
      setBusy(true);
      try {
        const base = new Uint8Array(await f.arrayBuffer());
        if (!isFullAllpatContainer(base)) {
          toast(
            `Basis-Bank zu klein (${base.length} B). Erwartet eine volle .e2sallpat (≥ ${allpatMinSizeFor(
              ALLPAT_PATTERN_COUNT - 1
            )} B).`,
            { kind: "error", duration: 5000 }
          );
          return;
        }
        const writes = dm.patterns
          .slice(0, ALLPAT_PATTERN_COUNT - startSlot)
          .map((p, i) => ({
            index: startSlot + i,
            body: synthstudioPatternToBody(p),
          }));
        if (writes.length === 0) {
          toast("Keine Patterns zum Exportieren.", { kind: "warning" });
          return;
        }
        const out = writePatternBodiesIntoAllpat(base, writes);
        const stamp = f.name.replace(/\.(e2sallpat|all)$/i, "");
        downloadBytes(out, `${stamp}-synthstudio.e2sallpat`);
        toast(
          `${writes.length} Pattern(s) in Slots ${startSlot}–${
            startSlot + writes.length - 1
          } geschrieben.`,
          { kind: "success", duration: 4000 }
        );
      } catch (err) {
        const msg =
          err instanceof E2AllpatError || err instanceof Error
            ? err.message
            : String(err);
        toast(`Export fehlgeschlagen: ${msg}`, {
          kind: "error",
          duration: 5000,
        });
      } finally {
        setBusy(false);
      }
    },
    [dm.patterns, startSlot]
  );

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="max-w-2xl space-y-4">
        <div>
          <h2 className="text-sm font-bold text-text-primary flex items-center gap-2">
            📦 E2S Bank-Export (.e2sallpat)
          </h2>
          <p className="text-xs text-text-muted mt-1">
            Schreibt die {patternCount} Pattern(s) deines Projekts in eine{" "}
            <b>bestehende</b> Geräte-Bank. Lade eine echte{" "}
            <code>.e2sallpat</code> (Backup deiner E2S oder deine
            hacktribe-Init) — wir überschreiben nur die gewählten Slots, alles
            andere bleibt byte-exakt.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-text-muted">Start-Slot</label>
          <input
            data-testid="e2s-export-start"
            type="number"
            min={0}
            max={ALLPAT_PATTERN_COUNT - 1}
            value={startSlot}
            onChange={e =>
              setStartSlot(
                Math.max(
                  0,
                  Math.min(
                    ALLPAT_PATTERN_COUNT - 1,
                    Number(e.target.value) || 0
                  )
                )
              )
            }
            className="w-16 text-xs px-1.5 py-1 rounded bg-bg-base border border-border-color text-text-primary"
          />
          <span className="text-[10px] text-text-dim">
            {writable} von {patternCount} Pattern(s) passen ab Slot {startSlot}{" "}
            (max 250)
          </span>
        </div>

        <button
          data-testid="e2s-export-pick"
          disabled={busy || writable === 0}
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1 text-xs px-3 py-2 rounded bg-accent-primary text-bg-base font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          {busy ? "Schreibe…" : "Basis-Bank wählen & exportieren"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".e2sallpat,.all"
          className="hidden"
          onChange={onBase}
          data-testid="e2s-export-base-input"
        />

        <p className="text-[10px] text-text-dim">
          Die exportierte Datei auf die SD-Karte legen und am Gerät importieren.
          Sample-Referenzen ≥ 501 brauchen eine passende Sample-Bank — bei
          Bedarf vorher das „🩹 HT-Remap"-Tool nutzen.
        </p>
      </div>
    </div>
  );
}
