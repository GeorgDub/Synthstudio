/**
 * MixerPanel — Dockview-Panel-Wrapper für die MixerView (post-v1.35.0 MIG-2B).
 *
 * Reads app-state aus dem WorkspaceContext und gibt es an die existierende
 * MixerView weiter. Die Channel-Strip-UX bleibt unverändert; nur das Hosting-
 * Layout wechselt von "Tab in einer Tab-Bar" zu "Dockview-View die der User
 * frei docken/splitten kann".
 */
import type { IDockviewPanelProps } from "dockview-react";
import { MixerView } from "@/components/Mixer";
import { useWorkspaceContext } from "../WorkspaceContext";

export function MixerPanel(_props: IDockviewPanelProps) {
  void _props;
  const { dm, mixer, project } = useWorkspaceContext();
  return (
    <MixerView
      dm={dm}
      mixer={mixer}
      samples={project.samples}
      bpm={project.bpm}
      projectName={project.projectName}
      className="h-full"
    />
  );
}
