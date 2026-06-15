import { useState, useMemo } from "react";
import { filterNonInitPatterns, type ParsedPattern } from "@/utils/electribeImport";

// ─── Electribe-Bank-Picker-Modal (v3.11: Search + Init-Filter) ───────────────

interface ElectribePickerModalProps {
  picker: { fileName: string; patterns: ParsedPattern[] };
  onSelect: (p: ParsedPattern) => void;
  /** v3.272: importiert die aktuell sichtbaren Patterns als NEUE Patterns (Bank). */
  onSelectAll: (patterns: ParsedPattern[]) => void;
  onClose: () => void;
}

export function ElectribePickerModal({ picker, onSelect, onSelectAll, onClose }: ElectribePickerModalProps) {
  const [search, setSearch] = useState("");
  // Default: bei grossen Banks (>50 Patterns, also .e2sallpat) Init-Slots ausblenden.
  const [hideInit, setHideInit] = useState(picker.patterns.length > 50);

  // Pre-compute slot-indizierte Liste (#1..#250) bevor wir filtern.
  const indexed = useMemo(
    () => picker.patterns.map((p, idx) => ({ slot: idx + 1, pattern: p })),
    [picker.patterns],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let arr = indexed;
    if (hideInit) {
      const nonInit = new Set(filterNonInitPatterns(picker.patterns));
      arr = arr.filter(x => nonInit.has(x.pattern));
    }
    if (q) {
      arr = arr.filter(x =>
        x.pattern.name.toLowerCase().includes(q) ||
        String(x.slot).includes(q) ||
        x.pattern.bpm.toFixed(1).includes(q),
      );
    }
    return arr;
  }, [indexed, picker.patterns, search, hideInit]);

  const totalCount    = picker.patterns.length;
  const filteredCount = visible.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      data-testid="electribe-picker-overlay"
    >
      <div
        className="bg-bg-panel border border-border-color rounded-lg shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Electribe-Pattern auswählen"
      >
        <div className="px-4 py-3 border-b border-border-color">
          <div className="text-sm font-bold text-text-primary">Electribe Bank importieren</div>
          <div className="text-xs text-text-muted truncate">
            {picker.fileName} · {filteredCount}/{totalCount} Pattern(s)
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="text"
              placeholder="Filter: Name / Slot / BPM..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-bg-elevated border border-border-color rounded px-2 py-1 text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-primary"
              data-testid="electribe-picker-search"
            />
            {totalCount > 50 && (
              <label className="inline-flex items-center gap-1 text-[10px] text-text-muted cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hideInit}
                  onChange={(e) => setHideInit(e.target.checked)}
                  data-testid="electribe-picker-hide-init"
                />
                Init ausblenden
              </label>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {visible.length === 0 ? (
            <div className="text-center text-text-dim text-xs py-8">
              Keine Patterns entsprechen dem Filter.
            </div>
          ) : (
            visible.map(({ slot, pattern: p }) => (
              <button
                key={slot}
                data-testid={`electribe-picker-pattern-${slot - 1}`}
                onClick={() => onSelect(p)}
                className="w-full text-left px-3 py-2 rounded bg-bg-elevated hover:bg-bg-base text-text-primary text-xs flex items-center justify-between gap-2 transition-colors"
              >
                <span className="font-mono text-text-dim w-10">#{slot}</span>
                <span className="flex-1 truncate">{p.name}</span>
                <span className="text-text-muted text-[10px]">{p.bpm.toFixed(1)} BPM · {p.stepLength}st</span>
              </button>
            ))
          )}
        </div>
        <div className="px-4 py-2 border-t border-border-color flex justify-between items-center gap-2">
          <span className="text-[10px] text-text-dim">
            Klick = einzeln (überschreibt aktives Pattern) · „Alle" = als neue Patterns
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1 rounded text-xs bg-bg-elevated text-text-muted hover:text-text-primary transition-colors"
              data-testid="electribe-picker-cancel"
            >
              Abbrechen
            </button>
            <button
              onClick={() => onSelectAll(visible.map((v) => v.pattern))}
              disabled={filteredCount === 0}
              className="px-3 py-1 rounded text-xs bg-accent-primary text-bg-base font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
              data-testid="electribe-picker-import-all"
            >
              Alle ({filteredCount}) importieren
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
