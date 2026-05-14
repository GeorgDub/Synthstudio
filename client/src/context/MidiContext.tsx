/**
 * Synthstudio – MidiContext (v1.86)
 *
 * Provider für `useMidi`-Result damit tief verschachtelte Komponenten wie
 * DrumMachine, MixerView, FxPanel und Macro-Buttons die Right-Click-MIDI-Learn
 * Funktion via `useMidiLearn(target)` nutzen können — ohne `midi` als Prop
 * durch jede Komponente durchzureichen.
 *
 * Wert kann `null` sein wenn der Provider nicht installiert ist; das
 * deaktiviert die Learn-Funktion lautlos.
 */
import { createContext, useContext, type ReactNode } from "react";
import type { MidiState, MidiActions } from "@/hooks/useMidi";

export type MidiContextValue = (MidiState & MidiActions) | null;

const MidiContext = createContext<MidiContextValue>(null);

export function MidiProvider({
  value,
  children,
}: {
  value: MidiContextValue;
  children: ReactNode;
}) {
  return <MidiContext.Provider value={value}>{children}</MidiContext.Provider>;
}

/** Liefert das aktive midi-Objekt aus dem Context, oder null wenn keiner installiert ist. */
export function useMidiContext(): MidiContextValue {
  return useContext(MidiContext);
}
