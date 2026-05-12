/**
 * Synthstudio – ResizablePanelHandle
 *
 * Drag-Handle für resizierbare Panels.
 * Wird oben auf einem Panel platziert (direction="up" = Panel wächst nach oben).
 */
import React from "react";

interface ResizablePanelHandleProps {
  onMouseDown: (e: React.MouseEvent) => void;
  direction?: "up" | "down";
  className?: string;
}

export function ResizablePanelHandle({
  onMouseDown,
  direction = "up",
  className = "",
}: ResizablePanelHandleProps) {
  return (
    <div
      onMouseDown={onMouseDown}
      className={`flex-shrink-0 flex items-center justify-center cursor-row-resize select-none transition-colors hover:bg-accent-primary/20 group ${className}`}
      style={{ height: 8 }}
      title="Ziehen zum Vergrößern/Verkleinern"
      aria-label="Panel-Größe ändern"
    >
      {/* Visueller Indikator */}
      <div
        className="rounded-full bg-border-color group-hover:bg-accent-primary transition-colors"
        style={{ width: 32, height: 3 }}
      />
    </div>
  );
}
