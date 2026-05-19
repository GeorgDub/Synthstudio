/**
 * Synthstudio – LegacyMigrationModal.tsx (v3.59.0)
 *
 * Modal das beim Project-Load erscheint, wenn unter dem alten Name-Slug
 * AutoSave-Versionen existieren, aber die neue stable projectId (UUID)
 * noch keinen Verlauf hat. Schließt das v3.58-Caveat.
 *
 * User-Path:
 *   1. App lädt Project → restoreProject ruft adoptProjectId
 *   2. App.tsx prüft checkLegacySlugMigration(legacyCount, uuidCount, name)
 *   3. Bei reason='migrate' → öffnet diese Modal
 *   4. User wählt:
 *      - "Migrieren":  migrateLegacyVersions(legacySlug, projectId)
 *                      → Versions wandern zur UUID
 *      - "Verwerfen":  deleteAllVersions(legacySlug)
 *                      → Legacy-Slot wird aufgeräumt
 *      - "Später":     dismissable, markiert die projectId als gecheckt
 *
 * Ausschließlich semantische Tailwind-Klassen.
 */
import { useCallback, useEffect, useState } from "react";
import { X, ArrowRightCircle, Trash2, Clock } from "lucide-react";
import {
  migrateLegacyVersions,
  deleteAllVersions,
} from "@/utils/autoSaveEngine";
import { toast } from "@/store/useToastStore";
import { useConfirm } from "@/components/common/ConfirmDialog";

export interface LegacyMigrationModalProps {
  isOpen: boolean;
  /** Schließt das Modal ohne Aktion (Später-Pfad). */
  onClose: () => void;
  /** Slug aus dem alten Schema (projectNameToId(name)). */
  legacySlug: string;
  /** Stabile UUID des aktuellen Projekts (Ziel der Migration). */
  newProjectId: string;
  /** Anzahl gefundener Legacy-Versionen (Anzeige). */
  legacyCount: number;
  /** Optional: Callback nach erfolgreicher Migration/Verwerfen. */
  onComplete?: (action: "migrate" | "discard" | "later") => void;
}

type Phase = "idle" | "running" | "done" | "error";

export function LegacyMigrationModal({
  isOpen,
  onClose,
  legacySlug,
  newProjectId,
  legacyCount,
  onComplete,
}: LegacyMigrationModalProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const confirm = useConfirm();

  // Reset interner State beim Öffnen
  useEffect(() => {
    if (isOpen) {
      setPhase("idle");
      setProgress(null);
      setErrorText(null);
    }
  }, [isOpen]);

  // ESC schließt nur wenn keine Migration läuft.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "running") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose, phase]);

  const handleMigrate = useCallback(async () => {
    setPhase("running");
    setProgress({ done: 0, total: legacyCount });
    setErrorText(null);
    try {
      const res = await migrateLegacyVersions(legacySlug, newProjectId, {
        onProgress: (done, total) => {
          setProgress({ done, total });
        },
      });
      if (res.migrated > 0) {
        toast(
          `${res.migrated} Version${res.migrated === 1 ? "" : "en"} migriert`,
          { kind: "success" },
        );
      }
      if (res.errors.length > 0) {
        setErrorText(
          `${res.errors.length} Fehler beim Migrieren — siehe Konsole.`,
        );
        console.warn("[LegacyMigration] errors:", res.errors);
      }
      setPhase("done");
      onComplete?.("migrate");
      // Auto-Close nach Erfolg (kurze Pause damit User Erfolg sieht)
      window.setTimeout(() => onClose(), 1200);
    } catch (err) {
      setErrorText(String(err));
      setPhase("error");
      toast("Migration fehlgeschlagen", { kind: "error", duration: 5000 });
    }
  }, [legacySlug, newProjectId, legacyCount, onComplete, onClose]);

  const handleDiscard = useCallback(async () => {
    const ok = await confirm({
      title: `${legacyCount} alte Version${legacyCount === 1 ? "" : "en"} unwiderruflich löschen?`,
      confirmLabel: "Löschen",
      destructive: true,
    });
    if (!ok) return;
    setPhase("running");
    setErrorText(null);
    try {
      const res = await deleteAllVersions(legacySlug);
      toast(
        `${res.deleted} alte Version${res.deleted === 1 ? "" : "en"} gelöscht`,
        { kind: "info" },
      );
      if (res.errors > 0) {
        console.warn("[LegacyMigration] discard errors:", res.errors);
      }
      setPhase("done");
      onComplete?.("discard");
      window.setTimeout(() => onClose(), 700);
    } catch (err) {
      setErrorText(String(err));
      setPhase("error");
      toast("Löschen fehlgeschlagen", { kind: "error", duration: 5000 });
    }
  }, [legacySlug, legacyCount, onComplete, onClose, confirm]);

  const handleLater = useCallback(() => {
    onComplete?.("later");
    onClose();
  }, [onClose, onComplete]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg-base/80"
      role="dialog"
      aria-modal="true"
      aria-label="AutoSave Migration"
      data-testid="autosave-legacy-migration-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget && phase !== "running") onClose();
      }}
    >
      <div className="bg-bg-panel border border-border-color rounded-lg shadow-xl w-[520px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-color">
          <h2 className="text-sm font-bold text-text-primary">
            AutoSave-Versionen migrieren?
          </h2>
          {phase !== "running" && (
            <button
              onClick={onClose}
              title="Schließen"
              className="w-7 h-7 rounded flex items-center justify-center text-text-dim hover:text-text-primary hover:bg-bg-elevated transition-colors"
              data-testid="legacy-migration-close-btn"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-5 py-4">
          <p
            className="text-xs text-text-primary"
            data-testid="legacy-migration-message"
          >
            <strong>{legacyCount}</strong> AutoSave-Version
            {legacyCount === 1 ? "" : "en"} unter altem Schema gefunden
            <span className="text-text-dim"> (legacy: </span>
            <code className="text-accent-secondary">{legacySlug}</code>
            <span className="text-text-dim">)</span>.
          </p>
          <p className="text-[11px] text-text-muted mt-3 leading-relaxed">
            Seit v3.58 verwendet Synthstudio eine stabile UUID statt des
            Projekt-Namens als History-Schlüssel — dadurch bleibt die
            Versions-History auch nach einem Rename erhalten. Diese alten
            Versionen können in die neue UUID übernommen werden.
          </p>
          {phase === "running" && progress && (
            <div
              className="mt-4 px-3 py-2 bg-bg-elevated rounded border border-accent-primary/30"
              data-testid="legacy-migration-progress"
            >
              <div className="text-[11px] text-text-primary">
                Migrating {progress.done}/{progress.total}…
              </div>
              <div className="mt-1 h-1 bg-bg-base rounded overflow-hidden">
                <div
                  className="h-full bg-accent-primary transition-all duration-200"
                  style={{
                    width:
                      progress.total > 0
                        ? `${Math.min(100, (progress.done / progress.total) * 100)}%`
                        : "0%",
                  }}
                  data-testid="legacy-migration-progress-bar"
                />
              </div>
            </div>
          )}
          {phase === "done" && !errorText && (
            <div className="mt-4 px-3 py-2 bg-accent-success/10 border border-accent-success/30 rounded text-[11px] text-accent-success">
              Erfolgreich abgeschlossen.
            </div>
          )}
          {errorText && (
            <div
              className="mt-4 px-3 py-2 bg-accent-danger/10 border border-accent-danger/30 rounded text-[11px] text-accent-danger"
              data-testid="legacy-migration-error"
            >
              {errorText}
            </div>
          )}
        </div>

        {/* Footer / Actions */}
        <div className="px-5 py-3 border-t border-border-color flex items-center gap-2">
          <button
            onClick={handleLater}
            disabled={phase === "running"}
            className="px-3 py-1.5 rounded text-[11px] text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            data-testid="legacy-migration-later-btn"
          >
            <Clock size={11} aria-hidden="true" />
            Später
          </button>
          <div className="flex-1" />
          <button
            onClick={() => void handleDiscard()}
            disabled={phase === "running" || phase === "done"}
            className="px-3 py-1.5 rounded text-[11px] text-accent-danger hover:bg-accent-danger/10 border border-accent-danger/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            data-testid="legacy-migration-discard-btn"
          >
            <Trash2 size={11} aria-hidden="true" />
            Verwerfen
          </button>
          <button
            onClick={() => void handleMigrate()}
            disabled={phase === "running" || phase === "done"}
            className="px-3 py-1.5 rounded text-[11px] bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/25 border border-accent-primary/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            data-testid="legacy-migration-migrate-btn"
          >
            <ArrowRightCircle size={11} aria-hidden="true" />
            Migrieren
          </button>
        </div>
      </div>
    </div>
  );
}
