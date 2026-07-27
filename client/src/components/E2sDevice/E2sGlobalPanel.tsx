/**
 * E2sGlobalPanel — Global-Data lesen, anzeigen (Hex) und zurückschreiben
 * (Round-Trip) über natives Korg-SysEx (0x0E/0x51).
 *
 * Blob-Ebene: das interne Feld-Layout der Global-Data ist nicht reverse-engineert,
 * daher nur Anzeige + Round-Trip (nur zuvor gelesene Bytes zurückschreiben) +
 * optionaler Backup-Download. Nutzt useE2sDeviceStore.
 */
import { Download, Upload, Save, AlertTriangle } from "lucide-react";
import { useE2sDeviceStore } from "@/store/useE2sDeviceStore";

/** Erste `max` Bytes als Hex-Zeilen (16/Zeile). */
function hexPreview(bytes: Uint8Array, max = 48): string {
  const n = Math.min(bytes.length, max);
  const rows: string[] = [];
  for (let i = 0; i < n; i += 16) {
    const row: string[] = [];
    for (let j = i; j < Math.min(i + 16, n); j++) {
      row.push(bytes[j].toString(16).padStart(2, "0"));
    }
    rows.push(row.join(" "));
  }
  if (bytes.length > max) rows.push("…");
  return rows.join("\n");
}

function downloadBytes(bytes: Uint8Array, filename: string): void {
  if (
    typeof document === "undefined" ||
    typeof URL.createObjectURL !== "function"
  )
    return;
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const blob = new Blob([ab], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function E2sGlobalPanel() {
  const device = useE2sDeviceStore();
  if (device.status !== "connected") return null;

  const global = device.globalData;

  return (
    <div
      className="p-3 bg-bg-elevated rounded-lg border border-accent-secondary/40 space-y-2"
      data-testid="e2s-global-section"
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-text-primary">
          Global-Data{" "}
          <span className="text-[10px] text-text-dim">(Korg 0x0E/0x51)</span>
        </div>
        <button
          data-testid="e2s-global-pull-btn"
          disabled={device.busy}
          onClick={() => device.pullGlobal()}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-accent-primary text-text-primary disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          <Download size={13} /> Lesen
        </button>
      </div>

      {global ? (
        <>
          <div
            className="text-[10px] text-text-muted"
            data-testid="e2s-global-size"
          >
            {global.length} Bytes gelesen
          </div>
          <pre className="text-[10px] leading-tight text-text-muted bg-bg-base rounded p-2 overflow-x-auto font-mono">
            {hexPreview(global)}
          </pre>
          <div className="flex items-center gap-2">
            <button
              data-testid="e2s-global-push-btn"
              disabled={device.busy}
              onClick={() => device.pushGlobal(global)}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-bg-base text-text-primary disabled:opacity-50 hover:bg-bg-panel transition-colors"
              title="Gelesene Global-Data unverändert zurückschreiben (Round-Trip-Test)"
            >
              <Upload size={13} /> Zurückschreiben
            </button>
            <button
              data-testid="e2s-global-save-btn"
              onClick={() => downloadBytes(global, "e2-global.bin")}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-bg-base text-text-muted hover:text-text-primary transition-colors"
              title="Als .bin sichern"
            >
              <Save size={13} /> Backup
            </button>
          </div>
        </>
      ) : (
        <div className="text-[10px] text-text-dim">
          Noch nicht gelesen. „Lesen" holt die Geräte-Global-Settings.
        </div>
      )}

      <div className="flex items-start gap-1.5 text-[10px] text-text-dim">
        <AlertTriangle
          size={11}
          className="mt-0.5 shrink-0 text-accent-secondary"
        />
        <span>
          Feld-Layout nicht dekodiert → nur Anzeige + Round-Trip (unveränderte
          Bytes). Zurückschreiben nur bei gestopptem Sequencer.
        </span>
      </div>
    </div>
  );
}
