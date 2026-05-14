/**
 * Synthstudio – useMidiLearn (v1.86)
 *
 * Universeller Hook für Right-Click-MIDI-Learn auf UI-Elementen. Jede
 * Komponente (Slider, Knopf, Toggle, …) kann diesen Hook nutzen und bekommt:
 *   - einen Context-Menu-Handler
 *   - Mapping-State (gebunden? auf welchem CC?)
 *   - Unbind- und Learn-Actions
 *
 * Verwendung:
 *
 * ```tsx
 * const { onContextMenu, isMapped, mappedCC, learn, unbind, menu } =
 *   useMidiLearn({ type: "masterVolume" }, midi);
 * return (
 *   <div onContextMenu={onContextMenu}>
 *     <Slider ... />
 *     {isMapped && <span>CC{mappedCC}</span>}
 *     {menu}
 *   </div>
 * );
 * ```
 *
 * Die Context-Menu-Komponente wird via `menu` als ReactNode zurückgegeben —
 * der Caller rendert sie an einer beliebigen Stelle (z.B. neben dem Slider).
 * Sie positioniert sich selbst absolut anhand der Klick-Koordinaten.
 */
import { useCallback, useEffect, useState, type ReactNode, type MouseEvent } from "react";
import {
  type MidiLearnTarget,
  type MidiState,
  type MidiActions,
  findMappingForTarget,
  labelForTarget,
} from "./useMidi";
import { useMidiContext } from "@/context/MidiContext";

export interface UseMidiLearnResult {
  /** Right-click-Handler — auf das UI-Element legen. */
  onContextMenu: (e: MouseEvent) => void;
  /** True wenn dieser Target bereits einem CC zugewiesen ist. */
  isMapped: boolean;
  /** CC-Nummer wenn isMapped, sonst null. */
  mappedCC: number | null;
  /** Manuell Learn auslösen (für Buttons im Context-Menu z.B.). */
  learn: () => void;
  /** Vorhandenes Mapping entfernen. */
  unbind: () => void;
  /** ReactNode für die Context-Menu-Anzeige — vom Caller rendern lassen. */
  menu: ReactNode;
}

/**
 * @param target Das MidiLearnTarget für dieses UI-Element
 * @param midiOverride Optional — überschreibt den Context-Lookup. Falls
 *   weder Override noch Provider vorhanden, ist der Hook ein lautloses
 *   No-Op (kein Context-Menu, isMapped=false).
 */
export function useMidiLearn(
  target: MidiLearnTarget,
  midiOverride?: MidiState & MidiActions,
): UseMidiLearnResult {
  const contextMidi = useMidiContext();
  const midi = midiOverride ?? contextMidi;
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  const existing = midi ? findMappingForTarget(midi.mappings, target) : undefined;
  const isMapped = !!existing;
  const mappedCC = existing?.cc ?? null;

  const learn = useCallback(() => {
    if (!midi) return;
    midi.startLearn(target);
    setMenuPos(null);
  }, [midi, target]);

  const unbind = useCallback(() => {
    if (midi && existing) {
      midi.removeMapping(existing.cc, existing.channel);
    }
    setMenuPos(null);
  }, [midi, existing]);

  const onContextMenu = useCallback((e: MouseEvent) => {
    if (!midi || !midi.isEnabled) return; // ohne Web-MIDI keine Bind-Aktion
    e.preventDefault();
    setMenuPos({ x: e.clientX, y: e.clientY });
  }, [midi]);

  // Click-outside / Escape schließt das Menu
  useEffect(() => {
    if (!menuPos) return;
    const handleClick = () => setMenuPos(null);
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuPos(null);
    };
    // Verzögert anhängen damit der Click der das Menü geöffnet hat
    // es nicht direkt wieder schließt
    const t = setTimeout(() => {
      window.addEventListener("click", handleClick);
      window.addEventListener("keydown", handleEscape);
    }, 50);
    return () => {
      clearTimeout(t);
      window.removeEventListener("click", handleClick);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [menuPos]);

  const menu: ReactNode = menuPos ? (
    <div
      className="fixed z-[200] bg-bg-panel border border-border-color rounded shadow-lg min-w-[180px] py-1 text-xs"
      style={{ left: Math.min(menuPos.x, window.innerWidth - 220), top: Math.min(menuPos.y, window.innerHeight - 120) }}
      onClick={(e) => e.stopPropagation()}
      data-testid="midi-learn-context-menu"
    >
      <div className="px-3 py-1.5 text-text-dim text-[10px] uppercase tracking-wider border-b border-border-color">
        MIDI: {labelForTarget(target)}
      </div>
      {isMapped ? (
        <>
          <div className="px-3 py-1.5 text-text-muted">
            Gebunden: <span className="text-accent-secondary font-mono">CC{mappedCC}</span>
            {existing && existing.channel > 0 && (
              <span className="text-text-dim ml-1">Ch{existing.channel}</span>
            )}
          </div>
          <button
            onClick={learn}
            className="w-full text-left px-3 py-1.5 hover:bg-accent-primary/20 text-text-primary"
          >
            🎓 Neu lernen…
          </button>
          <button
            onClick={unbind}
            className="w-full text-left px-3 py-1.5 hover:bg-accent-danger/20 text-accent-danger"
          >
            🗑 Mapping entfernen
          </button>
        </>
      ) : (
        <button
          onClick={learn}
          className="w-full text-left px-3 py-1.5 hover:bg-accent-primary/20 text-text-primary"
        >
          🎓 MIDI-Learn — bewege einen Controller
        </button>
      )}
    </div>
  ) : null;

  return { onContextMenu, isMapped, mappedCC, learn, unbind, menu };
}
