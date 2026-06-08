/**
 * Synthstudio – ShortcutsHelp.tsx
 *
 * Vier Tabs:
 *  1. Shortcuts-Übersicht (read-only, alle Standardbelegungen)
 *  2. Tastenbelegung (konfigurierbar, alle Actions neu zuweisbar)
 *  3. ss.* API-Referenz (v2.11) — Skripting-Cheat-Sheet
 *  4. MIDI-Guide (v2.11) — Auto-Learn / Right-Click / Templates Übersicht
 */

import React, { useState } from "react";
import { X } from "lucide-react";
import { SHORTCUT_GROUPS } from "@/hooks/useKeyboardShortcuts";
import { KeyboardBindingsPanel } from "@/components/Settings/KeyboardBindingsPanel";

interface ShortcutsHelpProps {
  onClose: () => void;
}

function KeyBadge({ label }: { label: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.75rem] h-6 px-1.5 bg-bg-elevated border border-border-color rounded text-xs font-mono text-text-primary shadow-sm">
      {label}
    </kbd>
  );
}

export function ShortcutsHelp({ onClose }: ShortcutsHelpProps) {
  const [tab, setTab] = useState<"overview" | "bindings" | "ss-api" | "midi-guide">("overview");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-3xl max-h-[85vh] bg-bg-panel border border-border-color rounded-xl shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-color shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-lg">📚</span>
            <h2 className="text-base font-semibold text-text-primary">Hilfe & Referenz</h2>
            {/* Tabs */}
            <div className="flex gap-1 ml-2 flex-wrap">
              {(["overview", "bindings", "ss-api", "midi-guide"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    tab === t
                      ? "bg-accent-primary/20 text-accent-primary border border-accent-primary/40"
                      : "text-text-dim hover:text-text-primary"
                  }`}
                >
                  {t === "overview"   ? "⌨️ Shortcuts" :
                   t === "bindings"   ? "Belegung" :
                   t === "ss-api"     ? "🧩 Script-API" :
                                        "🎹 MIDI-Guide"}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary leading-none p-1 rounded flex items-center justify-center transition-colors"
            aria-label="Close"
            title="Schließen"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Inhalt */}
        <div className="overflow-y-auto flex-1 p-5">
          {tab === "overview" ? (
            <div className="grid grid-cols-2 gap-6">
              {SHORTCUT_GROUPS.map(group => (
                <div key={group.title}>
                  <h3 className="text-xs font-semibold text-accent-secondary uppercase tracking-wider mb-3">
                    {group.title}
                  </h3>
                  <div className="space-y-2">
                    {group.shortcuts.map((shortcut, i) => (
                      <div key={i} className="flex items-center justify-between gap-2">
                        <span className="text-xs text-text-muted flex-1">{shortcut.description}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          {shortcut.keys.map((key, j) => (
                            <React.Fragment key={j}>
                              <KeyBadge label={key} />
                              {j < shortcut.keys.length - 1 && (
                                <span className="text-text-dim text-xs">+</span>
                              )}
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : tab === "bindings" ? (
            <KeyboardBindingsPanel />
          ) : tab === "ss-api" ? (
            <ScriptApiReference />
          ) : (
            <MidiGuide />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-border-color shrink-0">
          <span className="text-xs text-text-dim">
            {tab === "overview"   ? "Shortcuts funktionieren nicht in Eingabefeldern" :
             tab === "bindings"   ? "Eigene Belegungen überschreiben die Standardtasten" :
             tab === "ss-api"     ? "Scripte laufen sandboxed im Web-Worker — keine Browser-API, kein Netzzugriff" :
                                    "Rechtsklick auf jedes Element → MIDI-Learn · Templates-Tab für Hardware-Presets"}
          </span>
          <button onClick={onClose} className="px-4 py-1.5 bg-bg-elevated hover:brightness-125 text-text-primary text-sm rounded">
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ss.* API-Referenz (v2.11) ─────────────────────────────────────────────

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="text-[11px] bg-bg-base border border-border-color rounded p-2 text-text-primary overflow-x-auto font-mono leading-relaxed">
      {children}
    </pre>
  );
}

function ApiRow({ sig, desc }: { sig: string; desc: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-1 border-b border-border-color/30 last:border-b-0">
      <code className="text-[11px] font-mono text-accent-secondary">{sig}</code>
      <span className="text-[10px] text-text-muted leading-tight">{desc}</span>
    </div>
  );
}

function ScriptApiReference() {
  return (
    <div className="space-y-4 text-xs text-text-primary">
      <div>
        <h3 className="text-xs font-semibold text-accent-primary uppercase tracking-wider mb-2">Was sind Scripts?</h3>
        <p className="text-text-muted leading-snug">
          Scripts laufen in einer abgeschotteten Sandbox (Web-Worker) und steuern Synthstudio
          via <code className="text-accent-secondary">ss.*</code>-API. Alles ist <strong>async</strong> —
          benutze <code className="text-accent-secondary">await</code>. Maximale Laufzeit: 5 Sekunden.
          Keine <code>window</code>/<code>document</code>/<code>fetch</code> verfügbar.
        </p>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-accent-primary uppercase tracking-wider mb-2">Transport</h3>
        <div className="space-y-0">
          <ApiRow sig="await ss.bpm(value: number)" desc="Setzt BPM (20-300, geclamped)." />
          <ApiRow sig="await ss.play()" desc="Startet Transport." />
          <ApiRow sig="await ss.stop()" desc="Stoppt Transport." />
          <ApiRow sig="await ss.wait(ms: number)" desc="Asynchroner Delay (max 60 Sekunden)." />
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-accent-primary uppercase tracking-wider mb-2">Macros</h3>
        <div className="space-y-0">
          <ApiRow sig="await ss.getMacro(idx: 0-7): Promise<number>" desc="Liest Macro-Wert (0-1)." />
          <ApiRow sig="await ss.setMacro(idx: 0-7, value: 0-1)" desc="Setzt Macro-Wert." />
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-accent-primary uppercase tracking-wider mb-2">Steps</h3>
        <div className="space-y-0">
          <ApiRow sig="await ss.setStep(partId: string, stepIdx: 0-63, on: boolean)" desc="Step ein/aus." />
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-accent-primary uppercase tracking-wider mb-2">Dispatch (Actions)</h3>
        <p className="text-text-muted text-[10px] mb-1 leading-snug">
          <code className="text-accent-secondary">await ss.dispatch(action)</code> triggert eine
          der folgenden Actions:
        </p>
        <div className="flex flex-wrap gap-1">
          {[
            "play-stop", "record", "tap-tempo",
            "bpm-up", "bpm-down", "bpm-up-10", "bpm-down-10",
            "pattern-next", "pattern-prev", "pattern-duplicate",
            "pattern-clear", "pattern-fill", "pattern-randomize",
            "pattern-copy-samples-from-prev",
            "part-up", "part-down", "velocity-mode", "pitch-mode",
            "toggle-note-repeat", "toggle-morph",
          ].map(a => (
            <code key={a} className="text-[10px] font-mono text-accent-secondary bg-bg-elevated px-1.5 py-0.5 rounded">{a}</code>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-accent-primary uppercase tracking-wider mb-2">Utility</h3>
        <div className="space-y-0">
          <ApiRow sig="ss.log(msg: string)" desc="Loggt in die Script-Konsole (max 500 Zeichen, rate-limited)." />
          <ApiRow sig="ss.random(): number" desc="Zufallszahl 0..1." />
          <ApiRow sig="ss.now(): number" desc="Aktuelle Zeit in ms (Date.now())." />
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-accent-primary uppercase tracking-wider mb-2">Beispiel: BPM-Rampe</h3>
        <CodeBlock>{`for (let bpm = 100; bpm <= 140; bpm += 2) {
  await ss.bpm(bpm);
  await ss.wait(200);
}`}</CodeBlock>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-accent-primary uppercase tracking-wider mb-2">Beispiel: Drop-Reset</h3>
        <CodeBlock>{`await ss.stop();
await ss.wait(200);
await ss.dispatch("pattern-clear");
await ss.play();`}</CodeBlock>
      </div>

      <p className="text-[10px] text-text-dim leading-snug">
        Tipp: <strong>ScriptRunner → 📚 Built-In</strong> liefert 14 vorgefertigte Scripts ohne
        KI-API-Key. Built-Ins sind jederzeit anpassbar und an Pads/Tasten bindbar.
      </p>
    </div>
  );
}

// ─── MIDI-Guide (v2.11) ────────────────────────────────────────────────────

function GuideStep({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-accent-secondary/30 text-accent-secondary text-[10px] font-bold flex items-center justify-center">{n}</span>
      <div className="flex-1 min-w-0">
        <h4 className="text-xs font-semibold text-text-primary">{title}</h4>
        <div className="text-[11px] text-text-muted leading-snug mt-0.5">{children}</div>
      </div>
    </div>
  );
}

function MidiGuide() {
  return (
    <div className="space-y-5 text-xs text-text-primary">
      <div>
        <h3 className="text-xs font-semibold text-accent-primary uppercase tracking-wider mb-2">Setup in 4 Schritten</h3>
        <div className="space-y-3">
          <GuideStep n={1} title="Hardware anschließen">
            Synthstudio öffnen → <strong>Einstellungen → MIDI → Geräte</strong> →
            „<strong>Aktivieren</strong>". Auto-Reconnect merkt sich dein Gerät über Reloads.
          </GuideStep>
          <GuideStep n={2} title="Template laden (optional)">
            Tab <strong>Vorlagen</strong> → wähle dein Gerät aus 13 eingebauten Templates
            (Electribe 2, Volca Beats, TR-8, Digitakt, BeatStep, Launchpad, …) oder
            speichere deine eigene Config als JSON.
          </GuideStep>
          <GuideStep n={3} title="Per Rechtsklick lernen">
            Rechtsklick auf JEDES Slider/Knopf/Pad in der App → „MIDI-Learn" → Controller bewegen →
            fertig. Funktioniert für BPM, Volumes, Mutes, Solos, Pans, Sends, alle 15 FX-Parameter
            pro Channel, Macros, Patterns, einzelne Steps und User-Scripts.
          </GuideStep>
          <GuideStep n={4} title="Auto-Learn-Wizard">
            Tab <strong>CC-Mapping → Auto-Learn</strong> bietet Presets (Mixer, Pads, Komplett,
            Transport, Pattern-Nav). Sequenzielles Lernen mit Channel-Filter wenn mehrere Geräte
            angeschlossen sind.
          </GuideStep>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-accent-primary uppercase tracking-wider mb-2">Was alles bindbar ist</h3>
        <ul className="text-[11px] text-text-muted leading-relaxed list-disc list-inside space-y-0.5">
          <li><strong>Transport:</strong> BPM, Play/Stop, Record, Tap, BPM ± 1/10</li>
          <li><strong>Mixer:</strong> Volume, Pan, Mute, Solo, Reverb-Send, Delay-Send, Master</li>
          <li><strong>FX pro Channel:</strong> Filter (Freq/Q/Gain), Distortion, Compressor (4 Params),
            Delay (3), Reverb (2), 3-Band-EQ — 15 Params × 8 Parts = 120 Slots</li>
          <li><strong>Macros:</strong> alle 8 mit Inline-Rename</li>
          <li><strong>Pattern:</strong> Switch via Index, Next/Prev/Clear/Fill/Random/Duplicate</li>
          <li><strong>Step-Trigger:</strong> jeder einzelne Step im Grid</li>
          <li><strong>Function-Chain:</strong> mehrere Actions hintereinander auf eine Taste (Drop-Combo etc.)</li>
          <li><strong>Run-Script:</strong> jedes User-Script als momentary Pad-Trigger</li>
        </ul>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-accent-primary uppercase tracking-wider mb-2">Bidirektional</h3>
        <ul className="text-[11px] text-text-muted leading-relaxed list-disc list-inside space-y-0.5">
          <li><strong>MIDI Clock In:</strong> BPM vom Master übernehmen</li>
          <li><strong>MIDI Clock Out:</strong> Synthstudio sendet 24 PPQ + Start/Stop</li>
          <li><strong>Note-Out aus Pattern:</strong> AudioEngine sendet jede getriggerte Note an Output</li>
          <li><strong>Note + CC Test-Buttons</strong> in den Output-Settings</li>
          <li><strong>MIDI Panic:</strong> All Notes Off auf 16 Channels</li>
        </ul>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-accent-primary uppercase tracking-wider mb-2">Tipps</h3>
        <ul className="text-[11px] text-text-muted leading-relaxed list-disc list-inside space-y-0.5">
          <li><strong>Monitor-Tab</strong> zeigt jedes eingehende Event mit der gebundenen Action — Top-Debugging-Tool</li>
          <li><strong>Activity-Indicator</strong> im Header pulst grün bei jedem Event</li>
          <li><strong>Channel-Filter</strong> im Auto-Learn ignoriert Events von anderen Geräten</li>
          <li><strong>Bulk-Bind</strong> setzt N konsekutive Mappings ohne Controller-Bewegen</li>
          <li><strong>Layout-JSON-Export</strong> teilt deine Config; <strong>User-Templates</strong> speichern sie in-app</li>
        </ul>
      </div>
    </div>
  );
}
