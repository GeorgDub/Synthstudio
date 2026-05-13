/**
 * PatternLaunchPad.tsx – Vollbild Performance Mode View (v1.20.0+ / v1.21.0 a11y / v1.22.0 themed pads / v1.22.0 box-select)
 *
 * Drei Aktions-Modi (toggle oben):
 *   ▶ Play    (default) — Click triggert Pattern (queuePattern)
 *   ✎ Edit              — Click öffnet Inline-Editor (Rename, Color, Pattern, Remove)
 *   ⇆ Reorder           — Drag-and-Drop ODER Keyboard ODER Shift/Ctrl+Click Multi-Select
 *                         ODER Mouse-Box-Rubber-Band-Selection (TASK-120)
 *
 * v1.21.0 (TASK-114) – a11y + Multi-Select:
 *   • WAI-ARIA Roving-Tabindex Grid (role=grid + role=gridcell)
 *   • Pfeiltasten navigieren den Fokus innerhalb des 4×4 Grids
 *   • Space/Enter im Reorder-Mode "greift" den fokussierten Pad
 *     (ARIA-Live announce). Pfeiltasten verschieben dann das gegriffene
 *     Pad in der jeweiligen Richtung (Insert-Semantik mit Wrap am Rand).
 *     Space/Enter dropt, Escape bricht ab.
 *   • Shift+Click und Ctrl/Cmd+Click im Reorder-Mode → Multi-Select
 *     (runtime-only, NICHT persistiert). Drag eines selected-Pads zieht
 *     alle mit (moveMultiplePads → Insert-Semantik).
 *
 * v1.22.0 (TASK-119) – Theme-aware Pad-Default-Farben:
 *   • Default-Pad-Color wird zur Laufzeit aus --ss-pad-1..8 gelesen
 *     (mod-loop für 16 Slots: index → slot = (index % 8) + 1).
 *   • User-definierte pad.color hat WEITER Vorrang (hardcoded hex bleibt erhalten).
 *   • PAD_COLOR_FALLBACKS-Array bleibt als reiner SSR/getComputedStyle-Fallback-Safety-Net,
 *     falls die CSS-Variablen nicht resolvieren (z.B. JSDOM-Tests, frühe Mounts).
 *
 * v1.22.0 (TASK-120) – Mouse-Box Rubber-Band-Selection (Reorder-Mode):
 *   • mousedown auf Grid-Background (nicht auf Pad) startet Box-Drag
 *   • mousemove zeichnet semi-transparente Box-Overlay
 *   • mouseup wählt alle Pads, deren BoundingBox mit der Box-Selection überlappt
 *   • Ohne Shift: replace selection. Mit Shift: additiv.
 *   • Klick ohne Move bei aktiver Selection → clear selection (UX-Konvention).
 *
 * v1.22.0 (TASK-123) – Multi-Drag-Image mit Counter-Badge:
 *   • Bei multiSelect.size > 1 und dragSrc ∈ multiSelect: programmatisch
 *     Canvas (60×60px) mit Pad-Color + "+N"-Badge als setDragImage().
 *   • Fallback (Single-Drag): Browser-Default-Image.
 *   • data-multi-drag-count auf dragSrc-Pad exposed für E2E-Tests.
 *
 * Pads + quantizeMode kommen aus dem persistierten Store. `active` (open/close)
 * + Mode/Focus/Grab/Multi-Select/Box-Selection-State leben lokal in dieser Komponente.
 *
 * Theming: nur semantische --ss-* Tokens — auch die Default-Pad-Palette folgt
 * jetzt dem aktiven Theme.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Pencil, ArrowLeftRight, X, Plus, Trash2 } from "lucide-react";
import {
  setPadAt,
  setPadColor,
  setPadLabel,
  movePad,
  moveMultiplePads,
  clearPad,
  PAD_COUNT,
  PAD_COLOR_VAR_NAMES,
  type PerformancePad,
  type QuantizeMode,
} from "@/store/usePerformanceStore";

type Mode = "play" | "edit" | "reorder";

const GRID_COLS = 4;
const GRID_ROWS = PAD_COUNT / GRID_COLS;

interface PatternRef {
  id: string;
  name: string;
}

/**
 * Performance-Store-Actions die PatternLaunchPad zum Verändern der Pads
 * aufruft. Optional injectable — Default ist die direkte Verwendung der
 * Module-Funktionen aus usePerformanceStore (Main-App-Pfad). Im
 * Performance-Popup-Renderer werden diese durch IPC-dispatchende Varianten
 * ersetzt, damit Edit/Reorder-Operationen über den Main-Process zurück in
 * den persistierten Store fließen (ROADMAP Phase 2).
 */
export interface PerformanceStoreActions {
  setPadAt: (index: number, pad: PerformancePad | null) => void;
  setPadColor: (index: number, color: string) => void;
  setPadLabel: (index: number, label: string) => void;
  movePad: (fromIndex: number, toIndex: number) => void;
  moveMultiplePads: (fromIndices: number[], targetIndex: number) => void;
  clearPad: (index: number) => void;
}

interface PatternLaunchPadProps {
  /** Persistierte Slot-Liste (Länge PAD_COUNT, null = leer). */
  pads: Array<PerformancePad | null>;
  /** Alle verfügbaren Patterns aus der DrumMachine. */
  patterns: PatternRef[];
  activePatternId: string;
  queuedPatternId: string | null;
  quantizeMode: QuantizeMode;
  bpm: number;
  currentStep: number;
  onPadClick: (patternId: string) => void;
  onQuantizeModeChange: (mode: QuantizeMode) => void;
  onClose: () => void;
  /**
   * Optional: wenn gesetzt, zeigt der Header einen "In separatem Fenster
   * öffnen"-Button (nur Electron — siehe ROADMAP feature Performance-Mode-
   * Window). Klick öffnet ein zweites BrowserWindow und schließt die Inline-
   * Ansicht. Undefined → Button wird ausgeblendet (z.B. im Popup-Renderer selbst).
   */
  onOpenInWindow?: () => void;
  /**
   * Optional: Store-Action-Overrides für Edit/Reorder-Operationen. Wird im
   * Popup-Renderer mit IPC-dispatchenden Varianten gefüllt; im Main-Renderer
   * undefined gelassen → fallback auf die direkten Modul-Funktionen aus
   * usePerformanceStore. Siehe PerformanceStoreActions-Interface.
   */
  storeActions?: PerformanceStoreActions;
}

/** Default-Store-Actions: direkte Module-Funktionen aus usePerformanceStore. */
const DEFAULT_STORE_ACTIONS: PerformanceStoreActions = {
  setPadAt,
  setPadColor,
  setPadLabel,
  movePad,
  moveMultiplePads,
  clearPad,
};

/**
 * Safety-Net-Fallback-Palette (8 Slots, mod-loop für 16 Pad-Positionen).
 * Wird NUR verwendet wenn getComputedStyle() leer zurückkommt (z.B. SSR,
 * früher Mount vor Theme-Apply, oder JSDOM-Test-Umgebung). Im echten Browser
 * dominieren die --ss-pad-1..8 CSS-Variablen aus dem aktiven Theme.
 *
 * Spiegelt die `dark`-Theme-Werte aus index.css.
 */
const PAD_COLOR_FALLBACKS: readonly string[] = [
  "#22d3ee", "#a78bfa", "#34d399", "#f87171",
  "#fb923c", "#facc15", "#60a5fa", "#e879f9",
];

/**
 * Liefert die theme-aware Default-Farbe für einen Pad-Slot (16 Slots, 8 Töne, mod-loop).
 *
 * Resolution-Reihenfolge:
 *   1. CSS-Variable --ss-pad-{(index % 8) + 1} aus document.documentElement (live).
 *   2. Statische Fallback-Palette (PAD_COLOR_FALLBACKS) wenn (1) leer/unverfügbar.
 *
 * Funktion ist seiteneffekt-frei und reentrant — kann pro Render-Zyklus aufgerufen werden.
 */
function getPadDefaultColor(index: number): string {
  const slot = ((index % 8) + 8) % 8; // robust gegen negative Indizes
  const fallback = PAD_COLOR_FALLBACKS[slot] ?? "#334155";
  try {
    if (typeof document === "undefined" || !document.documentElement) return fallback;
    const varName = PAD_COLOR_VAR_NAMES[slot] ?? `--ss-pad-${slot + 1}`;
    const resolved = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return resolved || fallback;
  } catch {
    return fallback;
  }
}

const QUANTIZE_MODES: ReadonlyArray<{ mode: QuantizeMode; title: string }> = [
  { mode: "bar",  title: "Quantize auf Bar (4 Beats)" },
  { mode: "beat", title: "Quantize auf Beat" },
  { mode: "step", title: "Quantize auf Step (1/16)" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Axis-aligned bounding box (Selection-Box oder Pad-Rect).
 * Koordinaten in Client-Space (analog DOMRect / clientX/Y).
 */
export interface AxisRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Normalisiert eine Selection-Box mit potenziell negativem dx/dy (Drag nach
 * oben-links) auf eine AxisRect mit non-negativer Breite/Höhe.
 */
export function normalizeBox(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
): AxisRect {
  const x = Math.min(startX, currentX);
  const y = Math.min(startY, currentY);
  const w = Math.abs(currentX - startX);
  const h = Math.abs(currentY - startY);
  return { x, y, w, h };
}

/**
 * Test ob zwei AxisRect-Bereiche sich schneiden (auch nur an einer Kante).
 * Pure function — kein DOM. Direkt unit-testbar.
 *
 * Verwendet halb-offenes Intervall [x, x+w): zwei Rects, deren rechte Kante
 * exakt auf der linken Kante des anderen liegt, schneiden sich NICHT (passt
 * zum DOMRect-Verhalten).
 */
export function boxIntersects(a: AxisRect, b: AxisRect): boolean {
  if (a.w <= 0 || a.h <= 0 || b.w <= 0 || b.h <= 0) return false;
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

/** Liefert die Indizes aller Pads, deren BoundingBox die Selection-Box schneidet. */
export function collectPadsInBox(
  box: AxisRect,
  padRects: ReadonlyArray<AxisRect | null>,
): number[] {
  if (!box || box.w <= 0 || box.h <= 0) return [];
  const result: number[] = [];
  for (let i = 0; i < padRects.length; i++) {
    const r = padRects[i];
    if (!r) continue; // leere Pads (kein DOM oder leerer Slot) überspringen
    if (boxIntersects(box, r)) result.push(i);
  }
  return result;
}

/**
 * Liefert die Indizes aller non-empty Pads (für Cmd/Ctrl+A — TASK-127).
 * Pure Funktion: keine DOM-Abhängigkeit, im Node-Environment testbar.
 */
export function collectNonEmptyPadIndices(
  pads: ReadonlyArray<PerformancePad | null>,
): number[] {
  const result: number[] = [];
  for (let i = 0; i < pads.length; i++) {
    if (pads[i] !== null) result.push(i);
  }
  return result;
}

/**
 * Auto-Scroll-Geschwindigkeit (px/Frame) basierend auf Maus-Abstand zum Viewport-Rand.
 * Linear: 0 px wenn Abstand >= threshold, max 12 px wenn Abstand = 0.
 * Returnt {dx, dy} — beide können negativ (scroll up/left) oder positiv (scroll down/right) sein.
 *
 * Pure Funktion: in Node testbar (kein window-Zugriff).
 *
 * @param mouseX     Aktuelle Maus-X-Position (clientX).
 * @param mouseY     Aktuelle Maus-Y-Position (clientY).
 * @param viewportW  window.innerWidth.
 * @param viewportH  window.innerHeight.
 * @param threshold  Edge-Threshold in Pixeln (Default 40).
 * @param maxSpeed   Maximale Scroll-Geschwindigkeit in Pixeln/Frame (Default 12).
 */
export function computeAutoScrollDelta(
  mouseX: number,
  mouseY: number,
  viewportW: number,
  viewportH: number,
  threshold = 40,
  maxSpeed = 12,
): { dx: number; dy: number } {
  let dx = 0;
  let dy = 0;
  if (mouseX < threshold) dx = -Math.round(((threshold - mouseX) / threshold) * maxSpeed);
  else if (mouseX > viewportW - threshold) dx = Math.round(((mouseX - (viewportW - threshold)) / threshold) * maxSpeed);
  if (mouseY < threshold) dy = -Math.round(((threshold - mouseY) / threshold) * maxSpeed);
  else if (mouseY > viewportH - threshold) dy = Math.round(((mouseY - (viewportH - threshold)) / threshold) * maxSpeed);
  return { dx, dy };
}

/**
 * Erzeugt ein 60×60px Canvas mit der Pad-Color als Hintergrund + accent-secondary
 * Border + "+N" Badge mittig. Wird als HTML5-Drag-Image bei Multi-Select-Drag
 * (TASK-123) via dataTransfer.setDragImage() genutzt.
 *
 * @param padColor Hex-Color des dragSrc-Pads (z.B. "#22d3ee").
 * @param totalCount Gesamtzahl der gleichzeitig gedragten Pads (>=2).
 */
function createMultiDragCanvas(padColor: string, totalCount: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 60;
  canvas.height = 60;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas; // sehr defensiv — sollte nie passieren

  // Pad-Color Background
  ctx.fillStyle = padColor;
  ctx.fillRect(0, 0, 60, 60);

  // Accent-Secondary Border (resolved live aus aktivem Theme)
  let accentSecondary = "";
  try {
    accentSecondary = getComputedStyle(document.documentElement)
      .getPropertyValue("--ss-accent-secondary")
      .trim();
  } catch { /* JSDOM safety */ }
  ctx.strokeStyle = accentSecondary || "#ff00ff";
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, 57, 57);

  // "+N" Badge zentral (N = Gesamtzahl minus 1 = Anzahl zusätzlicher Pads)
  // "+2" liest sich intuitiver als "3 Pads" (1 wird gezeigt + 2 weitere).
  ctx.fillStyle = "white";
  ctx.font = "bold 20px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`+${totalCount - 1}`, 30, 32);
  return canvas;
}

/** Clamp Index in das Grid + Wrap pro Richtung. */
function moveFocus(current: number, key: string): number {
  const row = Math.floor(current / GRID_COLS);
  const col = current % GRID_COLS;
  switch (key) {
    case "ArrowLeft":  return row * GRID_COLS + Math.max(0, col - 1);
    case "ArrowRight": return row * GRID_COLS + Math.min(GRID_COLS - 1, col + 1);
    case "ArrowUp":    return Math.max(0, row - 1) * GRID_COLS + col;
    case "ArrowDown":  return Math.min(GRID_ROWS - 1, row + 1) * GRID_COLS + col;
    case "Home":       return 0;
    case "End":        return PAD_COUNT - 1;
    default:           return current;
  }
}

export function PatternLaunchPad({
  pads,
  patterns,
  activePatternId,
  queuedPatternId,
  quantizeMode,
  bpm,
  currentStep,
  onPadClick,
  onQuantizeModeChange,
  onClose,
  onOpenInWindow,
  storeActions,
}: PatternLaunchPadProps) {
  // Effective store actions: caller-injected overrides ODER Module-Defaults.
  // useMemo damit Identität stabil bleibt (vermeidet unnötige re-renders in
  // dependents wie restoreSnapshot useCallback).
  const actions = useMemo<PerformanceStoreActions>(
    () => storeActions ?? DEFAULT_STORE_ACTIONS,
    [storeActions],
  );
  const [mode, setMode] = useState<Mode>("play");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [dragSrc, setDragSrc] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // a11y: Roving Tabindex – welcher Pad ist gerade tab-fokussierbar?
  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  // a11y: Welcher Pad ist "gegriffen" (Keyboard-Reorder)?
  const [grabbedIndex, setGrabbedIndex] = useState<number | null>(null);
  // a11y: Snapshot vor dem Grab — für Escape-Restore
  const grabbedSnapshotRef = useRef<Array<PerformancePad | null> | null>(null);
  // a11y: Live-Region-Announcement-Text
  const [liveMessage, setLiveMessage] = useState<string>("");

  // Multi-Select (runtime-only, NICHT persistiert)
  const [multiSelect, setMultiSelect] = useState<Set<number>>(new Set());

  // Box-Selection (TASK-120) – runtime-only, NICHT persistiert
  interface SelectionBox {
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    /** Wurde additiv (mit Shift) gestartet? */
    additive: boolean;
    /** Auswahl-Snapshot beim Start (für additive-Mode: alte Auswahl beibehalten + neue dazu). */
    initialSelection: ReadonlySet<number>;
    /** Hat sich die Maus seit mousedown bewegt? */
    moved: boolean;
  }
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);

  const gridRef = useRef<HTMLDivElement | null>(null);

  // Wenn der focused-Pad in den DOM rendert, ihn fokussieren
  const padRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    const el = padRefs.current[focusedIndex];
    if (el && document.activeElement !== el) {
      // Nicht stehlen, wenn z.B. ein Input im Editor offen ist
      const ae = document.activeElement;
      const inEditor = ae && ae.closest && ae.closest("[data-testid='perf-pad-editor']");
      if (!inEditor) el.focus({ preventScroll: true });
    }
  }, [focusedIndex]);

  // ESC: schließt Editor → cancel Grab → schließt Performance Mode (Eskalation)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (editingIndex !== null) {
        setEditingIndex(null);
        e.stopPropagation();
        return;
      }
      if (selectionBox !== null) {
        // Abort active Box-Drag (TASK-120): clear box overlay, keep
        // pre-existing multiSelect unchanged.
        setSelectionBox(null);
        e.stopPropagation();
        return;
      }
      if (grabbedIndex !== null) {
        // Restore Snapshot
        if (grabbedSnapshotRef.current) {
          // setPads würde notify+persist auslösen; nur wenn sich tatsächlich was geändert hat
          // Vergleich: hat sich pads-Array seit dem Grab geändert?
          // Einfacher Ansatz: bulk-replace mit dem Snapshot.
          // Wir importieren setPads NICHT separat hier — wir nutzen das via Side-Channel:
          //   schicke das gesamte Snapshot-Array zurück durch setPadAt-Schleife.
          // Aber setPadAt(_, null) clobbert + notify. Wir machen es via setPads:
          // siehe Restore-Logik unten.
          restoreSnapshot(grabbedSnapshotRef.current);
        }
        setGrabbedIndex(null);
        grabbedSnapshotRef.current = null;
        setLiveMessage("Verschieben abgebrochen.");
        e.stopPropagation();
        return;
      }
      if (mode === "reorder" && multiSelect.size > 0) {
        // Escape clears Multi-Select (TASK-120 spec)
        setMultiSelect(new Set());
        e.stopPropagation();
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, editingIndex, grabbedIndex, selectionBox, mode, multiSelect.size]);

  // Cmd/Ctrl+A im Reorder-Mode: selektiert alle non-empty Pads (TASK-127a).
  // Editor offen → kein Hijack (Inputs sollen ihre native Select-All-Behavior behalten).
  useEffect(() => {
    if (mode !== "reorder") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "a" && e.key !== "A") return;
      if (!(e.metaKey || e.ctrlKey)) return;
      if (editingIndex !== null) return; // Editor offen → Input behält native Cmd+A
      e.preventDefault();
      e.stopPropagation();
      const indices = collectNonEmptyPadIndices(pads);
      if (indices.length === 0) return; // nichts zu selektieren
      setMultiSelect(new Set(indices));
      setLiveMessage(`${indices.length} Pads ausgewählt.`);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mode, editingIndex, pads]);

  // Beim Modus-Wechsel: Editor schließen, Drag-State leeren, Multi-Select leeren, Grab cancelen
  useEffect(() => {
    setEditingIndex(null);
    setDragSrc(null);
    setDragOver(null);
    setMultiSelect(new Set());
    setSelectionBox(null);
    if (grabbedIndex !== null) {
      // Drop-without-restore beim Mode-Wechsel — User-Intention unklar, sicherheitshalber NICHT restore
      // (Wenn der User abbrechen will, drückt er Escape vor dem Mode-Wechsel)
      setGrabbedIndex(null);
      grabbedSnapshotRef.current = null;
      setLiveMessage("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Snapshot-Restore-Helper: nutzt setPadAt im Loop (vermeidet setPads-Import-Cycle)
  // Note: hier kein Multi-Patch in einem Update — `setPadAt` notify-t pro Slot. Das ist akzeptabel
  //       beim Escape-Restore (max 16 Notifications, alles synchron).
  const restoreSnapshot = useCallback((snap: Array<PerformancePad | null>) => {
    for (let i = 0; i < PAD_COUNT; i++) {
      const want = snap[i] ?? null;
      // setPadAt mit null entfernt; mit pad-object setzt neu. Identitäts-Check macht setPadAt nicht,
      // d.h. es wird auch ein notify gefeuert wenn der Wert gleich ist. Akzeptabel für Restore.
      actions.setPadAt(i, want);
    }
  }, []);

  const handlePadActivate = useCallback((index: number) => {
    const pad = pads[index];
    if (mode === "play") {
      if (pad) onPadClick(pad.patternId);
      return;
    }
    if (mode === "edit") {
      // Edit auch auf leerem Slot → öffnet Add-Picker
      setEditingIndex(index);
      return;
    }
    // reorder: handled durch Click-Logik in der Pad-Komponente (Multi-Select / Grab via Click)
  }, [mode, pads, onPadClick]);

  /** Reorder-Mode Click: ohne Modifier → toggle Grab; mit Shift/Ctrl/Meta → Multi-Select-Toggle. */
  const handleReorderClick = useCallback((index: number, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
    if (mode !== "reorder") return;
    const pad = pads[index];
    if (!pad) return; // leere Slots nicht selektierbar

    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      setMultiSelect(prev => {
        const next = new Set(prev);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });
      return;
    }

    // Normaler Click → toggle Grab (Keyboard-Reorder ohne Maus-Drag)
    if (grabbedIndex === index) {
      // Drop on self → no-op (cancel Grab)
      setGrabbedIndex(null);
      grabbedSnapshotRef.current = null;
      setLiveMessage(`Pad ${index + 1} losgelassen.`);
    } else if (grabbedIndex !== null) {
      // Drop grabbed → target index (Insert-Semantik via moveMultiplePads(single))
      actions.moveMultiplePads([grabbedIndex], index);
      setLiveMessage(`Pad an Position ${index + 1} abgelegt.`);
      setGrabbedIndex(null);
      grabbedSnapshotRef.current = null;
    } else {
      // Grab
      grabbedSnapshotRef.current = pads.slice();
      setGrabbedIndex(index);
      setLiveMessage(`Pad ${index + 1} gegriffen. Pfeiltasten zum Verschieben, Leertaste zum Ablegen, Escape zum Abbrechen.`);
    }
  }, [mode, pads, grabbedIndex]);

  // ─── HTML5 Drag&Drop ───────────────────────────────────────────────────────

  const handleDragStart = useCallback((index: number, e: React.DragEvent<HTMLButtonElement>) => {
    if (mode !== "reorder") return;
    setDragSrc(index);

    // Multi-Drag-Image (TASK-123): wenn der gezogene Pad Teil eines
    // Multi-Selects mit >1 Element ist, setze ein Custom-Canvas-Drag-Image
    // mit Pad-Color + "+N"-Badge. Andernfalls Browser-Default.
    if (multiSelect.has(index) && multiSelect.size > 1) {
      const pad = pads[index];
      const padColor = pad?.color ?? getPadDefaultColor(index);
      try {
        const canvas = createMultiDragCanvas(padColor, multiSelect.size);
        // Cursor liegt in der Bild-Mitte (30/30 von 60×60px)
        e.dataTransfer.setDragImage(canvas, 30, 30);
      } catch {
        // Falls Canvas-API fehlschlägt (sehr alte Browser / JSDOM): Default-Image.
      }
    }
  }, [mode, multiSelect, pads]);

  const handleDragOver = useCallback((index: number, e: React.DragEvent) => {
    if (mode !== "reorder" || dragSrc === null) return;
    e.preventDefault();
    setDragOver(index);
  }, [mode, dragSrc]);

  const handleDrop = useCallback((targetIndex: number) => {
    if (mode !== "reorder" || dragSrc === null) return;
    // Multi-Select-aware Drop:
    //   - Wenn dragSrc Teil des Multi-Selects ist UND mehr als 1 Element → moveMultiplePads
    //   - Sonst klassischer Single-Pad-Swap via movePad (rückwärtskompatibel)
    if (multiSelect.has(dragSrc) && multiSelect.size > 1) {
      const fromIndices = Array.from(multiSelect).sort((a, b) => a - b);
      if (!multiSelect.has(targetIndex)) {
        actions.moveMultiplePads(fromIndices, targetIndex);
        setMultiSelect(new Set()); // Auswahl leeren nach erfolgreichem Move
      }
    } else {
      if (dragSrc !== targetIndex) actions.movePad(dragSrc, targetIndex);
    }
    setDragSrc(null);
    setDragOver(null);
  }, [mode, dragSrc, multiSelect]);

  const handleDragEnd = useCallback(() => {
    setDragSrc(null);
    setDragOver(null);
  }, []);

  // ─── Mouse-Box Rubber-Band-Selection (TASK-120) ───────────────────────────

  /**
   * Liest die Pad-Bounding-Rects aus dem DOM. Liefert null für Pads, die
   * (a) keinen DOM-Knoten haben oder (b) leer sind (kein Pattern-Slot —
   * leere Slots sollen NICHT box-selectable sein).
   */
  const collectCurrentPadRects = useCallback((): Array<AxisRect | null> => {
    const result: Array<AxisRect | null> = [];
    for (let i = 0; i < PAD_COUNT; i++) {
      const pad = pads[i];
      if (!pad) { result.push(null); continue; }
      const el = padRefs.current[i] ?? document.querySelector(`[data-pad-index="${i}"]`) as HTMLElement | null;
      if (!el) { result.push(null); continue; }
      const r = el.getBoundingClientRect();
      result.push({ x: r.left, y: r.top, w: r.width, h: r.height });
    }
    return result;
  }, [pads]);

  // mousedown auf Grid-Background: starte Box-Select (nur Reorder-Mode).
  const handleGridMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (mode !== "reorder") return;
    // Nur linke Maustaste
    if (e.button !== 0) return;
    // Nur wenn target NICHT ein Pad (oder ein Kind eines Pads) ist.
    // Pad-Buttons haben role="gridcell" + data-testid="perf-pad-N".
    const target = e.target as HTMLElement | null;
    if (target && target.closest("[data-pad-index]")) return;
    // Editor offen → kein Box-Drag
    if (editingIndex !== null) return;
    e.preventDefault();
    setSelectionBox({
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
      additive: e.shiftKey,
      initialSelection: new Set(multiSelect),
      moved: false,
    });
  }, [mode, editingIndex, multiSelect]);

  // Window-mousemove: aktualisiere Selection-Box (nur wenn aktiv).
  // TASK-127b: zusätzlich Auto-Scroll via requestAnimationFrame, wenn die Maus
  // nahe am Viewport-Rand ist (< 40px). Pad-Rects (getBoundingClientRect) sind
  // viewport-relativ, scrollen ändert sie automatisch beim nächsten mousemove.
  useEffect(() => {
    if (!selectionBox) return;
    // RAF-Loop-State: letzte bekannte Maus-Pos + rafId
    let mouseX = selectionBox.currentX;
    let mouseY = selectionBox.currentY;
    let rafId: number | null = null;

    const tick = () => {
      const { dx, dy } = computeAutoScrollDelta(mouseX, mouseY, window.innerWidth, window.innerHeight);
      if (dx !== 0 || dy !== 0) {
        window.scrollBy(dx, dy);
      }
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);

    const onMove = (ev: MouseEvent) => {
      mouseX = ev.clientX;
      mouseY = ev.clientY;
      setSelectionBox(prev => {
        if (!prev) return prev;
        const dx = ev.clientX - prev.startX;
        const dy = ev.clientY - prev.startY;
        const moved = prev.moved || Math.abs(dx) > 3 || Math.abs(dy) > 3;
        return { ...prev, currentX: ev.clientX, currentY: ev.clientY, moved };
      });
    };
    const onUp = () => {
      // Finalize via setState-Closure: lese aktuelle Box + Pad-Rects
      setSelectionBox(prev => {
        if (!prev) return null;
        if (!prev.moved) {
          // Klick ohne Move: bei aktiver Selection → clear (UX-Konvention),
          // sonst no-op. Keine eigene Selection wenn Shift gedrückt (additiv
          // ohne move = nichts tun).
          if (!prev.additive) {
            // Replace mode + kein move → Selection clearen (Click ins Leere).
            if (multiSelect.size > 0) setMultiSelect(new Set());
          }
          return null;
        }
        const box = normalizeBox(prev.startX, prev.startY, prev.currentX, prev.currentY);
        const padRects = collectCurrentPadRects();
        const hits = collectPadsInBox(box, padRects);
        if (prev.additive) {
          const next = new Set(prev.initialSelection);
          for (const i of hits) next.add(i);
          setMultiSelect(next);
        } else {
          setMultiSelect(new Set(hits));
        }
        return null;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [selectionBox, multiSelect.size, collectCurrentPadRects]);

  // ─── Keyboard-Grid-Handler (auf Container, NICHT pro Pad) ─────────────────

  const handleGridKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // Editor offen? Dann sollen die Inputs ihre Eingaben behalten.
    if (editingIndex !== null) return;

    const key = e.key;

    // Pfeiltasten: Navigation ODER (wenn grabbed) Verschiebung
    if (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown" || key === "Home" || key === "End") {
      e.preventDefault();
      if (grabbedIndex !== null) {
        // Verschiebe das gegriffene Pad
        const target = moveFocus(grabbedIndex, key);
        if (target !== grabbedIndex) {
          actions.moveMultiplePads([grabbedIndex], target);
          setGrabbedIndex(target);
          setFocusedIndex(target);
          setLiveMessage(`Pad an Position ${target + 1}.`);
        }
        return;
      }
      const next = moveFocus(focusedIndex, key);
      if (next !== focusedIndex) setFocusedIndex(next);
      return;
    }

    // Space / Enter: aktiviere je nach Modus (Play=trigger / Edit=open editor / Reorder=grab-or-drop)
    if (key === " " || key === "Enter") {
      e.preventDefault();
      const pad = pads[focusedIndex];
      if (mode === "play") {
        if (pad) onPadClick(pad.patternId);
        return;
      }
      if (mode === "edit") {
        setEditingIndex(focusedIndex);
        return;
      }
      // Reorder
      if (grabbedIndex === null) {
        // Grab
        if (!pad) return; // leere Pads nicht greifbar
        grabbedSnapshotRef.current = pads.slice();
        setGrabbedIndex(focusedIndex);
        setLiveMessage(`Pad ${focusedIndex + 1} gegriffen. Pfeiltasten zum Verschieben, Leertaste zum Ablegen, Escape zum Abbrechen.`);
      } else {
        // Drop
        if (grabbedIndex !== focusedIndex) {
          actions.moveMultiplePads([grabbedIndex], focusedIndex);
          setLiveMessage(`Pad an Position ${focusedIndex + 1} abgelegt.`);
        } else {
          setLiveMessage(`Pad ${focusedIndex + 1} losgelassen.`);
        }
        setGrabbedIndex(null);
        grabbedSnapshotRef.current = null;
      }
      return;
    }

    // Tab während grabbed → Focus-Trap (Tab tut nichts, User muss Drop/Cancel)
    if ((key === "Tab") && grabbedIndex !== null) {
      e.preventDefault();
      return;
    }
  }, [editingIndex, grabbedIndex, focusedIndex, mode, pads, onPadClick]);

  // ─── Rendering ─────────────────────────────────────────────────────────────

  const setPadRef = useCallback((index: number) => (el: HTMLButtonElement | null) => {
    padRefs.current[index] = el;
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 bg-bg-base flex flex-col"
      data-testid="performance-mode-overlay"
      // BUG-009 defensive: stelle sicher dass das Performance-Mode-Overlay
      // KEINE Electron-Drag-Region erbt. Falls die TitleBar aus irgendeinem
      // Grund noch sichtbar bleibt (Race-Condition beim Fullscreen-Toggle,
      // alternative Overlays), garantiert no-drag hier dass alle Klicks
      // (insbesondere die Mode-Toggle-Buttons im Header) durchkommen.
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      {/* ARIA Live Region für Screenreader-Announcements (visuell unsichtbar) */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="perf-live-region"
      >
        {liveMessage}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border-color">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-accent-secondary font-bold text-lg tracking-wider">
            PERFORMANCE MODE
          </span>
          <span className="text-text-muted font-mono text-sm">{bpm} BPM</span>

          {/* Mode-Toggle: Play / Edit / Reorder */}
          <div
            role="radiogroup"
            aria-label="Performance Mode Aktion"
            className="flex gap-1 ml-2"
          >
            <ModeButton
              active={mode === "play"}
              onClick={() => setMode("play")}
              icon={<Play size={14} />}
              label="Play"
              title="Play-Modus: Click triggert Pattern"
            />
            <ModeButton
              active={mode === "edit"}
              onClick={() => setMode("edit")}
              icon={<Pencil size={14} />}
              label="Edit"
              title="Edit-Modus: Pad bearbeiten (Name, Farbe, Pattern)"
            />
            <ModeButton
              active={mode === "reorder"}
              onClick={() => setMode("reorder")}
              icon={<ArrowLeftRight size={14} />}
              label="Reorder"
              title="Reorder-Modus: Pads per Drag&Drop, Keyboard oder Shift+Click verschieben"
            />
          </div>

          {/* Quantize Mode */}
          <div className="flex items-center gap-1 ml-2">
            <span className="text-text-dim text-xs uppercase">Quantize:</span>
            {QUANTIZE_MODES.map(({ mode: qm, title }) => {
              const isActive = quantizeMode === qm;
              return (
                <button
                  key={qm}
                  onClick={() => onQuantizeModeChange(qm)}
                  title={title}
                  aria-pressed={isActive}
                  aria-label={title}
                  className={`px-2 py-1 rounded text-xs font-mono uppercase transition-colors active:scale-95 ${
                    isActive
                      ? "bg-accent-primary text-bg-base"
                      : "bg-bg-elevated text-text-muted hover:bg-bg-base hover:text-text-primary"
                  }`}
                >
                  {qm}
                </button>
              );
            })}
          </div>

          {/* Multi-Select-Indikator (nur Reorder-Mode wenn >0 selected) */}
          {mode === "reorder" && multiSelect.size > 0 && (
            <span
              className="text-accent-secondary text-xs font-mono uppercase ml-2"
              data-testid="perf-multiselect-count"
            >
              {multiSelect.size} ausgewählt
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* In separates Fenster öffnen — nur in Electron + nicht im Popup-Renderer selbst */}
          {onOpenInWindow && (
            <button
              onClick={onOpenInWindow}
              aria-label="Performance Mode in separatem Fenster öffnen"
              data-testid="perf-open-in-window"
              className="text-text-dim hover:text-text-primary text-xs flex items-center gap-1 active:scale-95 px-2 py-1 rounded border border-border-color hover:border-accent-secondary"
              title="In separatem Fenster öffnen — Pads parallel zur Haupt-Oberfläche nutzbar"
            >
              ⧉ Separates Fenster
            </button>
          )}

          <button
            onClick={onClose}
            aria-label="Performance Mode schließen"
            className="text-text-dim hover:text-text-primary text-sm flex items-center gap-1 active:scale-95"
            title="Performance Mode schließen (ESC)"
          >
            <span>ESC</span>
            <X size={16} />
          </button>
        </div>
      </div>

      {/* 4×4 Pad Grid (Box-Mouse-Select via onMouseDown auf dem Container)
          BUG-016 Fix: Grid wächst jetzt mit dem Fenster — bleibt quadratisch
          (aspect-square am Inner-Container) und füllt min(width, height) des
          verfügbaren Raums. Kein overflow-auto-Scrollbar mehr. */}
      <div
        className="flex-1 flex items-center justify-center p-4 overflow-hidden select-none min-h-0"
        onMouseDown={handleGridMouseDown}
        data-testid="perf-pad-grid-wrapper"
      >
        <div
          ref={gridRef}
          role="grid"
          aria-label="Performance Pads (4 mal 4)"
          aria-rowcount={GRID_ROWS}
          aria-colcount={GRID_COLS}
          onKeyDown={handleGridKeyDown}
          className="aspect-square h-full max-h-full max-w-full grid grid-cols-4 grid-rows-4 gap-3 outline-none"
          data-testid="perf-pad-grid"
        >
          {Array.from({ length: PAD_COUNT }, (_, i) => {
            const pad = pads[i] ?? null;
            const fallbackColor = getPadDefaultColor(i);
            const row = Math.floor(i / GRID_COLS);
            const col = i % GRID_COLS;
            const isMultiDragSrc =
              dragSrc === i && multiSelect.has(i) && multiSelect.size > 1;
            return (
              <Pad
                key={i}
                ref={setPadRef(i)}
                index={i}
                row={row}
                col={col}
                pad={pad}
                fallbackColor={fallbackColor}
                patterns={patterns}
                mode={mode}
                isActive={!!pad && pad.patternId === activePatternId}
                isQueued={!!pad && pad.patternId === queuedPatternId}
                isDragOver={dragOver === i}
                isDragging={dragSrc === i || (multiSelect.has(i) && dragSrc !== null && multiSelect.has(dragSrc))}
                isFocused={focusedIndex === i}
                isGrabbed={grabbedIndex === i}
                isSelected={multiSelect.has(i)}
                onActivate={() => handlePadActivate(i)}
                onReorderClick={(modifiers) => handleReorderClick(i, modifiers)}
                onDragStart={(e) => handleDragStart(i, e)}
                onDragOver={(e) => handleDragOver(i, e)}
                onDrop={() => handleDrop(i)}
                onDragEnd={handleDragEnd}
                onFocus={() => setFocusedIndex(i)}
                multiDragCount={isMultiDragSrc ? multiSelect.size : 0}
              />
            );
          })}
        </div>
      </div>

      {/* Box-Selection Overlay (TASK-120) — fixed positioning in viewport coords */}
      {selectionBox && selectionBox.moved && (() => {
        const box = normalizeBox(
          selectionBox.startX,
          selectionBox.startY,
          selectionBox.currentX,
          selectionBox.currentY,
        );
        return (
          <div
            aria-hidden="true"
            data-testid="perf-selection-box"
            className="fixed pointer-events-none z-40 border-2 border-dashed border-accent-secondary bg-accent-secondary/10"
            style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
          />
        );
      })()}

      {/* Inline Editor (Edit-Mode) */}
      {mode === "edit" && editingIndex !== null && (
        <PadEditor
          index={editingIndex}
          pad={pads[editingIndex] ?? null}
          patterns={patterns}
          fallbackColor={getPadDefaultColor(editingIndex)}
          actions={actions}
          onClose={() => setEditingIndex(null)}
        />
      )}

      {/* Step-Indikator */}
      <div className="px-6 py-3 border-t border-border-color flex items-center gap-2">
        <span className="text-text-dim text-xs">STEP</span>
        <div className="flex gap-0.5">
          {Array.from({ length: 16 }, (_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === currentStep % 16 ? "bg-accent-secondary" : "bg-border-color"
              }`}
            />
          ))}
        </div>
        <span className="ml-auto text-text-dim text-xs">
          {mode === "play"    && "▶ Play-Modus — Click triggert Pattern"}
          {mode === "edit"    && "✎ Edit-Modus — Click bearbeitet Pad"}
          {mode === "reorder" && (grabbedIndex !== null
            ? "⇆ Reorder-Modus — Pfeiltasten verschieben, Leertaste ablegt, Escape bricht ab"
            : "⇆ Reorder-Modus — Drag, Pfeil+Space, Shift+Click oder Maus-Box für Mehrfach-Auswahl")}
        </span>
      </div>
    </div>
  );
}

// ─── Mode-Toggle Button ─────────────────────────────────────────────────────

interface ModeButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  title: string;
}

function ModeButton({ active, onClick, icon, label, title }: ModeButtonProps) {
  return (
    <button
      onClick={onClick}
      role="radio"
      aria-checked={active}
      aria-label={title}
      title={title}
      className={`px-2 py-1 rounded text-xs font-bold uppercase tracking-wide flex items-center gap-1 transition-colors active:scale-95 ${
        active
          ? "bg-accent-secondary text-bg-base"
          : "bg-bg-elevated text-text-muted hover:bg-bg-base hover:text-text-primary"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ─── Pad ────────────────────────────────────────────────────────────────────

interface PadProps {
  index: number;
  row: number;
  col: number;
  pad: PerformancePad | null;
  fallbackColor: string;
  patterns: PatternRef[];
  mode: Mode;
  isActive: boolean;
  isQueued: boolean;
  isDragOver: boolean;
  isDragging: boolean;
  isFocused: boolean;
  isGrabbed: boolean;
  isSelected: boolean;
  onActivate: () => void;
  onReorderClick: (modifiers: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => void;
  onDragStart: (e: React.DragEvent<HTMLButtonElement>) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
  onFocus: () => void;
  /** Anzahl mit-gedragter Pads (Multi-Drag, TASK-123). 0 wenn kein Multi-Drag aktiv. */
  multiDragCount: number;
}

// React 19: `ref` ist eine normale Prop auf Function Components — kein forwardRef nötig.
interface PadPropsWithRef extends PadProps {
  ref?: (el: HTMLButtonElement | null) => void;
}

function Pad({
  ref,
  index,
  row,
  col,
  pad,
  fallbackColor,
  patterns,
  mode,
  isActive,
  isQueued,
  isDragOver,
  isDragging,
  isFocused,
  isGrabbed,
  isSelected,
  onActivate,
  onReorderClick,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onFocus,
  multiDragCount,
}: PadPropsWithRef) {
  const color = pad?.color ?? fallbackColor;
  const patternFromList = pad ? patterns.find(p => p.id === pad.patternId) : null;
  const displayLabel = pad?.label ?? patternFromList?.name ?? (pad ? `P${index + 1}` : "");

  // In reorder mode every slot (incl. empty) is draggable + drop-target
  const draggable = mode === "reorder";

  const isPlayEnabled  = mode === "play" && !!pad;
  const isEditEnabled  = mode === "edit";
  const isReorderClick = mode === "reorder";
  const clickable      = isPlayEnabled || isEditEnabled || (isReorderClick && !!pad);

  // Visual state
  const showFilled = !!pad;
  const labelText = pad
    ? displayLabel
    : (mode === "edit" ? "+ Hinzufügen" : "");

  const padStyle: React.CSSProperties = {};
  if (showFilled) {
    padStyle.backgroundColor = isActive ? color : `${color}33`;
    padStyle.borderColor = isQueued
      ? color
      : isActive
        ? color
        : "transparent";
    if (isActive) padStyle.boxShadow = `0 0 20px ${color}66`;
  }
  if (isDragOver) padStyle.outline = `2px dashed var(--ss-accent-primary)`;

  // Cursor + opacity
  let extraClass = "";
  if (mode === "reorder") {
    extraClass = "cursor-grab active:cursor-grabbing";
    if (isDragging) extraClass += " opacity-50";
  } else if (clickable) {
    extraClass = "cursor-pointer hover:brightness-125 active:scale-95";
  } else {
    extraClass = "cursor-default";
  }

  if (!showFilled && mode === "play") {
    extraClass += " opacity-30";
  } else if (!showFilled && mode === "edit") {
    extraClass += " opacity-70 hover:opacity-100 border-dashed border-text-dim";
  } else if (!showFilled && mode === "reorder") {
    extraClass += " opacity-30 border-dashed border-text-dim";
  }

  // a11y ring classes
  const ringClass = (() => {
    if (isGrabbed) return "ring-2 ring-offset-2 ring-offset-bg-base ring-accent-primary";
    if (isFocused) return "ring-2 ring-accent-primary";
    if (isSelected) return "ring-2 ring-accent-secondary";
    return "";
  })();

  // Click-Handler: differenziert nach Mode (Reorder hat eigenes Multi-Select-Verhalten)
  const onClickHandler = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (mode === "reorder") {
      if (!pad) return;
      onReorderClick({ shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey });
      return;
    }
    if (clickable) onActivate();
  };

  return (
    <button
      ref={ref}
      type="button"
      role="gridcell"
      tabIndex={isFocused ? 0 : -1}
      aria-rowindex={row + 1}
      aria-colindex={col + 1}
      // aria-grabbed ist in WAI-ARIA 1.1 deprecated. Wir kommunizieren den
      // Grab-Status über aria-label + die Live-Region.
      aria-selected={mode === "reorder" && pad ? isSelected : undefined}
      aria-label={
        pad
          ? `Pad ${index + 1}: ${displayLabel}${isActive ? ", aktiv" : ""}${isQueued ? ", in Queue" : ""}${isGrabbed ? ", gegriffen" : ""}${isSelected ? ", ausgewählt" : ""}`
          : `Pad ${index + 1}, leer`
      }
      data-testid={`perf-pad-${index}`}
      data-pad-index={index}
      data-pad-filled={showFilled ? "1" : "0"}
      data-pad-active={isActive ? "1" : "0"}
      data-pad-queued={isQueued ? "1" : "0"}
      data-pad-focused={isFocused ? "1" : "0"}
      data-pad-grabbed={isGrabbed ? "1" : "0"}
      data-pad-selected={isSelected ? "1" : "0"}
      data-multi-drag-count={multiDragCount > 0 ? String(multiDragCount) : undefined}
      onClick={onClickHandler}
      onFocus={onFocus}
      disabled={mode === "play" && !pad}
      title={
        mode === "play"
          ? (pad ? `Pattern triggern: ${displayLabel}` : "Leer")
          : mode === "edit"
            ? (pad ? `Bearbeiten: ${displayLabel}` : "Pattern hinzufügen")
            : (pad
                ? `${displayLabel} — Click greift, Shift/Ctrl+Click selektiert, Pfeiltasten + Leertaste verschieben`
                : "Leerer Slot")
      }
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragOver={draggable ? onDragOver : undefined}
      onDrop={draggable ? onDrop : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      style={padStyle}
      className={`
        aspect-square rounded-xl text-sm font-bold transition-all duration-100
        border-2 flex items-center justify-center
        ${showFilled ? "" : "bg-bg-panel"}
        ${isQueued ? "animate-pulse" : ""}
        ${ringClass}
        ${extraClass}
      `}
    >
      <div className="text-center px-1">
        <div
          className="text-xs leading-tight truncate"
          style={{
            color: showFilled
              ? (isActive ? "var(--ss-bg-base)" : `${color}cc`)
              : undefined,
          }}
        >
          {labelText}
        </div>
        {mode === "edit" && !pad && (
          <Plus size={14} className="mx-auto mt-1 text-text-muted" />
        )}
      </div>
    </button>
  );
}

// ─── Pad-Editor (Inline-Modal) ──────────────────────────────────────────────

interface PadEditorProps {
  index: number;
  pad: PerformancePad | null;
  patterns: PatternRef[];
  fallbackColor: string;
  /** Store-Actions vom Parent (injizierbar — siehe ROADMAP Phase 2). */
  actions: PerformanceStoreActions;
  onClose: () => void;
}

function PadEditor({ index, pad, patterns, fallbackColor, actions, onClose }: PadEditorProps) {
  const [labelDraft, setLabelDraft] = useState(pad?.label ?? "");
  const [colorDraft, setColorDraft] = useState(pad?.color ?? fallbackColor);
  const [patternDraft, setPatternDraft] = useState(pad?.patternId ?? "");

  // Theme-aware Default-Swatches: 8 Farben aus den aktuell aktiven --ss-pad-1..8 Tokens.
  // Liest live aus document.documentElement bei Mount/index-Wechsel.
  const themedSwatches = useMemo<readonly string[]>(() => {
    return Array.from({ length: 8 }, (_, slot) => getPadDefaultColor(slot));
    // Hängt nur von index ab, weil das Re-Open mit anderem Pad einen neuen
    // Lookup erzwingt. Theme-Wechsel während offenem Editor ist Edge-Case
    // (User würde Editor schließen+öffnen).
  }, [index]);

  useEffect(() => {
    setLabelDraft(pad?.label ?? "");
    setColorDraft(pad?.color ?? fallbackColor);
    setPatternDraft(pad?.patternId ?? "");
  }, [index, pad, fallbackColor]);

  const handleSave = () => {
    if (!patternDraft) return;
    actions.setPadAt(index, {
      patternId: patternDraft,
      color: colorDraft,
      label: labelDraft.trim() || undefined,
    });
    onClose();
  };

  const handleApplyColor = (c: string) => {
    setColorDraft(c);
    if (pad) actions.setPadColor(index, c);
  };

  const handleApplyLabel = (l: string) => {
    setLabelDraft(l);
    if (pad) actions.setPadLabel(index, l);
  };

  const handleRemove = () => {
    actions.clearPad(index);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-bg-base/70 backdrop-blur-sm"
      onClick={onClose}
      data-testid="perf-pad-editor"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[min(420px,90vw)] bg-bg-panel border border-border-color rounded-xl shadow-xl p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-text-primary font-bold text-sm uppercase tracking-wider">
            Pad {index + 1} {pad ? "bearbeiten" : "hinzufügen"}
          </h3>
          <button
            onClick={onClose}
            aria-label="Editor schließen"
            className="text-text-dim hover:text-text-primary active:scale-95"
            title="Schließen (ESC)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Pattern-Auswahl */}
        <label className="block mb-3">
          <span className="block text-xs uppercase text-text-dim mb-1">Pattern</span>
          <select
            value={patternDraft}
            onChange={(e) => setPatternDraft(e.target.value)}
            aria-label="Pattern auswählen"
            className="w-full bg-bg-elevated text-text-primary border border-border-color rounded px-2 py-1.5 text-sm"
          >
            <option value="">— wählen —</option>
            {patterns.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>

        {/* Label */}
        <label className="block mb-3">
          <span className="block text-xs uppercase text-text-dim mb-1">Label</span>
          <input
            type="text"
            value={labelDraft}
            onChange={(e) => handleApplyLabel(e.target.value)}
            placeholder={patterns.find(p => p.id === patternDraft)?.name ?? `P${index + 1}`}
            aria-label="Pad-Label"
            className="w-full bg-bg-elevated text-text-primary border border-border-color rounded px-2 py-1.5 text-sm placeholder:text-text-dim"
          />
        </label>

        {/* Farben-Palette (theme-aware: 8 Tokens + Custom-Picker) */}
        <div className="mb-3">
          <span className="block text-xs uppercase text-text-dim mb-1">Farbe</span>
          <div className="flex flex-wrap gap-2" data-testid="perf-pad-color-swatches">
            {themedSwatches.map((c, slotIdx) => (
              <button
                key={`slot-${slotIdx}-${c}`}
                type="button"
                onClick={() => handleApplyColor(c)}
                aria-label={`Theme-Farbe Slot ${slotIdx + 1} (${c})`}
                title={`Slot ${slotIdx + 1}: ${c}`}
                data-pad-swatch={slotIdx + 1}
                className={`w-7 h-7 rounded-full border-2 transition-transform active:scale-95 ${
                  colorDraft.toLowerCase() === c.toLowerCase()
                    ? "border-text-primary scale-110"
                    : "border-border-color hover:scale-105"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
            <input
              type="color"
              value={colorDraft}
              onChange={(e) => handleApplyColor(e.target.value)}
              aria-label="Custom Farbe wählen"
              title="Custom Farbe (Hex)"
              className="w-7 h-7 rounded-full bg-transparent border border-border-color cursor-pointer"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 mt-5">
          <button
            type="button"
            onClick={handleSave}
            disabled={!patternDraft}
            className="px-3 py-1.5 rounded text-xs font-bold bg-accent-primary text-bg-base hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pad ? "Aktualisieren" : "Hinzufügen"}
          </button>
          {pad && (
            <button
              type="button"
              onClick={handleRemove}
              className="px-3 py-1.5 rounded text-xs font-bold bg-accent-danger/20 text-accent-danger border border-accent-danger/40 hover:bg-accent-danger/30 active:scale-95 flex items-center gap-1"
            >
              <Trash2 size={12} />
              Entfernen
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto px-3 py-1.5 rounded text-xs bg-bg-elevated text-text-muted hover:bg-bg-base hover:text-text-primary active:scale-95"
          >
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}
