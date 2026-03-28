import { ARP_MODE_LABELS, type ArpMode, type ArpOctaves } from "../../utils/arpeggiator";
import {
  useArpStore,
  setArpEnabled,
  setArpMode,
  setArpOctaves,
  setArpNotes,
  getArpSteps,
} from "../../store/useArpStore";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const ARP_MODES = Object.keys(ARP_MODE_LABELS) as ArpMode[];
const OCTAVE_BASE = 60; // C4

export function ArpeggiatorPanel() {
  const { enabled, mode, octaves, notes, stepCount } = useArpStore();
  const steps = getArpSteps();

  const toggleNote = (midi: number) => {
    const next = notes.includes(midi)
      ? notes.filter((n) => n !== midi)
      : [...notes, midi].sort((a, b) => a - b);
    setArpNotes(next);
  };

  return (
    <div style={{ background: "var(--ss-bg-panel)", border: "1px solid var(--ss-border)", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>

      {/* Header + Toggle */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ss-text-primary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Arpeggiator
        </span>
        <button
          onClick={() => setArpEnabled(!enabled)}
          style={{
            background: enabled ? "var(--ss-accent-primary)" : "var(--ss-bg-elevated)",
            border: "1px solid " + (enabled ? "var(--ss-accent-primary)" : "var(--ss-border)"),
            borderRadius: 20,
            padding: "4px 14px",
            color: enabled ? "#fff" : "var(--ss-text-muted)",
            fontWeight: 700,
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          {enabled ? "Aktiv" : "Inaktiv"}
        </button>
      </div>

      {/* Mode */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--ss-text-muted)" }}>Modus</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {ARP_MODES.map((m) => (
            <button key={m} onClick={() => setArpMode(m)} style={{ background: mode === m ? "var(--ss-accent-secondary)" : "var(--ss-bg-elevated)", border: "1px solid " + (mode === m ? "var(--ss-accent-secondary)" : "var(--ss-border)"), borderRadius: 5, padding: "4px 10px", color: mode === m ? "#fff" : "var(--ss-text-muted)", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
              {ARP_MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {/* Octaves */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--ss-text-muted)" }}>Oktaven</span>
        <div style={{ display: "flex", gap: 4 }}>
          {([1, 2, 3] as ArpOctaves[]).map((o) => (
            <button key={o} onClick={() => setArpOctaves(o)} style={{ background: octaves === o ? "var(--ss-accent-primary)" : "var(--ss-bg-elevated)", border: "1px solid " + (octaves === o ? "var(--ss-accent-primary)" : "var(--ss-border)"), borderRadius: 5, padding: "5px 16px", color: octaves === o ? "#fff" : "var(--ss-text-muted)", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
              {o}
            </button>
          ))}
        </div>
      </div>

      {/* Piano Note Selector C4-B4 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--ss-text-muted)" }}>Noten (C4–B4)</span>
        <div style={{ display: "flex", gap: 3, alignItems: "flex-end" }}>
          {NOTE_NAMES.map((name, idx) => {
            const midi = OCTAVE_BASE + idx;
            const isActive = notes.includes(midi);
            const isBlack = name.includes("#");
            return (
              <button
                key={midi}
                onClick={() => toggleNote(midi)}
                title={name + "4"}
                style={{
                  background: isActive ? "var(--ss-accent-primary)" : isBlack ? "var(--ss-bg-base)" : "var(--ss-bg-elevated)",
                  border: "1px solid " + (isActive ? "var(--ss-accent-primary)" : "var(--ss-border)"),
                  borderRadius: 3,
                  width: 20,
                  height: isBlack ? 28 : 38,
                  padding: 0,
                  cursor: "pointer",
                  flexShrink: 0,
                  color: isActive ? "#fff" : "var(--ss-text-dim)",
                  fontSize: 7,
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "center",
                  paddingBottom: 2,
                }}
              >
                {!isBlack ? name : ""}
              </button>
            );
          })}
        </div>
      </div>

      {/* Step Preview */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--ss-text-muted)" }}>Steps</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
          {steps.slice(0, stepCount).map((step, i) => (
            <div
              key={i}
              title={step.active ? "Schritt " + (i + 1) + ": MIDI " + step.note : "Schritt " + (i + 1)}
              style={{
                width: 12,
                height: 12,
                borderRadius: 2,
                background: step.active ? "var(--ss-accent-primary)" : "var(--ss-bg-elevated)",
                opacity: step.active ? 0.4 + (step.velocity / 127) * 0.6 : 1,
                border: "1px solid var(--ss-border-subtle)",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
