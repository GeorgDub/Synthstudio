/**
 * Synthstudio – PerformanceMonitor (v3.25.0)
 *
 * Live-Performance-Indikator. Zwei Render-Modes:
 *
 *  - "compact": kleiner Status-Dot + CPU%-Label in der Topbar.
 *               Klick öffnet Settings → "Performance" Section.
 *  - "expanded": detaillierte Panel-Ansicht (CPU%, Latency, Underruns,
 *                Glitch-Events) mit Reset-Button. Wird in der Settings
 *                Section rendered.
 *
 * Keine hardcoded Tailwind-Farben — alle Status-Colors über
 * semantische Tokens (bg-accent-success / bg-accent-secondary /
 * bg-accent-danger / text-text-* / border-border-color).
 */
import { useEffect } from "react";
import { Activity } from "lucide-react";
import {
  useAudioPerformance,
  resetPerformanceCounters,
  getPerformanceStatus,
  shouldFireWarning,
  type AudioPerformanceState,
} from "../../store/useAudioPerformanceStore";
import { toast } from "../../store/useToastStore";

interface CompactProps {
  mode: "compact";
  onOpenDetails?: () => void;
}

interface ExpandedProps {
  mode: "expanded";
}

export type PerformanceMonitorProps = CompactProps | ExpandedProps;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_DOT_CLASS: Record<"ok" | "warn" | "critical", string> = {
  ok: "bg-accent-success",
  warn: "bg-accent-secondary",
  critical: "bg-accent-danger",
};

const STATUS_TEXT_CLASS: Record<"ok" | "warn" | "critical", string> = {
  ok: "text-accent-success",
  warn: "text-accent-secondary",
  critical: "text-accent-danger",
};

const STATUS_LABEL: Record<"ok" | "warn" | "critical", string> = {
  ok: "OK",
  warn: "Warnung",
  critical: "Kritisch",
};

function formatLatency(ms: number): string {
  if (ms <= 0) return "—";
  if (ms < 10) return `${ms.toFixed(1)} ms`;
  return `${Math.round(ms)} ms`;
}

// ─── Warning-Dispatch ────────────────────────────────────────────────────────

/**
 * Pure-Helper: prüft anhand State + Last-Warning-Times ob Warnings gezeigt
 * werden sollen. Wird intern + im Test verwendet. Toast wird vom Caller
 * ausgelöst.
 */
export function pickWarning(
  state: AudioPerformanceState,
  prevState: AudioPerformanceState,
): "cpu-high" | "underrun" | null {
  // CPU > 90% länger als 3 sec → glitchEvents wuchs in den letzten 3+ ticks.
  // Wir nutzen ein einfaches Kriterium: glitchEvents stieg um >=3 seit prev.
  if (state.glitchEvents - prevState.glitchEvents >= 3) return "cpu-high";
  if (state.bufferUnderruns > prevState.bufferUnderruns) return "underrun";
  return null;
}

// ─── Compact-Mode ────────────────────────────────────────────────────────────

function CompactIndicator({ onOpenDetails }: { onOpenDetails?: () => void }) {
  const state = useAudioPerformance();
  const status = getPerformanceStatus(state);
  const dotCls = STATUS_DOT_CLASS[status];
  const cpu = Math.round(state.cpuPercent);

  // Warning-Dispatch via Toast (throttled). Wird nur ausgelöst wenn das
  // Compact-Indicator gerendert ist (= immer in Topbar).
  useEffect(() => {
    if (status === "critical" && shouldFireWarning("cpu-high")) {
      toast(`Hohe CPU-Last (${cpu}%) — Glitches möglich`, {
        kind: "warning",
        duration: 4000,
      });
    }
  }, [status, cpu]);

  useEffect(() => {
    if (state.bufferUnderruns > 0 && shouldFireWarning("underrun")) {
      toast(`Audio-Buffer-Underrun (Total: ${state.bufferUnderruns})`, {
        kind: "error",
        duration: 4000,
      });
    }
  }, [state.bufferUnderruns]);

  return (
    <button
      type="button"
      onClick={onOpenDetails}
      title={`Audio-Performance: ${STATUS_LABEL[status]} (${cpu}% CPU). Klicken für Details.`}
      data-testid="performance-monitor-compact"
      className="flex items-center gap-1.5 px-2 h-7 rounded text-xs bg-bg-elevated text-text-muted hover:bg-border-color hover:text-text-primary transition-colors duration-100"
    >
      <span
        className={`inline-block w-2 h-2 rounded-full ${dotCls}`}
        aria-hidden="true"
        data-testid="performance-monitor-dot"
        data-status={status}
      />
      <span className="tabular-nums">{cpu}%</span>
    </button>
  );
}

// ─── Expanded-Mode ───────────────────────────────────────────────────────────

function ExpandedPanel() {
  const state = useAudioPerformance();
  const status = getPerformanceStatus(state);

  return (
    <div
      className="space-y-4"
      data-testid="performance-monitor-expanded"
    >
      <div className="flex items-center gap-2 text-sm text-text-primary">
        <Activity className="w-4 h-4" aria-hidden="true" />
        <span>Audio-Performance</span>
      </div>

      {/* CPU-Bar */}
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-text-muted">CPU (Scheduler-Approx.)</span>
          <span
            className={`tabular-nums font-medium ${STATUS_TEXT_CLASS[status]}`}
            data-testid="performance-monitor-cpu"
          >
            {Math.round(state.cpuPercent)}%
          </span>
        </div>
        <div className="h-2 rounded bg-bg-elevated overflow-hidden">
          <div
            className={`h-full transition-all duration-200 ${STATUS_DOT_CLASS[status]}`}
            style={{ width: `${Math.min(100, Math.max(0, state.cpuPercent))}%` }}
            data-testid="performance-monitor-cpu-bar"
            data-status={status}
          />
        </div>
        <p className="text-[10px] text-text-dim mt-1">
          Web Audio bietet keinen direkten CPU-Zugriff — Approximation via
          Scheduler-Tick-Dauer.
        </p>
      </div>

      {/* Latency-Grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded border border-border-color bg-bg-panel p-3">
          <div className="text-[10px] uppercase tracking-wide text-text-dim">
            Base-Latency
          </div>
          <div
            className="text-base font-medium text-text-primary tabular-nums"
            data-testid="performance-monitor-base-latency"
          >
            {formatLatency(state.baseLatencyMs)}
          </div>
        </div>
        <div className="rounded border border-border-color bg-bg-panel p-3">
          <div className="text-[10px] uppercase tracking-wide text-text-dim">
            Output-Latency
          </div>
          <div
            className="text-base font-medium text-text-primary tabular-nums"
            data-testid="performance-monitor-output-latency"
          >
            {formatLatency(state.outputLatencyMs)}
          </div>
        </div>
        <div className="rounded border border-border-color bg-bg-panel p-3">
          <div className="text-[10px] uppercase tracking-wide text-text-dim">
            Underruns
          </div>
          <div
            className={`text-base font-medium tabular-nums ${state.bufferUnderruns > 0 ? "text-accent-danger" : "text-text-primary"}`}
            data-testid="performance-monitor-underruns"
          >
            {state.bufferUnderruns}
          </div>
        </div>
        <div className="rounded border border-border-color bg-bg-panel p-3">
          <div className="text-[10px] uppercase tracking-wide text-text-dim">
            Glitch-Events
          </div>
          <div
            className={`text-base font-medium tabular-nums ${state.glitchEvents > 0 ? "text-accent-secondary" : "text-text-primary"}`}
            data-testid="performance-monitor-glitches"
          >
            {state.glitchEvents}
          </div>
        </div>
      </div>

      {/* Last-Callback */}
      <div className="rounded border border-border-color bg-bg-panel p-3">
        <div className="text-[10px] uppercase tracking-wide text-text-dim">
          Letzter Scheduler-Tick
        </div>
        <div
          className="text-sm font-medium text-text-primary tabular-nums"
          data-testid="performance-monitor-callback-ms"
        >
          {state.audioCallbackMs.toFixed(2)} ms
        </div>
      </div>

      {/* Reset-Button */}
      <div>
        <button
          type="button"
          onClick={() => {
            resetPerformanceCounters();
            toast("Performance-Counter zurückgesetzt", { kind: "info", duration: 2000 });
          }}
          data-testid="performance-monitor-reset"
          className="px-3 h-8 rounded text-xs bg-bg-elevated text-text-muted hover:bg-border-color hover:text-text-primary transition-colors duration-100 border border-border-color"
        >
          Counter zurücksetzen
        </button>
      </div>
    </div>
  );
}

// ─── Public Component ────────────────────────────────────────────────────────

export function PerformanceMonitor(props: PerformanceMonitorProps) {
  if (props.mode === "compact") {
    return <CompactIndicator onOpenDetails={props.onOpenDetails} />;
  }
  return <ExpandedPanel />;
}
