/**
 * MixAssistantPanel.tsx
 *
 * Seiten-Panel das Mix-Empfehlungen des regelbasierten Analysators anzeigt.
 * Zeigt kritische Empfehlungen oben, Info unten.
 * "Anwenden"-Button delegiert Änderungen via Callback an den aufrufenden Store.
 */
import React, { useState, useCallback } from "react";
import { analyzeMix, MixAnalysisInput, MixRecommendation } from "../../utils/mixAnalysis";

// ─── Icons (inline SVG um keine extra Abhängigkeit zu benötigen) ──────────────

const IconCritical = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
    <circle cx="8" cy="8" r="7.5" stroke="#ef4444" />
    <path d="M8 4v5M8 11h.01" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
const IconWarning = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
    <path d="M8 1.5L1 14.5h14L8 1.5z" stroke="#f59e0b" strokeWidth="1.3" />
    <path d="M8 6v4M8 11.5h.01" stroke="#f59e0b" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);
const IconInfo = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
    <circle cx="8" cy="8" r="7.5" stroke="#60a5fa" />
    <path d="M8 7v5M8 5h.01" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const SeverityIcon = ({ severity }: { severity: MixRecommendation["severity"] }) => {
  if (severity === "critical") return <IconCritical />;
  if (severity === "warning") return <IconWarning />;
  return <IconInfo />;
};

const severityLabel: Record<MixRecommendation["severity"], string> = {
  critical: "Kritisch",
  warning: "Warnung",
  info: "Info",
};

const severityBg: Record<MixRecommendation["severity"], string> = {
  critical: "bg-red-950/60 border-red-800",
  warning: "bg-amber-950/60 border-amber-800",
  info: "bg-blue-950/40 border-blue-900",
};

// ─── Props ────────────────────────────────────────────────────────────────────

export interface MixAssistantPanelProps {
  input: MixAnalysisInput;
  /** Wird aufgerufen wenn der Nutzer "Anwenden" klickt */
  onApply: (rec: MixRecommendation) => void;
  onClose: () => void;
}

// ─── Komponente ───────────────────────────────────────────────────────────────

export function MixAssistantPanel({ input, onApply, onClose }: MixAssistantPanelProps) {
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [recommendations, setRecommendations] = useState<MixRecommendation[]>(() =>
    analyzeMix(input)
  );

  const handleReAnalyze = useCallback(() => {
    setIsAnalyzing(true);
    // Kurze Verzögerung für visuelles Feedback
    setTimeout(() => {
      setRecommendations(analyzeMix(input));
      setAppliedIds(new Set());
      setIsAnalyzing(false);
    }, 300);
  }, [input]);

  const handleApply = useCallback(
    (rec: MixRecommendation) => {
      onApply(rec);
      setAppliedIds(prev => new Set([...Array.from(prev), rec.id]));
    },
    [onApply]
  );

  if (recommendations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-400 p-6">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <circle cx="20" cy="20" r="19" stroke="#22c55e" strokeWidth="2" />
          <path d="M12 21l6 6 10-13" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="font-semibold text-green-400">Mix klingt gut!</p>
        <p className="text-sm text-center">Keine Empfehlungen – alle Regeln bestanden.</p>
        <button
          onClick={onClose}
          className="mt-2 px-4 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-sm text-zinc-200 transition-colors"
        >
          Schließen
        </button>
      </div>
    );
  }

  return (
    <aside className="flex flex-col h-full bg-zinc-900 border-l border-zinc-700 w-80 min-w-[20rem] text-zinc-200 text-sm">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 shrink-0">
        <div className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M9 2v5M9 11v5M2 9h5M11 9h5" stroke="#818cf8" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="font-semibold text-indigo-300">Mix-Assistent</span>
          <span className="rounded-full bg-zinc-700 px-1.5 py-0.5 text-xs text-zinc-400">
            {recommendations.length}
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded hover:bg-zinc-700 p-1 transition-colors text-zinc-400 hover:text-zinc-200"
          aria-label="Schließen"
        >
          ✕
        </button>
      </header>

      {/* Empfehlungs-Liste */}
      <ul className="flex-1 overflow-y-auto p-3 space-y-2" role="list">
        {recommendations.map(rec => {
          const applied = appliedIds.has(rec.id);
          return (
            <li
              key={rec.id}
              className={`rounded-lg border p-3 ${severityBg[rec.severity]} ${applied ? "opacity-50" : ""}`}
            >
              <div className="flex gap-2 items-start">
                <SeverityIcon severity={rec.severity} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-0.5">
                    {severityLabel[rec.severity]} · {rec.category}
                    {rec.partId && (
                      <span className="ml-1 text-zinc-500">#{rec.partId.slice(-4)}</span>
                    )}
                  </p>
                  <p className="leading-snug">{rec.message}</p>
                  {rec.suggestedValue !== undefined && !applied && (
                    <button
                      onClick={() => handleApply(rec)}
                      className="mt-2 px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-xs text-white transition-colors"
                    >
                      Anwenden ({rec.targetProperty}: {rec.suggestedValue})
                    </button>
                  )}
                  {applied && (
                    <span className="mt-2 inline-block px-2 py-0.5 rounded bg-green-900 text-green-300 text-xs">
                      Angewendet ✓
                    </span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Footer */}
      <footer className="px-4 py-3 border-t border-zinc-700 shrink-0 flex gap-2 justify-end">
        <button
          onClick={handleReAnalyze}
          disabled={isAnalyzing}
          className="px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-xs text-zinc-200 transition-colors disabled:opacity-50"
        >
          {isAnalyzing ? "Analysiere…" : "Neu analysieren"}
        </button>
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-xs text-zinc-200 transition-colors"
        >
          Schließen
        </button>
      </footer>
    </aside>
  );
}

export default MixAssistantPanel;
