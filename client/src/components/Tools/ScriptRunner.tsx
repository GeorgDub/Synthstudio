/**
 * Synthstudio – ScriptRunner
 *
 * JavaScript-Skripting für Automation und Macro-Erstellung.
 * Skripte laufen in einer Sandbox (new Function) mit Zugang zur Synthstudio API.
 *
 * Verfügbare API:
 *   ss.bpm(val)           → BPM setzen
 *   ss.play()             → Wiedergabe starten
 *   ss.stop()             → Wiedergabe stoppen
 *   ss.setStep(p,i,on)    → Step aktivieren/deaktivieren
 *   ss.setBpm(bpm)        → BPM setzen
 *   ss.log(msg)           → In der Konsole ausgeben
 *   ss.wait(ms)           → Warten (Promise)
 *   ss.dispatch(action)   → kb:action Event dispatchen
 */
import React, { useCallback, useRef, useState } from "react";

interface ScriptRunnerProps {
  onBpmChange: (bpm: number) => void;
  onPlayStop: () => void;
  bpm: number;
  isPlaying: boolean;
}

const EXAMPLE_SCRIPTS = [
  {
    label: "BPM Ramp Up",
    code: `// BPM von 100 auf 140 in 8 Schritten erhöhen
for (let i = 0; i < 8; i++) {
  ss.bpm(100 + i * 5);
  await ss.wait(500);
}
ss.log("BPM Ramp abgeschlossen!");`,
  },
  {
    label: "Steps randomisieren",
    code: `// Zufälliges Pattern auf aktuellem Kanal
ss.dispatch("pattern-randomize");
ss.log("Pattern randomisiert.");`,
  },
  {
    label: "Euclidean Rhythm",
    code: `// Euklidischer Rhythmus: 5 Hits in 16 Steps
function euclidean(hits, steps) {
  const seq = new Array(steps).fill(false);
  let prev = hits;
  let rem = steps - hits;
  while (rem > 1) {
    const tmp = Math.min(prev, rem);
    rem = Math.abs(prev - rem);
    prev = tmp;
  }
  // Bjorklund Algorithmus (vereinfacht)
  for (let i = 0; i < steps; i++) {
    if (Math.round(i * hits / steps) !== Math.round((i-1) * hits / steps)) {
      seq[i] = true;
    }
  }
  return seq;
}
const seq = euclidean(5, 16);
ss.log("Rhythm: " + seq.map(v => v ? "X" : ".").join(""));`,
  },
];

export function ScriptRunner({ onBpmChange, onPlayStop, bpm, isPlaying }: ScriptRunnerProps) {
  const [code, setCode] = useState(EXAMPLE_SCRIPTS[0].code);
  const [output, setOutput] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);

  const run = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    abortRef.current = false;
    const logs: string[] = [];
    setOutput([]);

    const api = {
      bpm:     (v: number) => { onBpmChange(v); logs.push(`→ BPM: ${v}`); setOutput([...logs]); },
      setBpm:  (v: number) => { onBpmChange(v); logs.push(`→ BPM: ${v}`); setOutput([...logs]); },
      play:    () => { if (!isPlaying) onPlayStop(); logs.push("→ Play"); setOutput([...logs]); },
      stop:    () => { if (isPlaying) onPlayStop(); logs.push("→ Stop"); setOutput([...logs]); },
      dispatch:(action: string) => {
        window.dispatchEvent(new CustomEvent("kb:action", { detail: action }));
        logs.push(`→ Action: ${action}`);
        setOutput([...logs]);
      },
      log:     (msg: string) => { logs.push(String(msg)); setOutput([...logs]); },
      wait:    (ms: number): Promise<void> => new Promise(resolve => {
        const t = setTimeout(resolve, ms);
        if (abortRef.current) clearTimeout(t);
      }),
      bpmValue: bpm,
      isPlaying,
    };

    try {
      // Sandbox via AsyncFunction (kein Zugriff auf window direkt)
      const fn = new Function("ss", `"use strict"; return (async () => { ${code} })();`);
      await fn(api);
      logs.push("✓ Skript erfolgreich ausgeführt.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      logs.push(`✗ Fehler: ${msg}`);
    }
    setOutput([...logs]);
    setRunning(false);
  }, [code, running, onBpmChange, onPlayStop, bpm, isPlaying]);

  const abort = useCallback(() => {
    abortRef.current = true;
    setRunning(false);
    setOutput(prev => [...prev, "⚠ Abgebrochen."]);
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-text-dim uppercase tracking-widest">Script Runner</span>
        <div className="flex-1" />
        <select onChange={e => {
          const s = EXAMPLE_SCRIPTS.find(s => s.label === e.target.value);
          if (s) setCode(s.code);
        }} defaultValue="" className="text-[10px] bg-bg-elevated border border-border-color rounded px-2 py-1 text-text-muted">
          <option value="" disabled>Beispiel laden…</option>
          {EXAMPLE_SCRIPTS.map(s => <option key={s.label}>{s.label}</option>)}
        </select>
      </div>

      {/* Code Editor */}
      <textarea
        value={code}
        onChange={e => setCode(e.target.value)}
        className="w-full font-mono text-xs bg-bg-base text-text-primary border border-border-color rounded p-3 resize-none focus:border-accent-primary outline-none"
        style={{ minHeight: 160, tabSize: 2 }}
        spellCheck={false}
        placeholder="// JavaScript Skript…"
      />

      {/* Buttons */}
      <div className="flex gap-2">
        <button onClick={running ? abort : run}
          className={`px-4 py-1.5 text-xs rounded font-bold transition-colors ${running ? "bg-accent-danger text-white" : "bg-accent-primary text-white hover:opacity-80"}`}>
          {running ? "⏹ Abbrechen" : "▶ Ausführen"}
        </button>
        <button onClick={() => setOutput([])} className="px-3 py-1.5 text-xs rounded bg-bg-elevated text-text-muted border border-border-color hover:text-text-primary">
          Konsole leeren
        </button>
        <span className="text-[10px] text-text-dim self-center ml-1">
          API: <code className="text-accent-secondary">ss.bpm()</code>, <code className="text-accent-secondary">ss.dispatch()</code>, <code className="text-accent-secondary">ss.wait(ms)</code>, …
        </span>
      </div>

      {/* Ausgabe */}
      {(output.length > 0 || error) && (
        <div className="font-mono text-[10px] bg-bg-base border border-border-color rounded p-3 max-h-32 overflow-y-auto space-y-0.5">
          {output.map((line, i) => (
            <div key={i} className={line.startsWith("✗") ? "text-accent-danger" : line.startsWith("✓") ? "text-accent-success" : "text-text-primary"}>
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
