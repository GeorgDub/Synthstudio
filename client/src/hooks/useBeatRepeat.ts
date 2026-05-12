/**
 * Synthstudio – useBeatRepeat
 *
 * Beat Repeat / Stutter Effekt für Live-Performance.
 * Wenn aktiviert: der aktuell spielende Audio-Ausgang wird in einem Buffer
 * aufgezeichnet und mit einer einstellbaren Rate geloopt (Stutter).
 *
 * Implementierung: MediaStreamDestination + MediaRecorder → Blob → Loop
 * Vereinfacht: Automation-Trick via AudioEngine Gain-Automation
 *
 * Rate-Optionen: 1/32, 1/16, 1/8, 1/4 des Taktes
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type BeatRepeatRate = "1/32" | "1/16" | "1/8" | "1/4";

export const BEAT_REPEAT_RATES: BeatRepeatRate[] = ["1/32", "1/16", "1/8", "1/4"];

const RATE_FRACTION: Record<BeatRepeatRate, number> = {
  "1/32": 1/32,
  "1/16": 1/16,
  "1/8":  1/8,
  "1/4":  1/4,
};

interface UseBeatRepeatOptions {
  bpm: number;
  isPlaying: boolean;
}

export function useBeatRepeat({ bpm, isPlaying }: UseBeatRepeatOptions) {
  const [active,  setActive]  = useState(false);
  const [rate,    setRate]    = useState<BeatRepeatRate>("1/16");
  const [wet,     setWet]     = useState(0.7);
  const timerRef              = useRef<ReturnType<typeof setInterval> | null>(null);
  const [beatFlash, setBeatFlash] = useState(false);

  // Stutter-Effekt: Gate-Automation auf AudioEngine Master
  const startStutter = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    const intervalMs = RATE_FRACTION[rate] * (60 / bpm) * 4 * 1000;

    timerRef.current = setInterval(() => {
      setBeatFlash(true);
      // Dispatch ein Event damit App.tsx den Master-Gain kurz senken kann
      window.dispatchEvent(new CustomEvent("beatrepeat:pulse", { detail: { wet, intervalMs } }));
      setTimeout(() => setBeatFlash(false), intervalMs * 0.4);
    }, intervalMs);
  }, [rate, bpm, wet]);

  const stopStutter = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setBeatFlash(false);
    window.dispatchEvent(new CustomEvent("beatrepeat:stop"));
  }, []);

  useEffect(() => {
    if (active && isPlaying) startStutter();
    else stopStutter();
    return stopStutter;
  }, [active, isPlaying, startStutter, stopStutter]);

  const toggle = useCallback(() => setActive(p => !p), []);

  return { active, toggle, rate, setRate, wet, setWet, beatFlash };
}
