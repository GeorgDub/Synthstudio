/**
 * Synthstudio – VersionHistoryModal.tsx (v3.57.0)
 *
 * Modal zur Anzeige + Wiederherstellung der AutoSave-Versionen für das
 * aktuelle Projekt. Liest die Liste aus dem isomorphen Engine, zeigt sie
 * sortiert (newest first) mit Timestamp + Size + optionalem Label und
 * bietet Restore- + Delete-Buttons pro Eintrag.
 *
 * Nutzt ausschließlich semantische Tailwind-Klassen.
 */
import { useCallback, useEffect, useState } from "react";
import { X, RotateCcw, Trash2, RefreshCw } from "lucide-react";
import {
  listAutoSaveVersions,
  restoreAutoSaveVersion,
  deleteAutoSaveVersion,
  type AutoSaveVersionMeta,
} from "@/utils/autoSaveEngine";
import {
  formatBytes,
  formatVersionTimestamp,
} from "@/utils/autoSaveController";
import { formatLastSave } from "@/store/useAutoSaveStore";
import { toast } from "@/store/useToastStore";

export interface VersionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** ID des aktuell geladenen Projekts (für listAutoSaveVersions). */
  projectId: string;
  /** Callback wenn der User eine Version restored hat — JSON-String der Quelle. */
  onRestore: (json: string) => void;
}

export function VersionHistoryModal({
  isOpen,
  onClose,
  projectId,
  onRestore,
}: VersionHistoryModalProps) {
  const [versions, setVersions] = useState<AutoSaveVersionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState<number>(() => Date.now());

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listAutoSaveVersions(projectId);
      setVersions(list);
    } catch {
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Initial-Load + Tick alle 30s damit "vor X min" sich aktualisiert.
  useEffect(() => {
    if (!isOpen) return;
    void reload();
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [isOpen, reload]);

  // ESC schließt
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  const handleRestore = useCallback(
    async (versionId: string) => {
      const ok =
        typeof window !== "undefined"
          ? window.confirm(
              "Aktuelles Projekt überschreiben? Ungespeicherte Änderungen gehen verloren.",
            )
          : true;
      if (!ok) return;
      try {
        const res = await restoreAutoSaveVersion(projectId, versionId);
        if (res.success && res.json) {
          onRestore(res.json);
          toast("Version wiederhergestellt", { kind: "success" });
          onClose();
        } else {
          toast(`Restore fehlgeschlagen: ${res.error ?? "unbekannt"}`, {
            kind: "error",
            duration: 5000,
          });
        }
      } catch (err) {
        toast(`Restore-Fehler: ${String(err)}`, { kind: "error", duration: 5000 });
      }
    },
    [projectId, onRestore, onClose],
  );

  const handleDelete = useCallback(
    async (versionId: string) => {
      const ok =
        typeof window !== "undefined"
          ? window.confirm("Diese Version unwiderruflich löschen?")
          : true;
      if (!ok) return;
      try {
        const res = await deleteAutoSaveVersion(projectId, versionId);
        if (res.success) {
          toast("Version gelöscht", { kind: "info" });
          await reload();
        } else {
          toast(`Löschen fehlgeschlagen: ${res.error ?? "unbekannt"}`, {
            kind: "error",
          });
        }
      } catch (err) {
        toast(`Lösch-Fehler: ${String(err)}`, { kind: "error" });
      }
    },
    [projectId, reload],
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg-base/80"
      role="dialog"
      aria-modal="true"
      aria-label="Versions-History"
      data-testid="autosave-version-history-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-bg-panel border border-border-color rounded-lg shadow-xl w-[640px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-color">
          <div>
            <h2 className="text-sm font-bold text-text-primary">
              AutoSave Versions-History
            </h2>
            <p className="text-[10px] text-text-dim mt-0.5">
              Projekt: <span className="text-text-muted">{projectId}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void reload()}
              title="Liste aktualisieren"
              className="w-7 h-7 rounded flex items-center justify-center text-text-dim hover:text-text-primary hover:bg-bg-elevated transition-colors"
              data-testid="autosave-reload-btn"
            >
              <RefreshCw size={14} />
            </button>
            <button
              onClick={onClose}
              title="Schließen (ESC)"
              className="w-7 h-7 rounded flex items-center justify-center text-text-dim hover:text-text-primary hover:bg-bg-elevated transition-colors"
              data-testid="autosave-close-btn"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4">
          {loading && (
            <div className="text-xs text-text-dim text-center py-8">Lade …</div>
          )}
          {!loading && versions.length === 0 && (
            <div className="text-xs text-text-dim text-center py-12">
              Noch keine AutoSave-Versionen für dieses Projekt.
              <br />
              <span className="text-[10px]">
                Der nächste AutoSave-Tick erstellt automatisch eine.
              </span>
            </div>
          )}
          {!loading && versions.length > 0 && (
            <ul
              className="space-y-2"
              data-testid="autosave-version-list"
            >
              {versions.map((v) => (
                <li
                  key={v.versionId}
                  className="flex items-center gap-3 px-3 py-2 bg-bg-elevated rounded border border-border-subtle hover:border-border-color transition-colors"
                  data-testid={`autosave-version-row-${v.versionId}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-semibold text-text-primary">
                        {formatVersionTimestamp(v.timestamp)}
                      </span>
                      <span className="text-[10px] text-text-dim">
                        {formatLastSave(v.timestamp, now)}
                      </span>
                    </div>
                    <div className="text-[10px] text-text-dim mt-0.5">
                      {formatBytes(v.size)}
                      {v.label && (
                        <span className="ml-2 text-accent-secondary">
                          • {v.label}
                        </span>
                      )}
                      {v.projectName && (
                        <span className="ml-2 text-text-muted">
                          • {v.projectName}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => void handleRestore(v.versionId)}
                    title="Wiederherstellen"
                    className="px-2 py-1 rounded text-[10px] bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/25 border border-accent-primary/30 transition-colors flex items-center gap-1"
                    data-testid={`autosave-restore-${v.versionId}`}
                  >
                    <RotateCcw size={11} />
                    Wiederherstellen
                  </button>
                  <button
                    onClick={() => void handleDelete(v.versionId)}
                    title="Löschen"
                    className="w-7 h-7 rounded flex items-center justify-center text-text-dim hover:text-accent-danger hover:bg-accent-danger/10 transition-colors"
                    data-testid={`autosave-delete-${v.versionId}`}
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border-color text-[10px] text-text-dim">
          {versions.length > 0 && (
            <span>
              {versions.length} Version{versions.length === 1 ? "" : "en"} •
              Älteste wird bei Erreichen des Limits automatisch entfernt
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
