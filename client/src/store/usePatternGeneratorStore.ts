import { useEffect, useReducer } from "react";
import { type Genre, type GeneratedPattern, generatePattern } from "../utils/patternGenerator";

export interface PatternPromptPreset {
  id: string;
  name: string;
  prompt: string;
  genre: Genre;
  complexity: number;
}

interface PatternGeneratorState {
  selectedGenre: Genre;
  complexity: number;
  customPrompt: string;
  promptSuggestions: PatternPromptPreset[];
  savedPresets: PatternPromptPreset[];
  lastGenerated: GeneratedPattern | null;
  isGenerating: boolean;
  // Vorlagen-Modus Einstellungen
  templateBpm: number | null;       // null = Genre-Standard nutzen
  templateStepCount: 16 | 32;
  templateSwing: number;            // 0–50
  templateDensity: number;          // 0–1 (wie dicht die Steps gesetzt sind)
  templateParts: string[];          // ausgewählte Instrumente
  // Reiner Prompt-Modus (AI-only)
  promptBpm: number;
  promptStepCount: 16 | 32;
  promptParts: string[];
  promptSwing: number;
  promptText: string;
}

type Listener = () => void;

const STORAGE_KEY = "synthstudio:pattern-generator:v1";

const DEFAULT_SUGGESTIONS: PatternPromptPreset[] = [
  {
    id: "four-on-floor",
    name: "Four on the floor",
    prompt: "druckvolle Kick auf jeder Viertel, offene Offbeat-Hats, dichter Techno-Groove",
    genre: "techno",
    complexity: 0.65,
  },
  {
    id: "minimal-house",
    name: "Minimal House",
    prompt: "minimaler House Groove mit wenig Percussion und Offbeat Hats",
    genre: "house",
    complexity: 0.35,
  },
  {
    id: "trap-808",
    name: "808 Trap",
    prompt: "808 Kick Pattern, Halftime Snare und schnelle Hi-Hat Rolls",
    genre: "trap",
    complexity: 0.75,
  },
  {
    id: "dnb-break",
    name: "DnB Break",
    prompt: "gebrochener Breakbeat mit Ghost Snares und dichter Percussion",
    genre: "dnb",
    complexity: 0.8,
  },
];

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultState(): PatternGeneratorState {
  return {
    selectedGenre: "techno",
    complexity: 0.5,
    customPrompt: "",
    promptSuggestions: DEFAULT_SUGGESTIONS,
    savedPresets: [],
    lastGenerated: null,
    isGenerating: false,
    templateBpm: null,
    templateStepCount: 16,
    templateSwing: 0,
    templateDensity: 0.6,
    templateParts: ["Kick", "Snare", "Hi-Hat cl.", "Hi-Hat op.", "Clap", "Perc"],
    promptBpm: 130,
    promptStepCount: 16,
    promptParts: ["Kick", "Snare", "Hi-Hat cl.", "Hi-Hat op.", "Clap", "Perc"],
    promptSwing: 0,
    promptText: "",
  };
}

function loadState(): PatternGeneratorState {
  const base = defaultState();
  if (typeof window === "undefined") return base;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<PatternGeneratorState>;
    return {
      ...base,
      ...parsed,
      complexity: Math.max(0, Math.min(1, parsed.complexity ?? base.complexity)),
      lastGenerated: null,
      isGenerating: false,
      promptSuggestions: parsed.promptSuggestions ?? base.promptSuggestions,
      savedPresets: parsed.savedPresets ?? [],
    };
  } catch {
    return base;
  }
}

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    const { lastGenerated: _lastGenerated, isGenerating: _isGenerating, ...persisted } = _state;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // Pattern presets are convenience state; generation must work without storage.
  }
}

let _state: PatternGeneratorState = loadState();

const _listeners = new Set<Listener>();
function notify(): void { _listeners.forEach((l) => l()); }

export function setGenre(genre: Genre): void {
  _state = { ..._state, selectedGenre: genre };
  persist();
  notify();
}

export function setComplexity(complexity: number): void {
  _state = { ..._state, complexity: Math.max(0, Math.min(1, complexity)) };
  persist();
  notify();
}

export function setCustomPrompt(customPrompt: string): void {
  _state = { ..._state, customPrompt };
  persist();
  notify();
}

// ── Vorlagen-Modus Setter ─────────────────────────────────────────────────────

export function setTemplateBpm(bpm: number | null): void { _state = { ..._state, templateBpm: bpm === null ? null : Math.max(40, Math.min(240, bpm)) }; notify(); }
export function setTemplateStepCount(count: 16 | 32): void { _state = { ..._state, templateStepCount: count }; notify(); }
export function setTemplateSwing(swing: number): void { _state = { ..._state, templateSwing: Math.max(0, Math.min(50, swing)) }; notify(); }
export function setTemplateDensity(density: number): void { _state = { ..._state, templateDensity: Math.max(0, Math.min(1, density)) }; notify(); }
export function toggleTemplatePart(part: string): void {
  const parts = _state.templateParts.includes(part)
    ? _state.templateParts.filter(p => p !== part)
    : [..._state.templateParts, part];
  _state = { ..._state, templateParts: parts };
  notify();
}

// ── Reiner Prompt-Modus Setter ────────────────────────────────────────────────

export function setPromptText(text: string): void { _state = { ..._state, promptText: text }; notify(); }
export function setPromptBpm(bpm: number): void { _state = { ..._state, promptBpm: Math.max(40, Math.min(240, bpm)) }; notify(); }
export function setPromptStepCount(count: 16 | 32): void { _state = { ..._state, promptStepCount: count }; notify(); }
export function setPromptSwing(swing: number): void { _state = { ..._state, promptSwing: Math.max(0, Math.min(50, swing)) }; notify(); }
export function togglePromptPart(part: string): void {
  const parts = _state.promptParts.includes(part)
    ? _state.promptParts.filter(p => p !== part)
    : [..._state.promptParts, part];
  _state = { ..._state, promptParts: parts };
  notify();
}

/** Erstellt einen freien Prompt für den KI-Generator ohne Genre-Vorgaben. */
export async function generateFromPromptAI(): Promise<void> {
  const { getApiSettings } = await import("./useApiSettingsStore");
  const { anthropicApiKey, aiModel } = getApiSettings();
  if (!anthropicApiKey) {
    alert("Für den KI-Prompt-Modus wird ein Anthropic API Key benötigt.\nEinstellungen → KI & API → API Key eingeben.");
    return;
  }

  _state = { ..._state, isGenerating: true };
  notify();

  const { promptText, promptBpm, promptStepCount, promptParts, promptSwing } = _state;
  const swingDesc = promptSwing > 0 ? ` Swing: ${promptSwing}%.` : "";
  const partsDesc = promptParts.length > 0 ? `Verwende diese Instrumente: ${promptParts.join(", ")}.` : "";

  const prompt = `Du bist ein professioneller Drum-Programmer. Erstelle ein Drum-Pattern basierend auf dieser Beschreibung:

"${promptText || "Erstelle ein interessantes Drum-Pattern."}"

Technische Anforderungen:
- BPM: ${promptBpm} (exakt diese Zahl verwenden!)
- Steps: ${promptStepCount} pro Part${swingDesc}
- ${partsDesc}

Antworte NUR mit validem JSON:
{
  "bpm": ${promptBpm},
  "parts": [
    {
      "name": "<Instrumentenname>",
      "steps": [<${promptStepCount} true/false Werte>],
      "velocities": [<${promptStepCount} Zahlen 40-127>]
    }
  ]
}

Erstelle Parts für diese Instrumente (genau diese Namen): ${promptParts.join(", ")}.
Kein Markdown, nur reines JSON.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: aiModel,
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) throw new Error(`API ${response.status}`);
    const data = await response.json();
    const text = data.content?.[0]?.text ?? "";
    const parsed = JSON.parse(text.trim().replace(/^```json\n?|\n?```$/g, ""));
    const pattern: GeneratedPattern = {
      bpm: parsed.bpm ?? promptBpm,
      genre: "techno" as Genre, // unused in prompt mode
      parts: (parsed.parts ?? []).map((p: { name: string; steps: boolean[]; velocities: number[] }) => ({
        name: p.name,
        steps: (p.steps ?? []).map((active: boolean, i: number) => ({
          active: Boolean(active),
          velocity: p.velocities?.[i] ?? 100,
        })),
      })),
    };
    _state = { ..._state, lastGenerated: pattern, isGenerating: false };
  } catch (err) {
    console.error("[Prompt Generator]", err);
    _state = { ..._state, isGenerating: false };
    alert("Fehler beim Generieren. Bitte API Key prüfen.");
  }
  notify();
}

export function loadPromptPreset(preset: PatternPromptPreset): void {
  _state = {
    ..._state,
    selectedGenre: preset.genre,
    complexity: preset.complexity,
    customPrompt: preset.prompt,
  };
  persist();
  notify();
}

export function deletePromptSuggestion(id: string): void {
  _state = {
    ..._state,
    promptSuggestions: _state.promptSuggestions.filter((preset) => preset.id !== id),
  };
  persist();
  notify();
}

export function clearPromptSuggestions(): void {
  _state = { ..._state, promptSuggestions: [] };
  persist();
  notify();
}

export function saveCurrentPreset(name?: string): void {
  const prompt = _state.customPrompt.trim();
  if (!prompt) return;
  const preset: PatternPromptPreset = {
    id: makeId(),
    name: name?.trim() || prompt.slice(0, 32) || "Eigene Vorgabe",
    prompt,
    genre: _state.selectedGenre,
    complexity: _state.complexity,
  };
  _state = { ..._state, savedPresets: [..._state.savedPresets, preset] };
  persist();
  notify();
}

export function deleteSavedPreset(id: string): void {
  _state = {
    ..._state,
    savedPresets: _state.savedPresets.filter((preset) => preset.id !== id),
  };
  persist();
  notify();
}

export function exportPresets(): void {
    if (typeof window === "undefined") return;
    const data = {
        savedPresets: _state.savedPresets,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'synthstudio-presets.json';
    a.click();
    URL.revokeObjectURL(url);
}

export function importPresets(file: File): Promise<void> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const json = JSON.parse(event.target?.result as string);
                if (json && Array.isArray(json.savedPresets)) {
                    const existingIds = new Set(_state.savedPresets.map(p => p.id));
                    const newPresets = json.savedPresets.filter((p: any) => p.id && !existingIds.has(p.id));
                    _state = {
                        ..._state,
                        savedPresets: [..._state.savedPresets, ...newPresets],
                    };
                    persist();
                    notify();
                    resolve();
                } else {
                    reject(new Error("Invalid preset file format."));
                }
            } catch (e) {
                reject(e);
            }
        };
        reader.onerror = (e) => reject(e);
        reader.readAsText(file);
    });
}

/** Baut den Claude-Prompt für die Pattern-Generierung. */
function buildPrompt(genre: string, complexity: number, description: string): string {
  const partNames = ["Kick", "Snare", "Hi-Hat cl.", "Hi-Hat op.", "Clap", "Tom Hi", "Tom Lo", "Perc", "FX"];
  return `Du bist ein professioneller Drum-Programmer. Erstelle ein 16-Step Drum-Pattern für das Genre "${genre}" mit Komplexität ${Math.round(complexity * 100)}%.

${description ? `Zusätzliche Anweisung: ${description}\n` : ""}
Antworte NUR mit validem JSON in genau diesem Format:
{
  "bpm": <Zahl zwischen 80-180>,
  "parts": [
    {
      "name": "<Kanalname>",
      "steps": [<16 true/false Werte, kommagetrennt>],
      "velocities": [<16 Zahlen zwischen 40-127, kommagetrennt>]
    }
  ]
}

Erstelle genau ${partNames.length} Parts in dieser Reihenfolge: ${partNames.join(", ")}.
Keine Erklärungen, kein Markdown, nur reines JSON.`;
}

/** Parst die Claude-Antwort und extrahiert das GeneratedPattern. */
function parseClaudeResponse(json: string, genre: Genre): GeneratedPattern {
  const data = JSON.parse(json.trim().replace(/^```json\n?|\n?```$/g, ""));
  return {
    bpm: data.bpm ?? 120,
    genre,
    parts: (data.parts ?? []).map((p: { name: string; steps: boolean[]; velocities: number[] }) => ({
      name: p.name,
      steps: (p.steps ?? []).map((active: boolean, i: number) => ({
        active: Boolean(active),
        velocity: p.velocities?.[i] ?? 100,
      })),
    })),
  };
}

export async function generateAndStoreAI(): Promise<void> {
  const { getApiSettings } = await import("./useApiSettingsStore");
  const { anthropicApiKey, aiModel } = getApiSettings();
  if (!anthropicApiKey) { generateAndStore(); return; }

  _state = { ..._state, isGenerating: true };
  notify();

  try {
    const { GENRE_BPM } = await import("../utils/patternGenerator");
    const effectiveBpm = _state.templateBpm ?? (GENRE_BPM[_state.selectedGenre] as number) ?? 120;
    const partsHint = _state.templateParts.length > 0 ? ` Instrumente: ${_state.templateParts.join(", ")}.` : "";
    const swingHint = _state.templateSwing > 0 ? ` Swing: ${_state.templateSwing}%.` : "";
    const stepsHint = `Steps: ${_state.templateStepCount}.`;
    const bpmOverride = `BPM: exakt ${effectiveBpm}!`;
    const enhancedDescription = [_state.customPrompt, bpmOverride, stepsHint, partsHint, swingHint].filter(Boolean).join(" ");
    const prompt = buildPrompt(_state.selectedGenre, _state.complexity, enhancedDescription);
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: aiModel,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    const data = await response.json();
    const text = data.content?.[0]?.text ?? "";
    const pattern = parseClaudeResponse(text, _state.selectedGenre);
    _state = { ..._state, lastGenerated: pattern, isGenerating: false };
  } catch (err) {
    console.error("[AI Beat Co-Pilot]", err);
    // Fallback auf prozedurale Generierung
    const pattern = generatePattern({
      genre: _state.selectedGenre,
      complexity: _state.complexity,
      description: _state.customPrompt,
      seed: Math.floor(Math.random() * 0xffffffff),
    });
    _state = { ..._state, lastGenerated: pattern, isGenerating: false };
  }
  notify();
}

export function generateAndStore(): void {
  _state = { ..._state, isGenerating: true };
  notify();
  setTimeout(() => {
    const { GENRE_BPM } = require("../utils/patternGenerator");
    const effectiveBpm = _state.templateBpm ?? (GENRE_BPM[_state.selectedGenre] as number) ?? 120;
    const pattern = generatePattern({
      genre: _state.selectedGenre,
      complexity: _state.complexity,
      description: _state.customPrompt,
      seed: Math.floor(Math.random() * 0xffffffff),
    });
    // Template-Overrides anwenden
    const finalPattern = {
      ...pattern,
      bpm: effectiveBpm,
      parts: pattern.parts
        .filter(p => _state.templateParts.length === 0 || _state.templateParts.some(tp =>
          p.name.toLowerCase().includes(tp.toLowerCase().split(' ')[0])
        ))
        .map(p => ({
          ...p,
          steps: p.steps.map((step, _i) => ({
            ...step,
            active: step.active && Math.random() < (0.3 + _state.templateDensity * 0.7) ||
              (!step.active && Math.random() < _state.templateDensity * 0.15),
          })),
        })),
    };
    // Swing-Effekt: Offbeat-Steps verschieben (approximiert durch Velocity-Änderung)
    if (_state.templateSwing > 0) {
      finalPattern.parts.forEach(p => {
        p.steps.forEach((step, i) => {
          if (i % 2 === 1 && step.active) {
            step.velocity = Math.max(20, Math.min(127, (step.velocity ?? 100) - Math.round(_state.templateSwing * 0.5)));
          }
        });
      });
    }
    _state = { ..._state, lastGenerated: finalPattern, isGenerating: false };
    notify();
  }, 200);
}

export function clearGenerated(): void {
  _state = { ..._state, lastGenerated: null };
  notify();
}

export function __resetForTests(): void {
  _state = defaultState();
  _listeners.clear();
}

export function getPatternGeneratorState(): PatternGeneratorState {
  return _state;
}

export function usePatternGeneratorStore(): PatternGeneratorState {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return _state;
}
