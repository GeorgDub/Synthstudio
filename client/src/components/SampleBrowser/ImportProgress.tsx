// ─── Import-Fortschritts-Overlay ─────────────────────────────────────────────
// v3.277 (TASK-255-FOLLOWUP): aus SampleBrowser.tsx extrahiert (verbatim Move,
// verhaltensneutral). Props-only, keine Hooks/Refs/Effects, keine Modul-Helfer.

export interface ImportProgressProps {
  current: number;
  total: number;
  percentage: number;
  phase: string;
  currentFile?: string;
  onCancel?: () => void;
}

export function ImportProgress({ current, total, percentage, phase, currentFile, onCancel }: ImportProgressProps) {
  const phaseLabel = phase === "counting" ? "Zähle Dateien…"
    : phase === "reading" ? "Lese Archiv…"
    : phase === "extracting" ? "Extrahiere…"
    : "Importiere…";

  return (
    <div className="absolute inset-0 bg-bg-panel/95 flex flex-col items-center justify-center gap-3 z-10 rounded-lg">
      <p className="text-sm font-semibold text-accent-secondary">{phaseLabel}</p>
      {total > 0 && (
        <>
          <div className="w-48 h-1.5 bg-bg-elevated rounded-full overflow-hidden">
            <div
              className="h-full bg-accent-primary rounded-full transition-all duration-200"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <p className="text-xs text-text-dim">
            {current} / {total} ({percentage}%)
          </p>
        </>
      )}
      {currentFile && (
        <p className="text-xs text-text-dim truncate max-w-[180px]" title={currentFile}>
          {currentFile}
        </p>
      )}
      {onCancel && (
        <button
          onClick={onCancel}
          className="mt-1 px-3 py-1 text-xs rounded bg-accent-danger/40 text-accent-danger border border-accent-danger hover:bg-accent-danger/60 transition-colors"
        >
          Abbrechen
        </button>
      )}
    </div>
  );
}
