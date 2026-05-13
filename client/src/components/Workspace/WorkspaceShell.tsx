/**
 * Synthstudio – WorkspaceShell (post-v1.34.0, MIG-2A)
 *
 * Dockview-basierter Workspace-Container für den Multi-Window-Workspace.
 * Ersetzt schrittweise die activeTab-basierte Rendering-Logik in App.tsx
 * (Phase 2: in-window docking; Phase 3: Electron-Popout).
 *
 * Architektur:
 *  - Eine `DockviewReact`-Instanz hostet alle Panels (Mixer, Inspector, Drum
 *    Machine, Tools, etc.).
 *  - Panels registrieren sich als "components" — jeder Component ist eine
 *    React-Komponente die in einer Dock-Tab gerendert wird.
 *  - User kann Tabs ziehen, splitten (horizontal/vertikal), zu Gruppen
 *    zusammenführen, "Floating Windows" innerhalb des Hauptfensters erzeugen.
 *  - Layout wird als JSON serialisiert + persistiert (AppStore + localStorage).
 *
 * Phase 3 (MIG-3): "Popout"-API von Dockview wird mit createDockviewWindow-IPC
 * verbunden, sodass ein Tab in ein echtes Electron-BrowserWindow gezogen werden
 * kann, das den gleichen DockviewShell mit dem populierten Tab lädt. Drag-Drop
 * zwischen Windows = drag-out OR drag-back = reattach.
 *
 * Feature-Flag: aktuelle Implementierung läuft PARALLEL zur alten activeTab-
 * Logik. Über `useWorkspaceMode` in `useAppSettings` (TBD) kann der User
 * zwischen "Legacy Tabs" und "Dockview Workspace" umschalten. Defensive
 * Strategy bis dockview-Stabilität bewiesen ist.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type IDockviewHeaderActionsProps,
  type DockviewApi,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";

/** Generic Dockview-Panel-Komponente Typ (props-agnostic). */
export type WorkspacePanelComponent = React.FunctionComponent<IDockviewPanelProps>;

/**
 * MIG-3: "Pop out" Action im Group-Header. Klick öffnet die aktive Gruppe in
 * einem eigenen Fenster (Electron BrowserWindow oder Browser-Popup).
 * Dockview's addPopoutGroup() ruft window.open(popoutUrl) auf → in Electron
 * fängt setWindowOpenHandler das ab und erzeugt eine echte BrowserWindow.
 */
function PopOutHeaderAction({ containerApi, group, activePanel }: IDockviewHeaderActionsProps) {
  const handleClick = useCallback(() => {
    const target = activePanel ?? group;
    void containerApi.addPopoutGroup(target, {
      // Default-Größe; Electron's setWindowOpenHandler nutzt diese als
      // overrideBrowserWindowOptions.
      position: { width: 800, height: 600, left: 100, top: 100 },
    });
  }, [containerApi, group, activePanel]);
  return (
    <button
      type="button"
      onClick={handleClick}
      title="Tab in eigenes Fenster ausklappen"
      data-testid="dockview-popout"
      style={{
        background: "transparent",
        border: "none",
        color: "var(--ss-text-muted)",
        cursor: "pointer",
        padding: "0 8px",
        fontSize: 14,
      }}
    >
      ⤢
    </button>
  );
}

export interface WorkspacePanelConfig {
  /** Eindeutige Panel-ID. */
  id: string;
  /** Sichtbarer Tab-Title. */
  title: string;
  /** React-Komponente die im Tab gerendert wird. */
  component: WorkspacePanelComponent;
  /** Optional: Component-Key (default = id). Erlaubt mehrere Tabs gleicher Komponente. */
  componentKey?: string;
}

export interface WorkspaceShellProps {
  /** Registrierte Panel-Definitionen. */
  panels: WorkspacePanelConfig[];
  /**
   * Optional: gespeichertes Layout-JSON. Wenn vorhanden, wird es geladen statt
   * Default-Layout zu erzeugen. Format = Dockview's `toJSON()` Output.
   */
  initialLayout?: object | null;
  /**
   * Wird gerufen wenn sich das Layout ändert (Tabs verschoben, Splits etc.).
   * Caller persistiert das JSON in AppStore.
   */
  onLayoutChange?: (layout: object) => void;
  /** Optional CSS class für den Container. */
  className?: string;
}

export function WorkspaceShell({ panels, initialLayout, onLayoutChange, className }: WorkspaceShellProps) {
  const [api, setApi] = useState<DockviewApi | null>(null);
  const panelsRef = useRef(panels);
  panelsRef.current = panels;

  // Map<componentKey, ReactComponent> für DockviewReact's `components`-Prop
  const components = React.useMemo(() => {
    const map: Record<string, WorkspacePanelComponent> = {};
    for (const p of panels) {
      map[p.componentKey ?? p.id] = p.component;
    }
    return map;
  }, [panels]);

  const onReady = useCallback((event: DockviewReadyEvent) => {
    setApi(event.api);

    // Restore saved layout oder Default-Layout erzeugen
    if (initialLayout && typeof initialLayout === "object") {
      try {
        event.api.fromJSON(initialLayout as Parameters<typeof event.api.fromJSON>[0]);
        return;
      } catch (err) {
        console.warn("[WorkspaceShell] fromJSON failed, falling back to default layout:", err);
      }
    }
    // Default-Layout: alle Panels nacheinander adden (erstes wird "active")
    for (let i = 0; i < panelsRef.current.length; i++) {
      const p = panelsRef.current[i];
      event.api.addPanel({
        id: p.id,
        component: p.componentKey ?? p.id,
        title: p.title,
        // Erstes Panel ist active; alle weiteren werden als Tab daneben angehängt
        position: i === 0 ? undefined : { referencePanel: panelsRef.current[i - 1].id, direction: "within" },
      });
    }
  }, [initialLayout]);

  // Layout-Change-Subscription für Persistenz
  useEffect(() => {
    if (!api || !onLayoutChange) return;
    const disposable = api.onDidLayoutChange(() => {
      try {
        onLayoutChange(api.toJSON());
      } catch (err) {
        console.warn("[WorkspaceShell] toJSON failed:", err);
      }
    });
    return () => disposable.dispose();
  }, [api, onLayoutChange]);

  return (
    <div className={`h-full w-full ${className ?? ""}`}>
      <DockviewReact
        components={components}
        onReady={onReady}
        className="dockview-theme-dark"
        // MIG-3: popoutUrl muss same-origin sein. Relativer Pfad funktioniert
        // sowohl im Browser (./popout.html) als auch in Electron (file://).
        popoutUrl="./popout.html"
        rightHeaderActionsComponent={PopOutHeaderAction}
      />
    </div>
  );
}
