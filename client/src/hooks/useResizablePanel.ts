/**
 * Synthstudio – useResizablePanel
 *
 * Hook für resizierbare Panels mit persistenter Höhe.
 * Gibt Drag-Handler und aktuelle Höhe zurück.
 * Die Höhe wird in localStorage gespeichert.
 */
import { useCallback, useRef, useState } from "react";

interface UseResizablePanelOptions {
  defaultHeight: number;
  minHeight?: number;
  maxHeight?: number;
  storageKey?: string;
  direction?: "up" | "down"; // "up" = Panel wächst nach oben (Bottom-Panels)
}

export function useResizablePanel({
  defaultHeight,
  minHeight = 60,
  maxHeight = 600,
  storageKey,
  direction = "up",
}: UseResizablePanelOptions) {
  const [height, setHeight] = useState<number>(() => {
    if (storageKey) {
      const saved = parseInt(localStorage.getItem(storageKey) ?? "", 10);
      if (!isNaN(saved) && saved >= minHeight && saved <= maxHeight) return saved;
    }
    return defaultHeight;
  });

  const startYRef   = useRef(0);
  const startHRef   = useRef(0);
  const isDragging  = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current  = true;
    startYRef.current   = e.clientY;
    startHRef.current   = height;

    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const delta  = direction === "up"
        ? startYRef.current - ev.clientY   // Panel wächst wenn Maus nach oben
        : ev.clientY - startYRef.current;  // Panel wächst wenn Maus nach unten
      const next = Math.max(minHeight, Math.min(maxHeight, startHRef.current + delta));
      setHeight(next);
    };

    const onUp = () => {
      isDragging.current = false;
      if (storageKey) {
        localStorage.setItem(storageKey, String(startHRef.current));
      }
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [height, direction, minHeight, maxHeight, storageKey]);

  return { height, handleMouseDown };
}
