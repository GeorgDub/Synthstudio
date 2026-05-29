/**
 * Synthstudio – RecordSettingsPopover
 *
 * Compact controls für Live-Step-Recording-Optionen (Welle 2, post-v1.31.0):
 *  - Recording-Mode toggle (Overdub / Replace)
 *  - Punch-In / Punch-Out Step-Eingaben
 *  - Clear-Punch-Range Button
 *
 * Wird neben dem Record-Button im Transport platziert. Öffnet/schließt
 * via kleinem ⚙-Trigger-Button mit Detail-Popover.
 */
import { useState, useRef, useEffect } from "react";

export interface RecordSettingsPopoverProps {
  recordingMode: "overdub" | "replace";
  onRecordingModeChange: (mode: "overdub" | "replace") => void;
  punchInStep: number | null;
  punchOutStep: number | null;
  onPunchInChange: (step: number | null) => void;
  onPunchOutChange: (step: number | null) => void;
  onClearPunchRange: () => void;
  /** Maximaler Step-Index für die Inputs (= stepCount - 1). */
  maxStep: number;
}

export function RecordSettingsPopover({
  recordingMode,
  onRecordingModeChange,
  punchInStep,
  punchOutStep,
  onPunchInChange,
  onPunchOutChange,
  onClearPunchRange,
  maxStep,
}: RecordSettingsPopoverProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Click-outside + Escape schließen das Popover
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const hasPunch = punchInStep !== null || punchOutStep !== null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Recording-Einstellungen"
        aria-expanded={open}
        title="Recording-Modus + Punch-In/Out"
        data-testid="record-settings-toggle"
        className={[
          "w-7 h-7 rounded text-[10px] flex items-center justify-center transition-colors duration-100",
          recordingMode === "replace" || hasPunch
            ? "bg-accent-danger/20 text-accent-danger hover:bg-accent-danger/30"
            : "bg-bg-elevated text-text-dim hover:bg-border-color hover:text-text-muted",
        ].join(" ")}
      >
        ⚙
      </button>

      {open && (
        <div
          data-testid="record-settings-popover"
          className="absolute top-9 left-0 z-50 w-64 rounded border border-border-color bg-bg-panel shadow-xl p-3 space-y-3"
        >
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-text-dim mb-1.5">
              Recording-Modus
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => onRecordingModeChange("overdub")}
                data-testid="record-mode-overdub"
                className={[
                  "flex-1 px-2 py-1 text-[10px] rounded border transition-colors",
                  recordingMode === "overdub"
                    ? "bg-accent-primary/20 border-accent-primary text-accent-primary"
                    : "bg-bg-elevated border-border-color text-text-muted hover:text-text-primary",
                ].join(" ")}
              >
                Overdub
              </button>
              <button
                type="button"
                onClick={() => onRecordingModeChange("replace")}
                data-testid="record-mode-replace"
                className={[
                  "flex-1 px-2 py-1 text-[10px] rounded border transition-colors",
                  recordingMode === "replace"
                    ? "bg-accent-danger/20 border-accent-danger text-accent-danger"
                    : "bg-bg-elevated border-border-color text-text-muted hover:text-text-primary",
                ].join(" ")}
              >
                Replace
              </button>
            </div>
            <p className="text-[9px] text-text-dim mt-1">
              {recordingMode === "replace"
                ? "Replace: alte Steps werden gelöscht während Playback vorrückt."
                : "Overdub: alte Steps bleiben, neue werden hinzugefügt."}
            </p>
          </div>

          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-text-dim mb-1.5">
              Punch-In / Out
            </div>
            <div className="flex gap-2 items-center">
              <label className="flex flex-col gap-0.5 flex-1">
                <span className="text-[9px] text-text-dim">In</span>
                <input
                  type="number"
                  min={0}
                  max={maxStep}
                  value={punchInStep ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    onPunchInChange(v === "" ? null : Math.max(0, Math.min(maxStep, parseInt(v, 10) || 0)));
                  }}
                  placeholder="—"
                  data-testid="punch-in-input"
                  className="w-full bg-bg-elevated text-text-primary text-xs px-2 py-1 rounded border border-border-color focus:border-accent-primary outline-none"
                />
              </label>
              <label className="flex flex-col gap-0.5 flex-1">
                <span className="text-[9px] text-text-dim">Out</span>
                <input
                  type="number"
                  min={0}
                  max={maxStep}
                  value={punchOutStep ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    onPunchOutChange(v === "" ? null : Math.max(0, Math.min(maxStep, parseInt(v, 10) || 0)));
                  }}
                  placeholder="—"
                  data-testid="punch-out-input"
                  className="w-full bg-bg-elevated text-text-primary text-xs px-2 py-1 rounded border border-border-color focus:border-accent-primary outline-none"
                />
              </label>
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <p className="text-[9px] text-text-dim flex-1">
                {hasPunch
                  ? "Nur Steps in der Range werden recorded."
                  : "Leer = ganzes Pattern recorden."}
              </p>
              {hasPunch && (
                <button
                  type="button"
                  onClick={onClearPunchRange}
                  data-testid="punch-clear"
                  className="text-[9px] text-accent-secondary hover:text-accent-primary"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
