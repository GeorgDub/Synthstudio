/**
 * RenderFunctionPanels — Dünne Panel-Wrapper die auf Render-Funktionen aus
 * dem WorkspaceContext zugreifen (post-v1.36.0 MIG-2C).
 *
 * Pattern: Tab-Inhalte, die zu eng an App.tsx gekoppelt sind, exposen eine
 * Render-Funktion (z.B. `renderSongPanel`). Hier sind die zugehörigen Panel-
 * Komponenten — sie sind einzeilig und delegieren alles an die Funktion.
 *
 * Vorteil: keine Context-Aufblähung mit allen App-State-Slices. Stattdessen
 * besitzt App.tsx weiter die Closure und reicht nur die Render-Funktion durch.
 */
import type { IDockviewPanelProps } from "dockview-react";
import { useWorkspaceContext } from "../WorkspaceContext";

function FallbackEmpty({ panelName }: { panelName: string }) {
  return (
    <div className="h-full flex items-center justify-center text-xs text-text-dim">
      Panel "{panelName}" ist nicht verfügbar (renderFunction fehlt im WorkspaceContext).
    </div>
  );
}

export function SongPanel(_props: IDockviewPanelProps) {
  void _props;
  const { renderSongPanel } = useWorkspaceContext();
  return <>{renderSongPanel ? renderSongPanel() : <FallbackEmpty panelName="Song" />}</>;
}

export function HumanizerPanel(_props: IDockviewPanelProps) {
  void _props;
  const { renderHumanizerPanel } = useWorkspaceContext();
  return <>{renderHumanizerPanel ? renderHumanizerPanel() : <FallbackEmpty panelName="Humanizer" />}</>;
}

export function ToolsPanel(_props: IDockviewPanelProps) {
  void _props;
  const { renderToolsPanel } = useWorkspaceContext();
  return <>{renderToolsPanel ? renderToolsPanel() : <FallbackEmpty panelName="Tools" />}</>;
}

export function CollabPanel(_props: IDockviewPanelProps) {
  void _props;
  const { renderCollabPanel } = useWorkspaceContext();
  return <>{renderCollabPanel ? renderCollabPanel() : <FallbackEmpty panelName="Collab" />}</>;
}
