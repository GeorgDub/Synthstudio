// ─── Bulk-Action Floating Progress Bar ──────────────────────────────────────────
// v3.282 (TASK-272): aus SampleBrowser.tsx extrahiert (verbatim Move,
// verhaltensneutral). Props-only, kein interner State/Hook/Effect, keine
// Rück-Kante zum Parent, keine Modul-Helfer. Der Parent behält den
// {bulkProgress && (...)}-Guard und reicht die drei Skalarfelder als Props
// herein — identische Render-Ausgabe (selbe DOM-Struktur + data-testid).

export interface BulkProgressBarProps {
  label: string;
  current: number;
  total: number;
}

export function BulkProgressBar({ label, current, total }: BulkProgressBarProps) {
  return (
    <div
      data-testid="sample-browser-bulk-progress"
      className="absolute bottom-2 right-2 bg-bg-panel border border-border-color rounded px-3 py-1.5 shadow z-10"
    >
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-text-primary">{label}</span>
        <span className="text-[10px] font-mono text-text-muted">
          {current}/{total}
        </span>
        <div className="w-24 h-1.5 bg-bg-elevated rounded overflow-hidden">
          <div
            className="h-full bg-accent-secondary transition-all"
            style={{
              width: `${(current / Math.max(1, total)) * 100}%`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
