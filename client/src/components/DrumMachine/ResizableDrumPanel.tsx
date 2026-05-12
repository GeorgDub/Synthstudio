/**
 * Synthstudio – ResizableDrumPanel
 *
 * Resizable Panel-Wrapper für die DrumMachine-Sub-Panels (NoteRepeat, Morph, Macros, etc.).
 * Aus DrumMachine.tsx ausgelagert.
 */
import React, { useEffect } from "react";
import { X } from "lucide-react";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import { ResizablePanelHandle } from "@/components/UI/ResizablePanelHandle";

export interface ResizableDrumPanelProps {
  children: React.ReactNode;
  storageKey: string;
  defaultHeight: number;
  minHeight?: number;
  maxHeight?: number;
  /** Optionaler Close-Callback → zeigt × Button + ESC-Key-Handler */
  onClose?: () => void;
  /** Optionaler Title für die Header-Zeile */
  title?: string;
}

export function ResizableDrumPanel({
  children, storageKey, defaultHeight, minHeight, maxHeight, onClose, title,
}: ResizableDrumPanelProps) {
  const { height, handleMouseDown } = useResizablePanel({
    defaultHeight, minHeight, maxHeight, storageKey, direction: "up",
  });

  // ESC-Key schließt das Panel
  useEffect(() => {
    if (!onClose) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const showHeader = onClose || title;

  return (
    <div className="flex-shrink-0 bg-bg-panel border-b border-border-color flex flex-col overflow-hidden" style={{ height }}>
      <ResizablePanelHandle onMouseDown={handleMouseDown} direction="up" />
      {showHeader && (
        <div className="flex items-center justify-between px-3 py-1 border-b border-border-color/50 bg-bg-elevated/30">
          {title && (
            <span className="text-[10px] font-bold text-text-dim uppercase tracking-widest">{title}</span>
          )}
          {onClose && (
            <button
              onClick={onClose}
              title="Schließen (ESC)"
              aria-label="Close"
              className="ml-auto text-text-muted hover:text-text-primary leading-none px-1 flex items-center justify-center transition-colors"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {children}
      </div>
    </div>
  );
}
