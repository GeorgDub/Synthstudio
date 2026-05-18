/**
 * Synthstudio – AutoSaveStatusIndicator.tsx (v3.61.0)
 *
 * Subtiler Topbar-Indikator der den letzten erfolgreichen AutoSave anzeigt.
 * Klick öffnet die Versions-History (Caller-Prop). Updates 1×/30s.
 *
 * v3.61.0: Liest pro-projectId aus `lastSaveAtPerProject` falls Prop gesetzt
 * — sonst Fallback auf den Legacy-`lastSaveAt`. Beim Projektwechsel zeigt der
 * Indikator damit den dortigen letzten Save statt "Noch nie".
 */
import { useEffect, useReducer } from "react";
import { Save } from "lucide-react";
import { useAutoSaveStore, getLastSaveAtForProject } from "@/store/useAutoSaveStore";
import { buildAutoSaveStatusDisplay } from "@/utils/autoSaveController";

export interface AutoSaveStatusIndicatorProps {
  /** Klick öffnet die History-Modal. */
  onOpenHistory: () => void;
  /** Wenn false, versteckt sich der Indikator komplett (z.B. AutoSave AUS). */
  visible?: boolean;
  /**
   * v3.61.0: Aktive projectId. Wenn gesetzt, wird der per-project Wert aus
   * `lastSaveAtPerProject[projectId]` angezeigt; Fallback auf Legacy
   * `lastSaveAt`. Wenn undefined, wird wie pre-v3.61.0 nur Legacy genutzt.
   */
  projectId?: string;
}

export function AutoSaveStatusIndicator({
  onOpenHistory,
  visible = true,
  projectId,
}: AutoSaveStatusIndicatorProps) {
  const settings = useAutoSaveStore();
  // 30s-Tick damit "vor X min" sich aktualisiert ohne constant-re-render.
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const id = window.setInterval(() => rerender(), 30_000);
    return () => window.clearInterval(id);
  }, []);

  if (!visible || !settings.enabled) return null;

  // v3.61.0: pro-projectId-Lookup zuerst, sonst Legacy-Feld.
  const perProject = projectId ? getLastSaveAtForProject(projectId) : null;
  const effectiveLastSaveAt = perProject ?? settings.lastSaveAt;
  const display = buildAutoSaveStatusDisplay(effectiveLastSaveAt);

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
