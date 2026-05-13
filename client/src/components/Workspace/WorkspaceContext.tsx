/**
 * Synthstudio – WorkspaceContext (post-v1.35.0 MIG-2B)
 *
 * React Context der den Workspace-Panels (Dockview-Views) Zugriff auf die
 * zentrale App-State gewährt. Notwendig weil Dockview-Components statisch
 * via `components`-Prop registriert werden — sie haben keine direkte
 * Props-Schnittstelle zu App.tsx.
 *
 * Pattern:
 *   - App.tsx wrappt den Workspace-Bereich in `<WorkspaceProvider value={...}>`
 *   - Panel-Komponenten rufen `useWorkspaceContext()` auf und ziehen sich
 *     was sie brauchen.
 *
 * Phase-MIG-2B Scope: nur die Felder die für Mixer-tab gebraucht werden
 * (dm, mixer, project). Weitere Felder kommen mit MIG-2C dazu.
 */
import { createContext, useContext, type ReactNode } from "react";
import type { DrumMachineState, DrumMachineActions } from "@/store/useDrumMachineStore";
import type { MixerState, MixerActions } from "@/store/useMixerStore";
import type { ProjectState, ProjectActions } from "@/store/useProjectStore";

export interface WorkspaceContextValue {
  dm: DrumMachineState & DrumMachineActions;
  mixer: MixerState & MixerActions;
  project: ProjectState & ProjectActions;
  /** Optional collab-bridged callbacks (Sequencer braucht sie). */
  onPlayStop?: () => void;
  onBpmChange?: (bpm: number) => void;
  /**
   * MIG-2C: Render-Funktionen für komplexere Tab-Inhalte die zu eng an App.tsx
   * gekoppelt sind um sie sauber zu extrahieren (inline-useMemo-Components,
   * Sub-Tab-State etc.). Panel-Wrapper rufen einfach diese Funktionen auf.
   *
   * Verwendet wenn der Tab-Inhalt:
   *  - inline in App.tsx definiert ist (z.B. SongTabView via useMemo)
   *  - viele closures aus App-Scope braucht
   *  - intern useState mit komplexem Sub-Tab-Workflow hat (Tools-Tab)
   */
  renderSongPanel?: () => ReactNode;
  renderHumanizerPanel?: () => ReactNode;
  renderToolsPanel?: () => ReactNode;
  renderCollabPanel?: () => ReactNode;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
  value,
  children,
}: {
  value: WorkspaceContextValue;
  children: ReactNode;
}) {
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/**
 * Liefert den aktuellen WorkspaceContext. Wirft wenn außerhalb eines Providers
 * gerendert — das wäre ein Build-Fehler (Panel ohne Provider gemountet).
 */
export function useWorkspaceContext(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspaceContext: missing WorkspaceProvider in tree");
  return ctx;
}
