/**
 * UpdateBadge – kompakter Update-Indikator für die Transport-Leiste.
 *
 * Zeigt je nach Phase:
 * - idle:        "Auf Updates prüfen"-Button (nur Icon)
 * - checking:    rotierendes Icon
 * - up-to-date:  kurzes "✓"-Flash (verschwindet nach 4s)
 * - available:   gelber Badge "v1.x.x"  (Download läuft automatisch über native Dialog)
 * - downloading: Fortschrittsbalken mit %
 * - ready:       grüner "● Neu starten"-Button
 * - error:       roter Punkt mit Tooltip
 */
import { useState, useEffect } from "react";
import { useUpdater } from "../hooks/useUpdater";

export function UpdateBadge() {
  const { state, checkForUpdates } = useUpdater();
  const [showUpToDate, setShowUpToDate] = useState(false);

  useEffect(() => {
    if (state.phase === "up-to-date") {
      setShowUpToDate(true);
      const t = setTimeout(() => setShowUpToDate(false), 4000);
      return () => clearTimeout(t);
    }
  }, [state.phase]);

  const btn = (
    content: React.ReactNode,
    onClick?: () => void,
    title?: string,
    extra = ""
  ) => (
    <button
      onClick={onClick}
      title={title}
      className={[
        "h-8 px-2 rounded flex items-center gap-1.5 text-xs transition-colors duration-100",
        extra,
      ].join(" ")}
    >
      {content}
    </button>
  );

  switch (state.phase) {
    case "idle":
      return btn(
        <span title="Auf Updates prüfen">↻</span>,
        checkForUpdates,
        "Auf Updates prüfen",
        "bg-bg-elevated text-text-dim hover:text-text-primary "
      );

    case "checking":
      return btn(
        <span className="animate-spin inline-block">↻</span>,
        undefined,
        "Suche nach Updates…",
        "bg-bg-elevated text-text-muted cursor-default"
      );

    case "up-to-date":
      if (!showUpToDate) return null;
      return btn(
        <>
          <span className="text-accent-success">✓</span>
          <span className="text-text-muted">Aktuell</span>
        </>,
        undefined,
        "App ist auf dem neuesten Stand",
        "bg-bg-elevated text-text-muted cursor-default"
      );

    case "available":
      return btn(
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-accent-secondary flex-shrink-0" />
          <span className="text-accent-secondary">
            Update {state.version ? `v${state.version}` : "verfügbar"}
          </span>
        </>,
        undefined,
        "Update wird heruntergeladen…",
        "bg-accent-secondary/20 text-accent-secondary cursor-default"
      );

    case "downloading":
      return (
        <div
          className="h-8 px-2 rounded flex items-center gap-2 bg-bg-elevated text-xs text-text-muted"
          title={`Herunterladen… ${state.percent ?? 0}%`}
        >
          <div className="w-20 h-1.5 rounded-full bg-bg-elevated overflow-hidden">
            <div
              className="h-full bg-accent-primary transition-all duration-200"
              style={{ width: `${state.percent ?? 0}%` }}
            />
          </div>
          <span>{state.percent ?? 0}%</span>
        </div>
      );

    case "ready":
      return btn(
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-accent-success animate-pulse flex-shrink-0" />
          <span className="text-accent-success">
            v{state.version} – Neu starten
          </span>
        </>,
        undefined,
        "Update heruntergeladen – App wird beim nächsten Start installiert",
        "bg-accent-success/20 text-accent-success cursor-default"
      );

    case "error":
      return btn(
        <span className="w-1.5 h-1.5 rounded-full bg-accent-danger flex-shrink-0" />,
        checkForUpdates,
        `Update-Fehler: ${state.errorMessage ?? "unbekannt"} – Klicken zum Wiederholen`,
        "bg-bg-elevated text-text-dim hover:text-text-primary"
      );

    default:
      return null;
  }
}
