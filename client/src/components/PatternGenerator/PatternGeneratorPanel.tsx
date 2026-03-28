import { GENRE_LABELS, GENRE_BPM, type Genre, type GeneratedPattern } from "../../utils/patternGenerator";
import {
  usePatternGeneratorStore,
  setGenre,
  setComplexity,
  generateAndStore,
} from "../../store/usePatternGeneratorStore";

const GENRES = Object.keys(GENRE_LABELS) as Genre[];

// ─── Mini Step Grid ───────────────────────────────────────────────────────────

function MiniGrid({ pattern }: { pattern: GeneratedPattern }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {pattern.parts.map((part) => (
        <div key={part.name} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{
            width: 58,
            fontSize: 9,
            color: "var(--ss-text-dim)",
            textAlign: "right",
            flexShrink: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {part.name}
          </span>
          <div style={{ display: "flex", gap: 2 }}>
            {part.steps.slice(0, 16).map((step, i) => (
              <div
                key={i}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: step.active
                    ? "var(--ss-accent-primary)"
                    : "var(--ss-bg-elevated)",
                  opacity: step.active ? 0.4 + (step.velocity / 127) * 0.6 : 1,
                  border: "1px solid var(--ss-border-subtle)",
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function PatternGeneratorPanel() {
  const store = usePatternGeneratorStore();

  const handleApply = () => {
    if (!store.lastGenerated) return;
    window.dispatchEvent(
      new CustomEvent("pattern-generator:apply", { detail: store.lastGenerated })
    );
  };

  return (
    <div style={{ background: "var(--ss-bg-panel)", border: "1px solid var(--ss-border)", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ss-text-primary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        Pattern Generator
      </span>

      {/* Genre Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
        {GENRES.map((g) => (
          <button
            key={g}
            onClick={() => setGenre(g)}
            style={{
              background: store.selectedGenre === g ? "var(--ss-accent-primary)" : "var(--ss-bg-elevated)",
              border: "1px solid " + (store.selectedGenre === g ? "var(--ss-accent-primary)" : "var(--ss-border)"),
              borderRadius: 6,
              padding: "6px 4px",
              cursor: "pointer",
              color: store.selectedGenre === g ? "#fff" : "var(--ss-text-muted)",
              fontSize: 11,
              textAlign: "center",
            }}
          >
            <div style={{ fontWeight: 700 }}>{GENRE_LABELS[g]}</div>
            <div style={{ fontSize: 9, opacity: 0.7 }}>{GENRE_BPM[g]} BPM</div>
          </button>
        ))}
      </div>

      {/* Complexity Slider */}
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: 11, color: "var(--ss-text-muted)" }}>Komplexität</span>
          <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--ss-accent-primary)" }}>
            {Math.round(store.complexity * 100)}%
          </span>
        </div>
        <input
          type="range" min={0} max={1} step={0.05}
          value={store.complexity}
          onChange={(e) => setComplexity(parseFloat((e.target as HTMLInputElement).value))}
          style={{ width: "100%", accentColor: "var(--ss-accent-primary)" }}
        />
      </label>

      {/* Generate Button */}
      <button
        onClick={generateAndStore}
        disabled={store.isGenerating}
        style={{
          background: "var(--ss-accent-primary)",
          border: "none",
          borderRadius: 6,
          padding: "9px 0",
          color: "#fff",
          fontWeight: 700,
          cursor: store.isGenerating ? "wait" : "pointer",
          fontSize: 13,
          opacity: store.isGenerating ? 0.7 : 1,
        }}
      >
        {store.isGenerating ? "Generiere…" : "Pattern generieren"}
      </button>

      {/* Preview */}
      {store.lastGenerated && (
        <div style={{ borderTop: "1px solid var(--ss-border-subtle)", paddingTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: "var(--ss-text-muted)" }}>
              {GENRE_LABELS[store.lastGenerated.genre]} · {store.lastGenerated.bpm} BPM
            </span>
            <button
              onClick={handleApply}
              style={{ background: "var(--ss-accent-success)", border: "none", borderRadius: 5, padding: "4px 12px", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 11 }}
            >
              Übernehmen
            </button>
          </div>
          <MiniGrid pattern={store.lastGenerated} />
        </div>
      )}
    </div>
  );
}
