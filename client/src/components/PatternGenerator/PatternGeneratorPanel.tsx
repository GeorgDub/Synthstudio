/**
 * Synthstudio – PatternGeneratorPanel (v2)
 *
 * Zwei klar getrennte Modi:
 *  A) VORLAGEN-MODUS: Genre → Komplexität → algorithmisch generieren (kein AI nötig)
 *  B) PROMPT-MODUS: Freier Text + BPM + Instrumente + Swing → KI generiert (API Key nötig)
 */
import { useState, useRef } from "react";
import { GENRE_LABELS, GENRE_BPM as GENRE_BPM_MAP, type Genre, type GeneratedPattern } from "../../utils/patternGenerator";
import {
  usePatternGeneratorStore,
  setGenre,
  setComplexity,
  setCustomPrompt,
  loadPromptPreset,
  deletePromptSuggestion,
  clearPromptSuggestions,
  saveCurrentPreset,
  deleteSavedPreset,
  generateAndStore,
  generateAndStoreAI,
  generateFromPromptAI,
  clearGenerated,
  importPresets,
  exportPresets,
  setPromptText,
  setPromptBpm,
  setPromptStepCount,
  setPromptSwing,
  togglePromptPart,
  setTemplateBpm,
  setTemplateStepCount,
  setTemplateSwing,
  setTemplateDensity,
  toggleTemplatePart,
} from "../../store/usePatternGeneratorStore";
const GENRE_BPM = GENRE_BPM_MAP;
import { useApiSettingsStore } from "../../store/useApiSettingsStore";

const GENRES = Object.keys(GENRE_LABELS) as Genre[];

const ALL_PARTS = ["Kick", "Snare", "Hi-Hat cl.", "Hi-Hat op.", "Clap", "Tom Hi", "Tom Lo", "Perc", "FX", "Bass"];

// ─── Mini Step Grid ───────────────────────────────────────────────────────────

function MiniGrid({ pattern }: { pattern: GeneratedPattern }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {pattern.parts.map((part) => (
        <div key={part.name} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 60, fontSize: 9, color: "var(--ss-text-dim)", textAlign: "right", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {part.name}
          </span>
          <div style={{ display: "flex", gap: 1, flex: 1 }}>
            {part.steps.slice(0, 32).map((step, i) => (
              <div key={i} style={{
                flex: 1, height: 10, borderRadius: 1,
                background: step.active ? "var(--ss-accent-primary)" : "var(--ss-bg-elevated)",
                opacity: step.active ? 0.35 + (step.velocity / 127) * 0.65 : 1,
                border: "1px solid var(--ss-border-subtle)",
                minWidth: 6,
              }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Shared Preview + Apply ───────────────────────────────────────────────────

function GeneratedPreview({ pattern, onApply, onClear }: { pattern: GeneratedPattern; onApply: () => void; onClear: () => void }) {
  return (
    <div style={{ borderTop: "1px solid var(--ss-border-subtle)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "var(--ss-text-muted)", fontWeight: 600 }}>
          {pattern.bpm} BPM · {pattern.parts.length} Parts · {pattern.parts[0]?.steps.length ?? 16} Steps
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={onApply}
            style={{ background: "var(--ss-accent-success)", border: "none", borderRadius: 5, padding: "5px 14px", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 11 }}>
            → Übernehmen
          </button>
          <button onClick={onClear}
            style={{ background: "var(--ss-bg-elevated)", border: "1px solid var(--ss-border-subtle)", borderRadius: 5, padding: "5px 8px", color: "var(--ss-text-dim)", cursor: "pointer", fontSize: 11 }}>
            ✕
          </button>
        </div>
      </div>
      <MiniGrid pattern={pattern} />
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function PatternGeneratorPanel() {
  const store = usePatternGeneratorStore();
  const apiSettings = useApiSettingsStore();
  const hasApiKey = apiSettings.anthropicApiKey.length > 0;
  const [mode, setMode] = useState<"template" | "prompt">("template");
  const [presetName, setPresetName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleApply = () => {
    if (!store.lastGenerated) return;
    window.dispatchEvent(new CustomEvent("pattern-generator:apply", { detail: store.lastGenerated }));
  };

  const containerSt: React.CSSProperties = {
    background: "var(--ss-bg-panel)",
    border: "1px solid var(--ss-border)",
    borderRadius: 8,
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  };

  const tabBtnSt = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: "7px 0", borderRadius: 6,
    border: "1px solid " + (active ? "var(--ss-accent-primary)" : "var(--ss-border)"),
    background: active ? "var(--ss-accent-primary)" : "var(--ss-bg-elevated)",
    color: active ? "#fff" : "var(--ss-text-muted)",
    fontWeight: 700, fontSize: 12, cursor: "pointer",
  });

  return (
    <div style={containerSt}>
      {/* ── Modus-Auswahl ──────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 6 }}>
        <button style={tabBtnSt(mode === "template")} onClick={() => setMode("template")}>
          🎛 Vorlagen
        </button>
        <button style={tabBtnSt(mode === "prompt")} onClick={() => setMode("prompt")}>
          ✨ KI-Prompt
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          MODUS A: VORLAGEN
         ══════════════════════════════════════════════════════════════ */}
      {mode === "template" && (
        <>
          <div>
            <div style={{ fontSize: 11, color: "var(--ss-text-muted)", marginBottom: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Genre-Vorlage
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
              {GENRES.map((g) => (
                <button key={g} onClick={() => setGenre(g)} style={{
                  background: store.selectedGenre === g ? "var(--ss-accent-primary)" : "var(--ss-bg-elevated)",
                  border: "1px solid " + (store.selectedGenre === g ? "var(--ss-accent-primary)" : "var(--ss-border)"),
                  borderRadius: 6, padding: "6px 4px", cursor: "pointer",
                  color: store.selectedGenre === g ? "#fff" : "var(--ss-text-muted)",
                  fontSize: 11, textAlign: "center",
                }}>
                  <div style={{ fontWeight: 700 }}>{GENRE_LABELS[g]}</div>
                  <div style={{ fontSize: 9, opacity: 0.7 }}>{GENRE_BPM[g]} BPM</div>
                </button>
              ))}
            </div>
          </div>

          {/* ── BPM ─────────────────────────────────────────────── */}
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--ss-text-muted)", marginBottom: 4, fontWeight: 600 }}>BPM</div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button onClick={() => setTemplateBpm(null)} title="Genre-Standard nutzen"
                  style={{ padding: "4px 8px", borderRadius: 4, background: store.templateBpm === null ? "var(--ss-accent-secondary)" : "var(--ss-bg-elevated)", border: "1px solid var(--ss-border)", color: store.templateBpm === null ? "#fff" : "var(--ss-text-dim)", fontSize: 10, cursor: "pointer", fontWeight: 700 }}>
                  Auto ({GENRE_BPM[store.selectedGenre]})
                </button>
                <button onClick={() => setTemplateBpm((store.templateBpm ?? GENRE_BPM[store.selectedGenre]) - 1)}
                  style={{ width: 22, height: 26, background: "var(--ss-bg-elevated)", border: "1px solid var(--ss-border)", borderRadius: 4, color: "var(--ss-text-muted)", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>−</button>
                <input type="number"
                  value={store.templateBpm ?? GENRE_BPM[store.selectedGenre]}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "") { setTemplateBpm(null); return; } // Leer → Auto
                    const num = parseInt(val);
                    if (!isNaN(num)) setTemplateBpm(num);
                  }}
                  onBlur={(e) => {
                    const num = parseInt(e.target.value);
                    if (!isNaN(num)) setTemplateBpm(Math.max(40, Math.min(240, num)));
                  }}
                  style={{ width: 52, background: "var(--ss-bg-elevated)", border: "1px solid " + (store.templateBpm !== null ? "var(--ss-accent-primary)" : "var(--ss-border)"), borderRadius: 4, padding: "3px 4px", color: "var(--ss-text-primary)", fontSize: 13, fontWeight: 700, fontFamily: "monospace", textAlign: "center" }} />
                <button onClick={() => setTemplateBpm((store.templateBpm ?? GENRE_BPM[store.selectedGenre]) + 1)}
                  style={{ width: 22, height: 26, background: "var(--ss-bg-elevated)", border: "1px solid var(--ss-border)", borderRadius: 4, color: "var(--ss-text-muted)", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>+</button>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, color: "var(--ss-text-muted)", marginBottom: 4, fontWeight: 600 }}>Steps</div>
              <div style={{ display: "flex", gap: 3 }}>
                {([16, 32] as const).map(n => (
                  <button key={n} onClick={() => setTemplateStepCount(n)} style={{
                    padding: "4px 10px", borderRadius: 5,
                    background: store.templateStepCount === n ? "var(--ss-accent-secondary)" : "var(--ss-bg-elevated)",
                    border: "1px solid " + (store.templateStepCount === n ? "var(--ss-accent-secondary)" : "var(--ss-border)"),
                    color: store.templateStepCount === n ? "#fff" : "var(--ss-text-muted)",
                    fontWeight: 700, fontSize: 12, cursor: "pointer",
                  }}>{n}</button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Komplexität + Dichte + Swing ─────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { label: "Komplexität", value: store.complexity, set: setComplexity, color: "var(--ss-accent-primary)", format: (v: number) => `${Math.round(v * 100)}%` },
              { label: "Dichte", value: store.templateDensity, set: setTemplateDensity, color: "var(--ss-accent-secondary)", format: (v: number) => `${Math.round(v * 100)}%` },
              { label: "Swing", value: store.templateSwing / 50, set: (v: number) => setTemplateSwing(Math.round(v * 50)), color: "var(--ss-accent-success)", format: (_v: number) => `${store.templateSwing}%` },
            ].map(({ label, value, set, color, format }) => (
              <label key={label} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "var(--ss-text-muted)", width: 72, flexShrink: 0 }}>{label}</span>
                <input type="range" min={0} max={1} step={0.05} value={value}
                  onChange={(e) => set(parseFloat(e.target.value))}
                  style={{ flex: 1, accentColor: color }} />
                <span style={{ fontSize: 11, fontFamily: "monospace", color, width: 34, textAlign: "right" }}>{format(value)}</span>
              </label>
            ))}
          </div>

          {/* ── Instrumente ──────────────────────────────────────── */}
          <div>
            <div style={{ fontSize: 11, color: "var(--ss-text-muted)", marginBottom: 5, fontWeight: 600 }}>
              Instrumente ({store.templateParts.length} aktiv)
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {ALL_PARTS.map(part => {
                const active = store.templateParts.includes(part);
                return (
                  <button key={part} onClick={() => toggleTemplatePart(part)} style={{
                    padding: "3px 9px", borderRadius: 10,
                    background: active ? "var(--ss-accent-primary)" : "var(--ss-bg-elevated)",
                    border: "1px solid " + (active ? "var(--ss-accent-primary)" : "var(--ss-border)"),
                    color: active ? "#fff" : "var(--ss-text-muted)",
                    fontSize: 11, cursor: "pointer", fontWeight: active ? 700 : 400,
                  }}>{part}</button>
                );
              })}
            </div>
          </div>

          {/* ── Optionale Beschreibung ────────────────────────────── */}
          <div>
            <div style={{ fontSize: 11, color: "var(--ss-text-muted)", marginBottom: 5, fontWeight: 600 }}>
              Beschreibung / Anweisung (optional)
            </div>
            <textarea value={store.customPrompt} onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="z.B. druckvolle Kick, kein Hi-Hat, minimaler Groove…"
              rows={2} style={{
                width: "100%", resize: "vertical", minHeight: 44,
                background: "var(--ss-bg-elevated)", border: "1px solid var(--ss-border)",
                borderRadius: 6, padding: 8, color: "var(--ss-text-primary)", fontSize: 12,
              }} />
          </div>

          <button onClick={() => hasApiKey ? generateAndStoreAI() : generateAndStore()}
            disabled={store.isGenerating}
            style={{
              background: "var(--ss-accent-primary)", border: "none", borderRadius: 6,
              padding: "10px 0", color: "#fff", fontWeight: 700, cursor: store.isGenerating ? "wait" : "pointer",
              fontSize: 13, opacity: store.isGenerating ? 0.7 : 1,
            }}>
            {store.isGenerating ? "Generiere…"
              : `${hasApiKey ? "✨" : "🎛"} ${store.templateBpm ?? GENRE_BPM[store.selectedGenre]} BPM · ${store.templateStepCount} Steps · ${Math.round(store.complexity * 100)}% Komplex`}
          </button>

          {/* Presets */}
          {(store.promptSuggestions.length > 0 || store.savedPresets.length > 0) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--ss-border-subtle)", paddingTop: 8 }}>
              {store.promptSuggestions.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, color: "var(--ss-text-dim)", textTransform: "uppercase", marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
                    <span>Vorschläge</span>
                    <button onClick={clearPromptSuggestions} style={{ background: "none", border: "none", color: "var(--ss-text-dim)", cursor: "pointer", fontSize: 10 }}>Alle löschen</button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {store.promptSuggestions.map((p) => (
                      <div key={p.id} style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => loadPromptPreset(p)} style={{ flex: 1, background: "var(--ss-bg-elevated)", border: "1px solid var(--ss-border-subtle)", borderRadius: 5, padding: "4px 7px", color: "var(--ss-text-muted)", fontSize: 11, textAlign: "left", cursor: "pointer" }}>
                          {p.name}
                        </button>
                        <button onClick={() => deletePromptSuggestion(p.id)} style={{ width: 26, background: "var(--ss-bg-elevated)", border: "1px solid var(--ss-border-subtle)", borderRadius: 5, color: "var(--ss-text-dim)", cursor: "pointer" }}>×</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {store.savedPresets.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, color: "var(--ss-text-dim)", textTransform: "uppercase", marginBottom: 4 }}>Eigene Vorgaben</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {store.savedPresets.map((p) => (
                      <div key={p.id} style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => loadPromptPreset(p)} style={{ flex: 1, background: "var(--ss-bg-elevated)", border: "1px solid var(--ss-border-subtle)", borderRadius: 5, padding: "4px 7px", color: "var(--ss-text-muted)", fontSize: 11, textAlign: "left", cursor: "pointer" }}>
                          {p.name}
                        </button>
                        <button onClick={() => deleteSavedPreset(p.id)} style={{ width: 26, background: "var(--ss-bg-elevated)", border: "1px solid var(--ss-border-subtle)", borderRadius: 5, color: "var(--ss-text-dim)", cursor: "pointer" }}>×</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Preset-Verwaltung */}
          <div style={{ display: "flex", gap: 6, borderTop: "1px solid var(--ss-border-subtle)", paddingTop: 8 }}>
            <input value={presetName} onChange={(e) => setPresetName(e.target.value)}
              placeholder="Vorgaben-Name…" style={{ flex: 1, background: "var(--ss-bg-elevated)", border: "1px solid var(--ss-border)", borderRadius: 5, padding: "5px 8px", color: "var(--ss-text-primary)", fontSize: 11 }} />
            <button onClick={() => { saveCurrentPreset(presetName); setPresetName(""); }}
              disabled={!store.customPrompt.trim()}
              style={{ background: "var(--ss-bg-elevated)", border: "1px solid var(--ss-border)", borderRadius: 5, padding: "5px 10px", color: store.customPrompt.trim() ? "var(--ss-text-muted)" : "var(--ss-text-dim)", cursor: store.customPrompt.trim() ? "pointer" : "not-allowed", fontSize: 11, fontWeight: 700 }}>
              Speichern
            </button>
            <button onClick={() => fileInputRef.current?.click()}
              style={{ background: "var(--ss-bg-elevated)", border: "1px solid var(--ss-border)", borderRadius: 5, padding: "5px 8px", color: "var(--ss-text-muted)", cursor: "pointer", fontSize: 11 }}>
              ↑
            </button>
            <button onClick={exportPresets}
              style={{ background: "var(--ss-bg-elevated)", border: "1px solid var(--ss-border)", borderRadius: 5, padding: "5px 8px", color: "var(--ss-text-muted)", cursor: "pointer", fontSize: 11 }}>
              ↓
            </button>
            <input ref={fileInputRef} type="file" accept=".json" style={{ display: "none" }}
              onChange={async (e) => { const f = e.target.files?.[0]; if (f) { try { await importPresets(f); } catch { alert("Import fehlgeschlagen"); } e.target.value = ""; }} } />
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════
          MODUS B: KI-PROMPT (rein prompt-basiert, volle Kontrolle)
         ══════════════════════════════════════════════════════════════ */}
      {mode === "prompt" && (
        <>
          {!hasApiKey && (
            <div style={{ background: "var(--ss-accent-danger)", opacity: 0.15, borderRadius: 6, padding: "8px 12px", border: "1px solid var(--ss-accent-danger)", color: "var(--ss-accent-danger)", fontSize: 11 }}>
              ⚠ KI-Prompt erfordert einen Anthropic API Key.<br />
              <strong>Einstellungen → KI &amp; API → API Key eingeben.</strong>
            </div>
          )}

          {/* Prompt-Textarea */}
          <div>
            <div style={{ fontSize: 11, color: "var(--ss-text-muted)", marginBottom: 6, fontWeight: 600 }}>
              Beschreibe dein Pattern frei
            </div>
            <textarea
              value={store.promptText}
              onChange={(e) => setPromptText(e.target.value)}
              placeholder={"Beispiele:\n• Druckvoller Techno-Groove, minimal, hartes Quantize, 4/4 Kick\n• Lo-Fi Hip-Hop mit viel Swing, Ghost-Notes auf Snare\n• Komplexes DnB-Pattern mit Amen-Break-Feeling und subtiler Hi-Hat"}
              rows={5}
              style={{
                width: "100%", resize: "vertical", minHeight: 100,
                background: "var(--ss-bg-elevated)", border: "1px solid var(--ss-accent-primary)",
                borderRadius: 6, padding: 10, color: "var(--ss-text-primary)", fontSize: 12, lineHeight: 1.5,
              }}
            />
          </div>

          {/* BPM + Step Count */}
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
              <span style={{ fontSize: 11, color: "var(--ss-text-muted)" }}>BPM</span>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button onClick={() => setPromptBpm(store.promptBpm - 1)} style={{ width: 24, height: 28, background: "var(--ss-bg-elevated)", border: "1px solid var(--ss-border)", borderRadius: 4, color: "var(--ss-text-muted)", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>−</button>
                <input type="number" min={40} max={240} value={store.promptBpm}
                  onChange={(e) => setPromptBpm(parseInt(e.target.value) || 120)}
                  style={{ flex: 1, background: "var(--ss-bg-elevated)", border: "1px solid var(--ss-border)", borderRadius: 4, padding: "4px 6px", color: "var(--ss-text-primary)", fontSize: 14, fontWeight: 700, fontFamily: "monospace", textAlign: "center" }} />
                <button onClick={() => setPromptBpm(store.promptBpm + 1)} style={{ width: 24, height: 28, background: "var(--ss-bg-elevated)", border: "1px solid var(--ss-border)", borderRadius: 4, color: "var(--ss-text-muted)", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>+</button>
              </div>
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--ss-text-muted)" }}>Steps</span>
              <div style={{ display: "flex", gap: 3 }}>
                {([16, 32] as const).map(n => (
                  <button key={n} onClick={() => setPromptStepCount(n)} style={{
                    padding: "5px 12px", borderRadius: 5,
                    background: store.promptStepCount === n ? "var(--ss-accent-secondary)" : "var(--ss-bg-elevated)",
                    border: "1px solid " + (store.promptStepCount === n ? "var(--ss-accent-secondary)" : "var(--ss-border)"),
                    color: store.promptStepCount === n ? "#fff" : "var(--ss-text-muted)",
                    fontWeight: 700, fontSize: 12, cursor: "pointer",
                  }}>{n}</button>
                ))}
              </div>
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: "var(--ss-text-muted)" }}>Swing</span>
                <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--ss-accent-secondary)" }}>{store.promptSwing}%</span>
              </div>
              <input type="range" min={0} max={50} step={5} value={store.promptSwing}
                onChange={(e) => setPromptSwing(parseInt(e.target.value))}
                style={{ accentColor: "var(--ss-accent-secondary)" }} />
            </label>
          </div>

          {/* Instrumente */}
          <div>
            <div style={{ fontSize: 11, color: "var(--ss-text-muted)", marginBottom: 6, fontWeight: 600 }}>
              Instrumente ({store.promptParts.length} gewählt)
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {ALL_PARTS.map(part => {
                const active = store.promptParts.includes(part);
                return (
                  <button key={part} onClick={() => togglePromptPart(part)} style={{
                    padding: "3px 10px", borderRadius: 12,
                    background: active ? "var(--ss-accent-primary)" : "var(--ss-bg-elevated)",
                    border: "1px solid " + (active ? "var(--ss-accent-primary)" : "var(--ss-border)"),
                    color: active ? "#fff" : "var(--ss-text-muted)",
                    fontSize: 11, cursor: "pointer", fontWeight: active ? 700 : 400,
                  }}>{part}</button>
                );
              })}
            </div>
          </div>

          {/* Generate Button */}
          <button
            onClick={() => generateFromPromptAI()}
            disabled={store.isGenerating || !store.promptText.trim()}
            style={{
              background: hasApiKey && store.promptText.trim() ? "var(--ss-accent-secondary)" : "var(--ss-bg-elevated)",
              border: "1px solid " + (hasApiKey && store.promptText.trim() ? "var(--ss-accent-secondary)" : "var(--ss-border)"),
              borderRadius: 6, padding: "11px 0", color: hasApiKey && store.promptText.trim() ? "#fff" : "var(--ss-text-dim)",
              fontWeight: 700, cursor: (store.isGenerating || !store.promptText.trim()) ? "not-allowed" : "pointer",
              fontSize: 14, opacity: store.isGenerating ? 0.7 : 1,
            }}>
            {store.isGenerating
              ? "✨ KI generiert…"
              : !hasApiKey
                ? "⚠ API Key fehlt"
                : !store.promptText.trim()
                  ? "← Beschreibung eingeben"
                  : `✨ Pattern aus Prompt generieren (${store.promptBpm} BPM, ${store.promptStepCount} Steps)`}
          </button>

          {/* Beispiel-Prompts */}
          <div style={{ borderTop: "1px solid var(--ss-border-subtle)", paddingTop: 8 }}>
            <div style={{ fontSize: 10, color: "var(--ss-text-dim)", textTransform: "uppercase", marginBottom: 6 }}>Beispiel-Prompts</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {[
                { label: "Minimal Techno", text: "Minimaler Techno mit 4/4 Kick, subtilen Offbeat-Hats, fast kein Snare. Sehr reduziert." },
                { label: "Hip-Hop Bounce", text: "Entspannter Hip-Hop mit harten Rimshots, viel Swing auf den Hats, Trap-Feeling." },
                { label: "DnB Amen", text: "Drum & Bass mit komplexem Amen-Break-Feeling, synkopierter Snare, schnelle Hats." },
                { label: "House Classic", text: "Classic House mit 4/4 Kick, Offbeat-Clap, regelmäßigen Hats, tanzbarer Groove." },
              ].map(ex => (
                <button key={ex.label} onClick={() => setPromptText(ex.text)} style={{
                  background: "var(--ss-bg-elevated)", border: "1px solid var(--ss-border-subtle)",
                  borderRadius: 5, padding: "5px 8px", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 8, textAlign: "left",
                }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ss-accent-primary)", flexShrink: 0 }}>{ex.label}</span>
                  <span style={{ fontSize: 10, color: "var(--ss-text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ex.text}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Gemeinsame Vorschau ─────────────────────────────────────── */}
      {store.lastGenerated && (
        <GeneratedPreview
          pattern={store.lastGenerated}
          onApply={handleApply}
          onClear={clearGenerated}
        />
      )}
    </div>
  );
}
