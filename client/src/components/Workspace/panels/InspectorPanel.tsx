/**
 * InspectorPanel — Dockview-Panel-Wrapper für den ChannelInspector
 * (post-v1.35.0 MIG-2B).
 */
import type { IDockviewPanelProps } from "dockview-react";
import { ChannelInspector } from "@/components/Mixer/ChannelInspector";
import { useWorkspaceContext } from "../WorkspaceContext";

export function InspectorPanel(_props: IDockviewPanelProps) {
  void _props;
  const { dm, mixer } = useWorkspaceContext();
  const pattern = dm.getActivePattern();
  const selectedPart =
    pattern?.parts.find((p) => p.id === mixer.selectedChannelId) ?? pattern?.parts[0];
  return (
    <ChannelInspector
      part={selectedPart}
      parts={pattern?.parts ?? []}
      mixer={mixer}
      className="h-full w-full"
      onApplyPatch={dm.applyPatchToPart}
    />
  );
}
