/**
 * Diagnose-Log — Panel.
 *
 * Bewusst schlicht: ein Werkzeug, kein Feature. Es liest denselben Puffer, den
 * auch die Datei bekommt — zwei Quellen wären wieder zwei Implementierungen
 * desselben Vorgangs.
 *
 * Strg+Umschalt+L schaltet es um.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { diagLog, diagSitzung } from "@/diag";
import type { TraceEvent, TraceKind } from "@/diag/traceLog";

const FILTER: { kind: TraceKind; label: string }[] = [
  { kind: "click", label: "Klick" },
  { kind: "midi-out", label: "MIDI ▶" },
  { kind: "midi-in", label: "MIDI ◀" },
  { kind: "step", label: "Schritt" },
  { kind: "error", label: "Fehler" },
];

const FARBE: Record<TraceKind, string> = {
  click: "#c9a227",
  "midi-out": "#4a9eff",
  "midi-in": "#3ac07a",
  step: "#8a8a8a",
  error: "#e05252",
};

interface Bridge {
  diagReveal?: () => Promise<{ success: boolean; path?: string }>;
}

export default function DiagPanel(): React.ReactElement | null {
  const [offen, setOffen] = useState(false);
  const [aus, setAus] = useState<Set<TraceKind>>(new Set());
  const [, tick] = useState(0);
  const ende = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const taste = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setOffen(o => !o);
      }
    };
    window.addEventListener("keydown", taste);
    return () => window.removeEventListener("keydown", taste);
  }, []);

  // Nur neu zeichnen, solange das Panel offen ist — sonst kostet das Log
  // Rechenzeit für nichts.
  useEffect(() => {
    if (!offen) return;
    const id = setInterval(() => tick(t => t + 1), 400);
    return () => clearInterval(id);
  }, [offen]);

  const kopieren = useCallback(() => {
    const text = diagLog
      .recent()
      .map(e => JSON.stringify(e))
      .join("\n");
    void navigator.clipboard?.writeText(text);
  }, []);

  if (!offen) return null;

  const ereignisse = diagLog.recent().filter(e => !aus.has(e.kind));
  const verworfen = diagLog.droppedCount();

  return (
    <div
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        width: 720,
        maxWidth: "calc(100vw - 24px)",
        height: 420,
        maxHeight: "calc(100vh - 24px)",
        background: "#14161a",
        border: "1px solid #2b2f36",
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        zIndex: 9999,
        boxShadow: "0 8px 32px rgba(0,0,0,.5)",
        fontFamily: "ui-monospace, Menlo, Consolas, monospace",
        fontSize: 11,
        color: "#d8dce3",
      }}
      data-testid="diag-panel"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 8px",
          borderBottom: "1px solid #2b2f36",
          flexWrap: "wrap",
        }}
      >
        <strong style={{ color: "#f0f2f5" }}>Diagnose-Log</strong>
        <span style={{ color: "#7a828e" }}>{diagSitzung}</span>
        {FILTER.map(f => (
          <button
            key={f.kind}
            onClick={() =>
              setAus(v => {
                const n = new Set(v);
                if (n.has(f.kind)) n.delete(f.kind);
                else n.add(f.kind);
                return n;
              })
            }
            style={{
              background: aus.has(f.kind) ? "transparent" : "#232830",
              color: aus.has(f.kind) ? "#5c636e" : FARBE[f.kind],
              border: `1px solid ${aus.has(f.kind) ? "#2b2f36" : FARBE[f.kind]}`,
              borderRadius: 4,
              padding: "2px 6px",
              cursor: "pointer",
              fontSize: 10,
            }}
          >
            {f.label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button onClick={kopieren} style={knopf}>
          Kopieren
        </button>
        <button
          onClick={() =>
            void (globalThis as { electronAPI?: Bridge }).electronAPI?.diagReveal?.()
          }
          style={knopf}
        >
          Ordner
        </button>
        <button onClick={() => setOffen(false)} style={knopf}>
          ✕
        </button>
      </div>

      {verworfen > 0 && (
        <div style={{ padding: "4px 8px", color: "#e0a052", fontSize: 10 }}>
          ⚠ {verworfen} Ereignisse aus dem Speicher verdrängt — die Datei hat
          sie trotzdem, solange sie mitgeschrieben wurde.
        </div>
      )}

      <div style={{ overflow: "auto", flex: 1, padding: "4px 0" }}>
        {ereignisse.map((e: TraceEvent) => (
          <div
            key={e.seq}
            style={{
              display: "grid",
              gridTemplateColumns: "48px 90px 1fr",
              gap: 8,
              padding: "1px 8px",
              borderLeft: `2px solid ${FARBE[e.kind]}`,
            }}
          >
            <span style={{ color: "#5c636e" }}>{e.seq}</span>
            <span style={{ color: "#7a828e" }} title={e.src}>
              {e.corr ? `${e.corr} ` : ""}
              {e.src.slice(0, 12)}
            </span>
            <span>
              <span style={{ color: FARBE[e.kind] }}>{e.msg}</span>
              {e.hex && (
                // Der Beleg steht neben der Deutung, nie an ihrer Stelle.
                <span style={{ color: "#5c636e" }}> · {e.hex.slice(0, 96)}</span>
              )}
            </span>
          </div>
        ))}
        <div ref={ende} />
      </div>
    </div>
  );
}

const knopf: React.CSSProperties = {
  background: "#232830",
  color: "#d8dce3",
  border: "1px solid #2b2f36",
  borderRadius: 4,
  padding: "2px 8px",
  cursor: "pointer",
  fontSize: 10,
};
