/**
 * SequencerPanel — Dockview-Panel-Wrapper für DrumMachine (post-v1.36.0 MIG-2C).
 */
import type { IDockviewPanelProps } from "dockview-react";
import { DrumMachine } from "@/components/DrumMachine/DrumMachine";
import { useWorkspaceContext } from "../WorkspaceContext";

export function SequencerPanel(_props: IDockviewPanelProps) {
  void _props;
  const { dm, project, onPlayStop, onBpmChange } = useWorkspaceContext();
  return (
    <DrumMachine
      dm={dm}
      samples={project.samples}
      isPlaying={project.isPlaying}
      bpm={project.bpm}
      onPlayStop={onPlayStop ?? project.togglePlayStop}
      onBpmChange={onBpmChange ?? project.setBpm}
      className="h-full"
    />
  );
}
