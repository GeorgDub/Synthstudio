/**
 * MidiActivityIndicator.tsx — Live-Anzeige eingehender MIDI-Signale (#11).
 *
 * Lauscht auf das globale `midi:rawmessage`-Event (useMidi.ts:1063), das pro
 * eingehender Note/CC/PitchBend feuert — für BEIDE Backends (Web-MIDI + nativer
 * Shim laufen durch denselben handleMidiMessage). So sieht der User sofort, ob
 * sein Controller/seine KORG tatsächlich Signale schickt.
 *
 * Eine grüne LED blinkt bei jedem Signal; die letzte Message + ein Zähler
 * werden eingeblendet. Kein Flackern durch MIDI-Clock (die feuert das Event
 * bewusst nicht).
 */
import { useEffect, useRef, useState } from "react";
import { formatMidiActivity, type MidiActivityInfo } from "@/utils/midiActivity";

interface RawMidiDetail {
  type: number;
  channel: number;
  byte1: number;
  byte2: number;
}

export function MidiActivityIndicator() {
  const [last, setLast] = useState<MidiActivityInfo | null>(null);
  const [count, setCount] = useState(0);
  const [active, setActive] = useState(false);
  const offTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onRaw = (e: Event) => {
      const det = (e as CustomEvent<RawMidiDetail>).detail;
      if (!det) return;
      setLast(formatMidiActivity(det.type, det.channel, det.byte1, det.byte2));
      setCount((c) => c + 1);
      setActive(true);
      if (offTimer.current) clearTimeout(offTimer.current);
      // LED bleibt bei kontinuierlichem Input an; erlischt 160ms nach dem
      // letzten Signal.
      offTimer.current = setTimeout(() => setActive(false), 160);
    };
    window.addEventListener("midi:rawmessage", onRaw as EventListener);
    return () => {
      window.removeEventListener("midi:rawmessage", onRaw as EventListener);
      if (offTimer.current) clearTimeout(offTimer.current);
    };
  }, []);

  return (
    <div
      className="flex items-center gap-2 rounded p-2 bg-bg-panel border border-border-color"
      data-testid="midi-activity-indicator"
    >
      <span
        data-testid="midi-activity-led"
        data-active={active ? "true" : "false"}
        className={`inline-block w-3 h-3 rounded-full transition-colors duration-75 ${
          active ? "bg-accent-success shadow-[0_0_6px_var(--ss-accent-success)]" : "bg-bg-elevated"
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-text-muted">
          {count === 0 ? "Warte auf MIDI-Signal…" : "MIDI-Signal empfangen"}
        </div>
        {last && (
          <div
            className="text-xs font-mono text-text-primary truncate"
            data-testid="midi-activity-last"
            title={last.label}
          >
            {last.label}
          </div>
        )}
      </div>
      {count > 0 && (
        <span
          className="text-[10px] text-text-dim tabular-nums"
          data-testid="midi-activity-count"
        >
          {count}
        </span>
      )}
    </div>
  );
}
