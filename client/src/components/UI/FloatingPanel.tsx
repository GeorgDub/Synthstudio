/**
 * Synthstudio – FloatingPanel (v2.46)
 *
 * Wrapper für ein freischwebendes Panel im Main-Window. Drag-Header,
 * close-Button, optionales „Always on Top"-Pin (CSS-only via z-Index).
 * Position + Größe + Pinned-State werden in localStorage gespeichert
 * (key vom Caller mitgegeben).
 *
 * Bewusst kein separates Electron-Window — der Use-Case ist „User will
 * den Inspector neben dem Edit-Bereich sehen, nicht im Side-Panel
 * eingesperrt". Wer ein echtes separates OS-Fenster will kann später
 * über die Multi-Window-Architektur (PerformancePopupApp / MixerPopupApp)
 * upgraden — die State-Layer ist identisch.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";

export interface FloatingPanelPosition {
  x: number;
  y: number;
  w: number;
  h: number;
  pinned: boolean;
}

export interface FloatingPanelProps {
  /** Eindeutiger Key für localStorage-Persistenz (z.B. "ss-floating:inspector"). */
  storageKey: string;
  /** Anzeige-Titel in der Drag-Bar. */
  title: string;
  /** Initial-Position falls noch nichts gespeichert wurde. */
  defaultPosition?: Partial<FloatingPanelPosition>;
  /** Wird beim Klick auf Close aufgerufen — Eltern entfernen die Komponente. */
  onClose: () => void;
  /** Min. Breite/Höhe für Resize. */
  minWidth?: number;
  minHeight?: number;
  /** Kinder werden im Body gerendert. */
  children: React.ReactNode;
  /** Optional: Test-Helper. */
  testId?: string;
}

const FALLBACK_DEFAULT: FloatingPanelPosition = {
  x: 120,
  y: 120,
  w: 360,
  h: 480,
  pinned: false,
};

/**
 * v2.53: helpers exportiert für Direct-Unit-Tests (waren bis dahin nur
 * intern via Component-Mount erreichbar).
 */
export function loadPosition(key: string, fallback: FloatingPanelPosition): FloatingPanelPosition {
  try {
    if (typeof localStorage === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<FloatingPanelPosition>;
    if (!parsed || typeof parsed !== "object") return fallback;
    return {
      x: typeof parsed.x === "number" ? parsed.x : fallback.x,
      y: typeof parsed.y === "number" ? parsed.y : fallback.y,
      w: typeof parsed.w === "number" ? parsed.w : fallback.w,
      h: typeof parsed.h === "number" ? parsed.h : fallback.h,
      pinned: typeof parsed.pinned === "boolean" ? parsed.pinned : fallback.pinned,
    };
  } catch {
    return fallback;
  }
}

export function persistPosition(key: string, pos: FloatingPanelPosition): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(pos));
  } catch { /* ignore quota */ }
}

/**
 * Hält die Position im sichtbaren Viewport (mindestens Header sichtbar).
 * v2.53: optional viewport-Args (vw/vh) damit Tests ohne window auskommen.
 */
export function clampToViewport(
  pos: FloatingPanelPosition,
  viewport?: { vw: number; vh: number },
): FloatingPanelPosition {
  const vw = viewport?.vw ?? (typeof window !== "undefined" ? window.innerWidth  : 0);
  const vh = viewport?.vh ?? (typeof window !== "undefined" ? window.innerHeight : 0);
  if (vw === 0 || vh === 0) return pos;
  return {
    ...pos,
    x: Math.max(-pos.w + 80, Math.min(vw - 80, pos.x)),
    y: Math.max(0, Math.min(vh - 32, pos.y)),
  };
}

export function FloatingPanel({
  storageKey,
  title,
  defaultPosition,
  onClose,
  minWidth = 220,
  minHeight = 200,
  children,
  testId,
}: FloatingPanelProps) {
  const fallback: FloatingPanelPosition = { ...FALLBACK_DEFAULT, ...defaultPosition };
  const [pos, setPos] = useState<FloatingPanelPosition>(() =>
    clampToViewport(loadPosition(storageKey, fallback)),
  );
  const dragState = useRef<{ kind: "move" | "resize"; offX: number; offY: number; startW: number; startH: number; startX: number; startY: number } | null>(null);

  // Persistenz bei jedem State-Update
  useEffect(() => {
    persistPosition(storageKey, pos);
  }, [storageKey, pos]);

  const onPointerDownHeader = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-floating-no-drag]")) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = {
      kind: "move",
      offX: e.clientX - pos.x,
      offY: e.clientY - pos.y,
      startW: pos.w,
      startH: pos.h,
      startX: pos.x,
      startY: pos.y,
    };
  }, [pos]);

  const onPointerDownResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = {
      kind: "resize",
      offX: e.clientX,
      offY: e.clientY,
      startW: pos.w,
      startH: pos.h,
      startX: pos.x,
      startY: pos.y,
    };
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragState.current;
    if (!d) return;
    if (d.kind === "move") {
      setPos((p) => clampToViewport({ ...p, x: e.clientX - d.offX, y: e.clientY - d.offY }));
    } else {
      setPos((p) => ({
        ...p,
        w: Math.max(minWidth, d.startW + (e.clientX - d.offX)),
        h: Math.max(minHeight, d.startH + (e.clientY - d.offY)),
      }));
    }
  }, [minWidth, minHeight]);

  const onPointerUp = useCallback(() => {
    dragState.current = null;
  }, []);

  const togglePinned = useCallback(() => {
    setPos((p) => ({ ...p, pinned: !p.pinned }));
  }, []);

  return (
    <div
      data-testid={testId ?? "floating-panel"}
      role="dialog"
      aria-label={title}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width: pos.w,
        height: pos.h,
        zIndex: pos.pinned ? 1000 : 200,
      }}
      className="rounded border border-border-color bg-bg-panel shadow-xl flex flex-col overflow-hidden"
    >
      {/* Drag-Header */}
      <div
        onPointerDown={onPointerDownHeader}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="flex items-center gap-2 px-2 py-1.5 bg-bg-elevated border-b border-border-color cursor-move select-none flex-shrink-0"
      >
        <span className="text-xs font-bold text-text-primary truncate flex-1">{title}</span>
        <button
          data-floating-no-drag
          onClick={togglePinned}
          aria-pressed={pos.pinned}
          title={pos.pinned ? "Pin lösen" : "Über andere Panels pinnen"}
          className={[
            "w-6 h-5 rounded text-[10px] font-bold transition-colors",
            pos.pinned
              ? "bg-accent-secondary text-bg-base"
              : "bg-bg-panel text-text-dim hover:text-accent-secondary",
          ].join(" ")}
        >
          ⌘
        </button>
        <button
          data-floating-no-drag
          onClick={onClose}
          aria-label="Schließen"
          title="Schließen"
          className="w-6 h-5 rounded text-xs font-bold bg-bg-panel text-text-dim hover:bg-accent-danger hover:text-white transition-colors"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">{children}</div>

      {/* Resize-Handle bottom-right */}
      <div
        onPointerDown={onPointerDownResize}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        title="Größe anpassen"
        aria-label="Größe anpassen"
        style={{
          position: "absolute",
          right: 0,
          bottom: 0,
          width: 12,
          height: 12,
          cursor: "nwse-resize",
        }}
        className="bg-transparent hover:bg-accent-secondary/30"
        data-floating-no-drag
      />
    </div>
  );
}
