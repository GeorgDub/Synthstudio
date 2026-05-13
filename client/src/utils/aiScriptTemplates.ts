/**
 * Synthstudio – AI Script Generator Prompt-Templates (post-v1.40.0)
 *
 * Vordefinierte Prompt-Vorlagen für häufige ss.*-Skript-Patterns.
 * User klickt ein Template im Generator-Dialog an → Prompt-Textarea wird
 * vorausgefüllt → User kann anpassen + Generieren klicken.
 *
 * Templates sind kuratiert für die Anfangs-Hürde "ich weiß nicht was die
 * KI alles kann". Sie zeigen die typischen ss.*-API-Patterns.
 */

export interface AiScriptTemplate {
  /** Eindeutige ID (für stable React-keys). */
  id: string;
  /** Sichtbare Kategorie für die Gruppierung im Dropdown. */
  category: "Transport" | "Macros" | "Pattern" | "Performance" | "Beispiel";
  /** Knapper Titel für das Dropdown-Item. */
  label: string;
  /** Eine kurze Beschreibung was das Template tut. */
  description: string;
  /** Der eigentliche Prompt-Text der ins Textarea kommt. */
  prompt: string;
}

export const AI_SCRIPT_TEMPLATES: AiScriptTemplate[] = [
  // ─── Transport / BPM ───────────────────────────────────────────────────────
  {
    id: "bpm-ramp",
    category: "Transport",
    label: "BPM-Rampe von A → B",
    description: "Glatte BPM-Änderung über mehrere Sekunden",
    prompt:
      "Rampe BPM von 100 auf 140 in 4 Sekunden. Update alle 200ms damit es smooth läuft. Logge jeden Schritt mit ss.log.",
  },
  {
    id: "bpm-sequence",
    category: "Transport",
    label: "BPM-Sequenz (Sprünge zwischen Werten)",
    description: "Mehrere BPM-Werte nacheinander mit Pause dazwischen",
    prompt:
      "Spiele eine BPM-Sequenz: 120 für 4 Sekunden, dann 160 für 4 Sekunden, dann 90 für 4 Sekunden. Logge jeden Wechsel.",
  },
  {
    id: "play-stop-toggle",
    category: "Transport",
    label: "Play/Stop alle X Sekunden",
    description: "Automatischer Toggle von Playback in fixem Intervall",
    prompt:
      "Toggle Play/Stop alle 8 Sekunden. Mach das 5 mal und stoppe dann. Logge jedes Toggle.",
  },

  // ─── Macros ────────────────────────────────────────────────────────────────
  {
    id: "macro-sweep",
    category: "Macros",
    label: "Macro-Sweep (0 → 1)",
    description: "Macro-Wert über mehrere Sekunden steigern",
    prompt:
      "Sweep Macro 0 von Wert 0 auf 1 in 3 Sekunden. Schritte alle 50ms. Mit ss.setMacro(0, value).",
  },
  {
    id: "macro-lfo",
    category: "Macros",
    label: "Macro als LFO (sinus)",
    description: "Macro oszilliert sinusförmig zwischen 0 und 1",
    prompt:
      "Setze Macro 0 als langsamen Sinus-LFO: Wert oszilliert zwischen 0 und 1 mit Periode 4 Sekunden. Update alle 30ms. Loop 30 Sekunden lang.",
  },
  {
    id: "macro-random",
    category: "Macros",
    label: "Macros zufällig setzen",
    description: "Alle 8 Macros mit Zufallswerten füllen",
    prompt:
      "Setze alle 8 Macros (0-7) auf Zufallswerte via ss.random(). Wiederhole das alle 2 Sekunden, 10 mal.",
  },

  // ─── Pattern ───────────────────────────────────────────────────────────────
  {
    id: "pattern-walker",
    category: "Pattern",
    label: "Pattern-Walker (next/prev)",
    description: "Durchschalten der Patterns im Takt",
    prompt:
      "Springe alle 8 Sekunden zum nächsten Pattern via ss.dispatch('pattern-next'). Mach 8 Sprünge dann stop.",
  },
  {
    id: "step-fill",
    category: "Pattern",
    label: "Step-Fill mit Probability",
    description: "Setze Steps zufällig mit gegebener Wahrscheinlichkeit",
    prompt:
      "Fülle Steps 0-15 vom Part 'kick' mit 60% Wahrscheinlichkeit: für jeden Step entscheide via ss.random() < 0.6 ob er an oder aus ist.",
  },
  {
    id: "pattern-shuffle",
    category: "Pattern",
    label: "Pattern alle X Sekunden shufflen",
    description: "Dispatch randomize-action im Takt",
    prompt:
      "Triggere ss.dispatch('pattern-randomize') alle 16 Sekunden für 1 Minute. Logge jeden Trigger.",
  },

  // ─── Performance ───────────────────────────────────────────────────────────
  {
    id: "performance-build-up",
    category: "Performance",
    label: "Build-up: BPM + Macros gleichzeitig",
    description: "Drama-Effekt mit BPM + Filter-Macro Anstieg",
    prompt:
      "Erzeuge einen Build-up: Während 10 Sekunden gleichzeitig (a) BPM von 120 auf 160 ansteigen lassen und (b) Macro 0 von 0 auf 1 sweepen. Beide updates parallel via ss.wait + Math.min Berechnung.",
  },
  {
    id: "performance-drop",
    category: "Performance",
    label: "Drop: stop + clear + restart",
    description: "Klassischer Drop-Moment",
    prompt:
      "Mach einen klassischen Drop: ss.stop(), warte 200ms, ss.dispatch('pattern-clear'), warte 100ms, dispatch pattern-randomize, ss.play(), Macro 0 auf 1 setzen.",
  },

  // ─── Beispiel ──────────────────────────────────────────────────────────────
  {
    id: "minimal-hello",
    category: "Beispiel",
    label: "Hello-World",
    description: "Simpelstes ss.log-Beispiel zum Testen",
    prompt: "Logge 'Hallo Welt' und ein bisschen System-Info wie BPM via ss.bpm().",
  },
  {
    id: "minimal-bpm-print",
    category: "Beispiel",
    label: "Aktuelle BPM auslesen",
    description: "ss.bpm() Lese-Operation demonstrieren",
    prompt: "Lies die aktuelle BPM via ss.bpm() und logge den Wert. Mach das alle Sekunde, 10 mal.",
  },
];

/** Gruppiert Templates nach Kategorie für UI-Dropdown-Sections. */
export function groupTemplatesByCategory(): Record<string, AiScriptTemplate[]> {
  const map: Record<string, AiScriptTemplate[]> = {};
  for (const t of AI_SCRIPT_TEMPLATES) {
    if (!map[t.category]) map[t.category] = [];
    map[t.category].push(t);
  }
  return map;
}

/** Findet ein Template per ID. */
export function findTemplate(id: string): AiScriptTemplate | undefined {
  return AI_SCRIPT_TEMPLATES.find((t) => t.id === id);
}
