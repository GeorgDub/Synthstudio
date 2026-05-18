/**
 * Synthstudio – AutoSaveStatusIndicator.tsx (v3.57.0)
 *
 * Subtiler Topbar-Indikator der den letzten erfolgreichen AutoSave anzeigt.
 * Klick öffnet die Versions-History (Caller-Prop). Updates 1×/30s.
 */
import { useEffect, useReducer } from "react";
import { Save } from "lucide-react";
import { useAutoSaveStore } from "@/store/useAutoSaveStore";
import { buildAutoSaveStatusDisplay } from "@/utils/autoSaveController";

export interface AutoSaveStatusIndicatorProps {
  /** Klick öffnet die History-Modal. */
  onOpenHistory: () => void;
  /** Wenn false, versteckt sich der Indikator komplett (z.B. AutoSave AUS). */
  visible?: boolean;
}

export function AutoSaveStatusIndicator({
  onOpenHistory,
  visible = true,
}: AutoSaveStatusIndicatorProps) {
  const settings = useAutoSaveStore();
  // 30s-Tick damit "vor X min" sich aktualisiert ohne constant-re-render.
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const id = window.setInterval(() => rerender(), 30_000);
    return () => window.clearInterval(id);
  }, []);

  if (!visible || !settings.enabled) return null;

  const display = buildAutoSaveStatusDisplay(settings.lastSaveAt);

  return (
    <button
      onClick={onOpenHistory}
      title={display.tooltip}
      aria-label={display.tooltip}
      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-text-dim hover:text-text-muted hover:bg-bg-elevated transition-colors"
      data-testid="autosave-status-indicator"
    >
      <Save size={11} aria-hidden="true" />
      <span data-testid="autosave-status-label">{display.shortLabel}</span>
    </button>
  );
}
