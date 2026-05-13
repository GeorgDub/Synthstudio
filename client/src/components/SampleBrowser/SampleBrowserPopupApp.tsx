/**
 * SampleBrowserPopupApp.tsx — separates Sample-Browser-Fenster
 * (Multi-Window-Workspace, post-v1.27.0).
 *
 * Gerendert wenn die App mit URL-Param `?sampleBrowserPopup=1` startet.
 * Singleton — eine Sample-Library-Ansicht pro Session.
 *
 * Scope (Phase 1, "Maschine-Browser-Style"):
 *   - Sample-Liste mit Name + Kategorie + Größe
 *   - Suche (filtert nach Name)
 *   - Kategorie-Filter-Buttons
 *   - Click auf Sample → assignt zum aktuell aktiven Kanal im Hauptfenster
 *   - Anzeige welcher Kanal aktiv ist
 *
 * NICHT in Phase 1 (bleiben im Haupt-Fenster):
 *   - Import (File-Dialog braucht Main-Kontext)
 *   - Delete (potentiell destruktiv — bleibt zentralisiert)
 *   - Reorder (Drag-Drop zwischen Windows ist komplex)
 *   - Kategorie ändern (Drag-Drop)
 *   - Waveform-Anzeige (braucht Audio-Decoding)
 *   - Playlists
 *
 * Drag-Drop zwischen Electron-Windows ist mit dem Standard-HTML5-DnD nicht
 * möglich. Stattdessen "click-to-assign-active-channel" (Maschine/MPC-Style).
 */
import { useEffect, useMemo, useState } from "react";
import { useElectron } from "../../../../electron/useElectron";
import { DetachableWindowHeader } from "@/components/Window/DetachableWindowHeader";

// ─── State-Sync-Schema ────────────────────────────────────────────────────────

/** Minimale Sample-Metadaten die ins Popup geschickt werden. */
export interface SamplePopupItem {
  id: string;
  name: string;
  category: string;
  size?: number;
}

/** Vollständiger Snapshot, der vom Main-Renderer ins Popup geht. */
export interface SampleBrowserPopupState {
  samples: SamplePopupItem[];
  /** Name des aktuell aktiven Kanals (für Assign-Anzeige). */
  activeChannelName: string | null;
}

/** Action-Payload, das vom Popup zum Main-Renderer geht. */
export type SampleBrowserPopupAction =
  | { type: "request-state" }
  | { type: "assign-sample-to-active-channel"; sampleId: string };

const INITIAL_STATE: SampleBrowserPopupState = {
  samples: [],
  activeChannelName: null,
};

// ─── Kategorien (sync mit SampleBrowser.tsx) ──────────────────────────────────

interface CategoryDef { id: string; label: string; emoji: string }

const CATEGORIES: CategoryDef[] = [
  { id: "all",        label: "Alle",       emoji: "◈" },
  { id: "kicks",      label: "Kicks",      emoji: "🥁" },
  { id: "snares",     label: "Snares",     emoji: "🪘" },
  { id: "hihats",     label: "Hi-Hats",    emoji: "🎩" },
  { id: "claps",      label: "Claps",      emoji: "👏" },
  { id: "toms",       label: "Toms",       emoji: "🔵" },
  { id: "percussion", label: "Perc",       emoji: "🎵" },
  { id: "fx",         label: "FX",         emoji: "⚡" },
  { id: "loops",      label: "Loops",      emoji: "🔁" },
  { id: "vocals",     label: "Vocals",     emoji: "🎤" },
  { id: "other",      label: "Sonstige",   emoji: "📁" },
  { id: "imported",   label: "Importiert", emoji: "📥" },
];

function formatBytes(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Komponente ───────────────────────────────────────────────────────────────

export function SampleBrowserPopupApp() {
  const electron = useElectron();
  const [state, setState] = useState<SampleBrowserPopupState>(INITIAL_STATE);
  const [synced, setSynced] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [lastAssignedId, setLastAssignedId] = useState<string | null>(null);

  // State-Sync vom Main empfangen
  useEffect(() => {
    if (!electron.isElectron) return;
    const cleanup = electron.onSampleBrowserPopupState?.((payload) => {
      if (!payload || typeof payload !== "object") return;
      const s = payload as Partial<SampleBrowserPopupState>;
      setState((prev) => ({
        ...prev,
        ...s,
        samples: Array.isArray(s.samples) ? s.samples : prev.samples,
      }));
      setSynced(true);
    });
    return cleanup;
  }, [electron]);

  // Initial-Request
  useEffect(() => {
    if (!electron.isElectron) return;
    electron.sendSampleBrowserPopupAction?.({ type: "request-state" });
  }, [electron]);

  // Always-on-top initial
  useEffect(() => {
    if (!electron.isElectron) return;
    electron.isSampleBrowserWindowAlwaysOnTop?.().then(setAlwaysOnTop).catch(() => {});
  }, [electron]);

  // Visual feedback after assignment fades after 800ms
  useEffect(() => {
    if (!lastAssignedId) return;
    const id = setTimeout(() => setLastAssignedId(null), 800);
    return () => clearTimeout(id);
  }, [lastAssignedId]);

  const toggleAlwaysOnTop = () => {
    if (!electron.isElectron) return;
    const next = !alwaysOnTop;
    void electron.setSampleBrowserWindowAlwaysOnTop?.(next).then((res) => {
      if (res?.success) setAlwaysOnTop(res.alwaysOnTop);
    });
  };

  // Filter sample list by search + category
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return state.samples.filter((s) => {
      if (categoryFilter !== "all" && s.category !== categoryFilter) return false;
      if (q && !s.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [state.samples, searchQuery, categoryFilter]);

  const handleAssign = (sampleId: string) => {
    if (!state.activeChannelName) return;
    electron.sendSampleBrowserPopupAction?.({ type: "assign-sample-to-active-channel", sampleId });
    setLastAssignedId(sampleId);
  };

  if (!electron.isElectron) {
    return (
      <div className="fixed inset-0 bg-bg-base flex items-center justify-center text-center p-8">
        <div>
          <h1 className="text-accent-secondary text-2xl font-bold mb-2">SAMPLE BROWSER</h1>
          <p className="text-text-muted">
            Das separate Sample-Browser-Fenster ist nur in der Electron-Desktop-App verfügbar.
          </p>
        </div>
      </div>
    );
  }

  if (!synced) {
    return (
      <div className="fixed inset-0 bg-bg-base flex items-center justify-center text-center p-8">
        <div>
          <h1 className="text-accent-secondary text-2xl font-bold mb-2">SAMPLE BROWSER</h1>
          <p className="text-text-muted">Verbinde mit Haupt-Fenster...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-bg-base text-text-primary">
      <DetachableWindowHeader
        title="Sample Browser"
        alwaysOnTop={alwaysOnTop}
        onToggleAlwaysOnTop={toggleAlwaysOnTop}
        onClose={() => electron.closeSampleBrowserWindow?.()}
        testIdPrefix="sample-browser-popup"
      />

      {/* Active-Channel-Display */}
      <div className="flex items-center px-3 py-1.5 border-b border-border-color bg-bg-panel text-[10px] uppercase tracking-wider">
        <span className="text-text-dim">Klick →</span>
        <span
          className={[
            "ml-2 px-2 py-0.5 rounded font-medium",
            state.activeChannelName
              ? "bg-accent-primary/20 text-accent-primary"
              : "bg-bg-elevated text-text-dim",
          ].join(" ")}
          data-testid="sample-browser-popup-active-channel"
        >
          {state.activeChannelName ?? "kein Kanal ausgewählt"}
        </span>
        <span className="ml-auto text-text-dim">
          {filtered.length} / {state.samples.length} Samples
        </span>
      </div>

      {/* Suche */}
      <div className="px-3 py-2 border-b border-border-color">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Sample suchen…"
          data-testid="sample-browser-popup-search"
          className="w-full bg-bg-elevated text-text-primary text-xs px-3 py-1.5 rounded border border-border-color placeholder:text-text-dim focus:border-accent-primary outline-none"
        />
      </div>

      {/* Kategorie-Filter */}
      <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-border-color">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCategoryFilter(c.id)}
            data-testid={`sample-browser-popup-cat-${c.id}`}
            className={[
              "px-2 py-0.5 text-[10px] rounded border transition-colors",
              categoryFilter === c.id
                ? "bg-accent-primary/20 border-accent-primary text-accent-primary"
                : "bg-bg-elevated border-border-color text-text-dim hover:text-text-primary hover:border-accent-secondary",
            ].join(" ")}
          >
            {c.emoji} {c.label}
          </button>
        ))}
      </div>

      {/* Sample-Liste */}
      <div className="flex-1 overflow-auto" data-testid="sample-browser-popup-list">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-dim text-xs">
            Keine Samples in dieser Auswahl
          </div>
        ) : (
          <ul>
            {filtered.map((sample) => (
              <li
                key={sample.id}
                onClick={() => handleAssign(sample.id)}
                data-testid={`sample-browser-popup-item-${sample.id}`}
                className={[
                  "flex items-center gap-2 px-3 py-1.5 border-b border-border-color/30 text-xs transition-colors",
                  state.activeChannelName
                    ? "cursor-pointer hover:bg-bg-elevated"
                    : "cursor-not-allowed opacity-60",
                  lastAssignedId === sample.id ? "bg-accent-success/20" : "",
                ].join(" ")}
                title={state.activeChannelName ? `Auf "${state.activeChannelName}" legen` : "Erst Kanal im Hauptfenster auswählen"}
              >
                <span className="flex-1 truncate font-mono">{sample.name}</span>
                <span className="text-[10px] text-text-dim shrink-0">
                  {CATEGORIES.find((c) => c.id === sample.category)?.emoji ?? "📁"} {sample.category}
                </span>
                {sample.size !== undefined && (
                  <span className="text-[10px] text-text-dim font-mono shrink-0 w-14 text-right">
                    {formatBytes(sample.size)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
