/**
 * E2sPresetPanel — IFX-Preset- & Groove-Template-Manager (hacktribe-only).
 *
 * Blob-Ebene: Read/Backup/Copy/Restore. Es werden NUR Bytes zurückgeschrieben,
 * die vom Gerät gelesen wurden (kein Feld-Editing → kein Layout-Risiko).
 * Nutzt useE2sPresetStore (RAM-SysEx via die verbundene Bridge).
 */
import { useState } from "react";
import {
  Download,
  Copy,
  RotateCcw,
  Trash2,
  RefreshCw,
  AlertTriangle,
  Sliders,
} from "lucide-react";
import { useE2sDeviceStore } from "@/store/useE2sDeviceStore";
import { useE2sPresetStore, type PresetKind } from "@/store/useE2sPresetStore";
import { E2sPresetEditor } from "./E2sPresetEditor";

const MAX_INDEX: Record<PresetKind, number> = { ifx: 99, groove: 127 };

function KindRow({ kind, label }: { kind: PresetKind; label: string }) {
  const preset = useE2sPresetStore();
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(1);
  const clamp = (n: number) =>
    Math.max(0, Math.min(MAX_INDEX[kind], Number.isFinite(n) ? n : 0));

  return (
    <div
      className="p-2 rounded bg-bg-base border border-border-color space-y-1.5"
      data-testid={`e2s-preset-${kind}`}
    >
      <div className="text-xs font-medium text-text-primary">{label}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="text-[10px] text-text-dim">Slot</label>
        <input
          data-testid={`e2s-${kind}-from`}
          type="number"
          min={0}
          max={MAX_INDEX[kind]}
          value={from}
          onChange={e => setFrom(clamp(Number(e.target.value)))}
          className="w-14 text-xs px-1.5 py-1 rounded bg-bg-elevated border border-border-color text-text-primary"
        />
        <button
          data-testid={`e2s-${kind}-capture`}
          disabled={preset.busy}
          onClick={() => preset.capture(kind, from)}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-bg-elevated text-text-primary disabled:opacity-50 hover:bg-bg-panel transition-colors"
          title="Slot lesen und als Backup ablegen"
        >
          <Download size={12} /> Backup
        </button>
        <span className="text-text-dim text-[10px]">→</span>
        <input
          data-testid={`e2s-${kind}-to`}
          type="number"
          min={0}
          max={MAX_INDEX[kind]}
          value={to}
          onChange={e => setTo(clamp(Number(e.target.value)))}
          className="w-14 text-xs px-1.5 py-1 rounded bg-bg-elevated border border-border-color text-text-primary"
        />
        <button
          data-testid={`e2s-${kind}-copy`}
          disabled={preset.busy || from === to}
          onClick={() => preset.copy(kind, from, to)}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-bg-elevated text-text-primary disabled:opacity-50 hover:bg-bg-panel transition-colors"
          title="Slot from → to kopieren (device-sourced bytes)"
        >
          <Copy size={12} /> Kopieren
        </button>
      </div>
    </div>
  );
}

export function E2sPresetPanel() {
  const device = useE2sDeviceStore();
  const preset = useE2sPresetStore();
  const [restoreTargets, setRestoreTargets] = useState<Record<number, number>>(
    {}
  );
  const [editingId, setEditingId] = useState<number | null>(null);

  if (device.status !== "connected") return null;

  return (
    <div
      className="p-3 bg-bg-elevated rounded-lg border border-accent-secondary/40 space-y-2"
      data-testid="e2s-preset-section"
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-text-primary">
          IFX / Groove Presets{" "}
          <span className="text-[10px] text-text-dim">(hacktribe · RAM)</span>
        </div>
        <button
          data-testid="e2s-preset-refresh"
          disabled={preset.busy}
          onClick={() => preset.refreshCounts()}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-bg-base text-text-muted disabled:opacity-50 hover:text-text-primary transition-colors"
        >
          {preset.busy ? (
            <RefreshCw size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          {preset.ifxCount !== null || preset.grooveCount !== null
            ? `IFX ${preset.ifxCount ?? "?"} · Groove ${preset.grooveCount ?? "?"}`
            : "Zähler lesen"}
        </button>
      </div>

      <div className="flex items-start gap-1.5 p-2 rounded bg-accent-secondary/10 text-[10px] text-text-muted">
        <AlertTriangle
          size={12}
          className="mt-0.5 shrink-0 text-accent-secondary"
        />
        <span>
          Nur mit hacktribe-Firmware. Schreibt in DDR-RAM (Power-Cycle stellt
          wieder her). Blob-Ebene: es werden nur zuvor gelesene Bytes
          zurückgeschrieben — kein Feld-Editing. Nur bei gestopptem Sequencer.
        </span>
      </div>

      <KindRow kind="ifx" label="IFX-Presets (0–99, je 0x20C B)" />
      <KindRow kind="groove" label="Groove-Templates (0–127, je 0x140 B)" />

      {preset.error && (
        <div
          className="flex items-start gap-1.5 p-2 rounded bg-accent-danger/15 border border-accent-danger/40 text-xs text-accent-danger"
          data-testid="e2s-preset-error"
        >
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>{preset.error}</span>
        </div>
      )}

      {preset.backups.length > 0 && (
        <div className="space-y-1" data-testid="e2s-preset-backups">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-muted">
              Backups ({preset.backups.length})
            </span>
            <button
              onClick={() => preset.clearBackups()}
              className="text-[10px] text-text-dim hover:text-accent-danger transition-colors"
            >
              alle löschen
            </button>
          </div>
          {preset.backups.map(b => {
            const max = b.kind === "ifx" ? 99 : 127;
            const target = restoreTargets[b.id] ?? b.index;
            const editing = editingId === b.id;
            return (
              <div key={b.id} className="space-y-1">
                <div className="flex items-center gap-1.5 p-1.5 rounded bg-bg-base border border-border-color">
                  <span className="text-[10px] text-text-muted flex-1">
                    {b.kind.toUpperCase()} Slot {b.index} · {b.bytes.length} B
                  </span>
                  <button
                    data-testid={`e2s-backup-edit-${b.id}`}
                    onClick={() => setEditingId(editing ? null : b.id)}
                    className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                      editing
                        ? "bg-accent-primary text-text-primary"
                        : "bg-bg-elevated text-text-primary hover:bg-bg-panel"
                    }`}
                    title="Felder editieren (bekannte Offsets)"
                  >
                    <Sliders size={11} /> Edit
                  </button>
                  <input
                    type="number"
                    min={0}
                    max={max}
                    value={target}
                    onChange={e =>
                      setRestoreTargets(m => ({
                        ...m,
                        [b.id]: Math.max(
                          0,
                          Math.min(max, Number(e.target.value) || 0)
                        ),
                      }))
                    }
                    className="w-14 text-xs px-1.5 py-0.5 rounded bg-bg-elevated border border-border-color text-text-primary"
                    aria-label="Ziel-Slot"
                  />
                  <button
                    disabled={preset.busy}
                    onClick={() => preset.restore(b.id, target)}
                    className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-bg-elevated text-text-primary disabled:opacity-50 hover:bg-bg-panel transition-colors"
                    title="Backup in Ziel-Slot schreiben"
                  >
                    <RotateCcw size={11} /> Restore
                  </button>
                  <button
                    onClick={() => {
                      if (editing) setEditingId(null);
                      preset.removeBackup(b.id);
                    }}
                    className="text-text-dim hover:text-accent-danger transition-colors"
                    aria-label="Backup entfernen"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                {editing && (
                  <E2sPresetEditor
                    backup={b}
                    onClose={() => setEditingId(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
