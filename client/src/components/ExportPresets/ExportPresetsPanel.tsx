/**
 * ExportPresetsPanel.tsx
 *
 * Inline-Panel mit vier Export-Presets für Synthstudio.
 * Kommuniziert via window.electronAPI (Electron IPC bridge).
 * Keine Props – die Komponente verwaltet ihren Zustand intern.
 */
import { useState, useCallback, useRef, useEffect } from "react";

// ── Local bridge types ────────────────────────────────────────────────────────
// Subset of ElectronAPI plus exportBundle (forward-compatible extension).
// Cast via `unknown` avoids merging two incompatible structural types.

type ApiResult   = { success: boolean; filePath?: string; canceled?: boolean; error?: string };
type WavOptions  = { pcmData: number[]; sampleRate: number; channels: number; suggestedName?: string };
type StemEntry   = { name: string; pcmData: number[]; sampleRate: number; channels: number };
type BundleOpts  = { stems: StemEntry[]; suggestedName?: string };

interface ExportBridgeAPI {
  exportWav(o: WavOptions): Promise<ApiResult>;
  exportBundle(o: BundleOpts): Promise<ApiResult>;
}

// ── Preset definitions ────────────────────────────────────────────────────────

type PresetId = "wav-quick" | "wav-studio" | "wav-broadcast" | "bundle";

interface Preset {
  id: PresetId;
  label: string;
  description: string;
  badge: "WAV" | "ZIP";
  ariaLabel: string;
}

const PRESETS: Preset[] = [
  {
    id: "wav-quick",
    label: "Quick WAV",
    description: "Mono · 44100 Hz · schnell",
    badge: "WAV",
    ariaLabel: "Quick WAV exportieren – Mono 44100 Hz, schnell",
  },
  {
    id: "wav-studio",
    label: "Studio WAV",
    description: "Stereo · 48000 Hz · hohe Qualität",
    badge: "WAV",
    ariaLabel: "Studio WAV exportieren – Stereo 48000 Hz, hohe Qualität",
  },
  {
    id: "wav-broadcast",
    label: "Broadcast WAV",
    description: "Stereo · 48000 Hz · mit Metadaten",
    badge: "WAV",
    ariaLabel: "Broadcast WAV exportieren – 48000 Hz mit Metadaten",
  },
  {
    id: "bundle",
    label: "Full Bundle",
    description: "WAV Stems + MIDI + metadata.zip",
    badge: "ZIP",
    ariaLabel: "Full Bundle exportieren – WAV, MIDI und Metadaten als ZIP",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function getExportBridge(): ExportBridgeAPI | undefined {
  // exportBundle is not yet in the formal ElectronAPI typedef;
  // double-cast lets us treat the bridge as the local interface safely.
  return window.electronAPI as unknown as ExportBridgeAPI | undefined;
}

async function runPreset(id: PresetId, api: ExportBridgeAPI): Promise<ApiResult> {
  switch (id) {
    case "wav-quick":
      return api.exportWav({ pcmData: [], sampleRate: 44100, channels: 1, suggestedName: "export-quick.wav" });
    case "wav-studio":
      return api.exportWav({ pcmData: [], sampleRate: 48000, channels: 2, suggestedName: "export-studio.wav" });
    case "wav-broadcast":
      return api.exportWav({ pcmData: [], sampleRate: 48000, channels: 2, suggestedName: "export-broadcast.wav" });
    case "bundle":
      return api.exportBundle({ stems: [], suggestedName: "synthstudio-bundle.zip" });
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ExportOutcome {
  type: "success" | "error";
  message: string;
}

/** Inline-Panel – keine Props, kein Prop-Drilling. */
export function ExportPresetsPanel() {
  const [busy, setBusy]           = useState<PresetId | null>(null);
  const [rendering, setRendering] = useState(false);
  const [outcome, setOutcome]     = useState<ExportOutcome | null>(null);
  const hideTimer                 = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup pending auto-hide timer on unmount
  useEffect(() => () => {
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
  }, []);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setOutcome(null), 4000);
  }, []);

  const handleExport = useCallback(async (presetId: PresetId) => {
    const api = getExportBridge();
    if (!api || busy !== null) return;

    setBusy(presetId);
    setOutcome(null);
    setRendering(false);

    // Show "Rendering…" only if the call takes > 300 ms
    const renderTimer = setTimeout(() => setRendering(true), 300);

    try {
      const result = await runPreset(presetId, api);
      clearTimeout(renderTimer);
      setRendering(false);

      if (result.canceled) {
        // User cancelled the native dialog – stay silent
      } else if (result.success && result.filePath) {
        setOutcome({ type: "success", message: `Gespeichert: ${result.filePath}` });
        scheduleHide();
      } else {
        setOutcome({ type: "error", message: `Fehler: ${result.error ?? "Unbekannter Fehler"}` });
        scheduleHide();
      }
    } catch (err) {
      clearTimeout(renderTimer);
      setRendering(false);
      const msg = err instanceof Error ? err.message : String(err);
      setOutcome({ type: "error", message: `Fehler: ${msg}` });
      scheduleHide();
    } finally {
      setBusy(null);
    }
  }, [busy, scheduleHide]);

  // ── No-electron fallback ──────────────────────────────────────────────────

  if (!getExportBridge()) {
    return (
      <div
        role="region"
        aria-label="Export-Presets"
        style={{
          padding: "16px",
          background: "var(--ss-bg-panel)",
          border: "1px solid var(--ss-border)",
          borderRadius: "8px",
          color: "var(--ss-text-muted)",
          fontSize: "13px",
          textAlign: "center",
        }}
      >
        Nur in der Desktop-App verfügbar
      </div>
    );
  }

  // ── Main panel ────────────────────────────────────────────────────────────

  return (
    <div
      role="region"
      aria-label="Export-Presets"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "12px",
        background: "var(--ss-bg-panel)",
        border: "1px solid var(--ss-border)",
        borderRadius: "8px",
      }}
    >
      {PRESETS.map((preset) => {
        const isBusy = busy === preset.id;
        return (
          <button
            key={preset.id}
            type="button"
            aria-label={preset.ariaLabel}
            aria-busy={isBusy}
            disabled={busy !== null}
            onClick={() => void handleExport(preset.id)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              padding: "10px 14px",
              background: isBusy ? "var(--ss-bg-elevated)" : "var(--ss-bg-base)",
              border: `1px solid ${isBusy ? "var(--ss-accent-primary)" : "var(--ss-border)"}`,
              borderRadius: "6px",
              color: busy !== null && !isBusy ? "var(--ss-text-dim)" : "var(--ss-text-primary)",
              cursor: busy !== null ? "not-allowed" : "pointer",
              opacity: busy !== null && !isBusy ? 0.55 : 1,
              textAlign: "left",
              transition: "border-color 0.15s, opacity 0.15s",
            }}
          >
            <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <span style={{ fontSize: "13px", fontWeight: 600 }}>
                {isBusy && rendering ? "Rendering…" : preset.label}
              </span>
              <span style={{ fontSize: "11px", color: "var(--ss-text-muted)" }}>
                {preset.description}
              </span>
            </span>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 700,
                letterSpacing: "0.05em",
                padding: "2px 7px",
                borderRadius: "4px",
                background: preset.badge === "ZIP"
                  ? "var(--ss-accent-secondary)"
                  : "var(--ss-accent-primary)",
                color: "var(--ss-bg-base)",
                flexShrink: 0,
              }}
            >
              {preset.badge}
            </span>
          </button>
        );
      })}

      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{
          minHeight: "20px",
          fontSize: "12px",
          padding: outcome ? "4px 2px" : "0",
          color: outcome?.type === "success"
            ? "var(--ss-accent-success)"
            : "var(--ss-accent-danger)",
          opacity: outcome ? 1 : 0,
          transition: "opacity 0.25s",
        }}
      >
        {outcome?.message ?? ""}
      </div>
    </div>
  );
}

