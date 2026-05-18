/**
 * OmniTribeVuMeter — 16 vertikale Bars für VU-Stream vom OmniTribe-Geraet.
 *
 * Datenfluss:
 *   Bridge VU-Frame (Stream 0x02) → window-Event "omnitribe:vuMeter"
 *   → App.tsx Listener → setOmniTribeVuLevels(levels)
 *   → useOmniTribeMeters() rerendert diese Komponente.
 *
 * Performance:
 *   - VU kommt @ ~60 Hz. Wir nutzen direkten Hook-rerender (Diff-vor-notify
 *     im Store verhindert Idle-Re-Renders).
 *   - Bar-Height/Color als inline-Style (vermeidet TailwindJIT-Misses).
 *   - Color-Klassen sind semantisch (--ss-accent-success/secondary/danger).
 *
 * Mount-Position: OmniTribe-Tool-Tab.
 */

import { useMemo, type ReactElement } from "react";
import { useOmniTribeMeters, OMNITRIBE_VU_CHANNELS } from "../../store/useOmniTribeMetersStore";

export interface OmniTribeVuMeterProps {
  /** Maximalhöhe einer Bar in Pixel. Default 120. */
  maxHeightPx?: number;
  /** Anzeige auch ohne Connection (zeigt nur graue Bars). Default true. */
  showWhenDisconnected?: boolean;
  /** isConnected-Flag — disabled-Style wenn false. */
  connected?: boolean;
}

const SUCCESS_THRESHOLD = 0.7;   // < 70 %  → grün
const WARNING_THRESHOLD = 0.9;   // 70–90 % → gelb (text-accent-secondary)
                                  // > 90 % → rot (text-accent-danger)

export function OmniTribeVuMeter({
  maxHeightPx = 120,
  showWhenDisconnected = true,
  connected = true,
}: OmniTribeVuMeterProps): ReactElement | null {
  const { vuLevels } = useOmniTribeMeters();

  // Optional: hide gänzlich wenn disconnected + Caller will das nicht.
  if (!connected && !showWhenDisconnected) return null;

  // Bar-Indices als stabile Liste (kein useMemo-Bottleneck).
  const indices = useMemo(
    () => Array.from({ length: OMNITRIBE_VU_CHANNELS }, (_, i) => i),
    [],
  );

  return (
    <div
      className="bg-bg-panel border border-border-color rounded p-3"
      data-testid="omnitribe-vu-meter"
      aria-label="OmniTribe VU-Meter (16 Channels)"
    >
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs uppercase tracking-wide text-text-muted font-semibold">
          VU-Meter
        </h4>
        <span
          className={[
            "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded",
            connected
              ? "bg-accent-success/15 text-accent-success"
              : "bg-bg-elevated text-text-dim",
          ].join(" ")}
        >
          {connected ? "Live" : "Disconnected"}
        </span>
      </div>

      <div
        className="flex items-end gap-1"
        style={{ height: `${maxHeightPx}px` }}
        role="group"
        aria-roledescription="16-channel VU meter"
      >
        {indices.map((i) => {
          const level = vuLevels[i] ?? 0;
          const norm  = Math.min(1, Math.max(0, level / 127));
          const heightPx = Math.round(norm * maxHeightPx);
          const colorClass =
            norm > WARNING_THRESHOLD
              ? "bg-accent-danger"
              : norm > SUCCESS_THRESHOLD
              ? "bg-accent-secondary"
              : "bg-accent-success";

          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-center justify-end"
              data-testid={`omnitribe-vu-bar-${i}`}
              data-level={level}
              title={`Ch ${i + 1}: ${level}/127`}
            >
              <div
                className={[
                  "w-full rounded-t transition-[height] duration-75",
                  connected ? colorClass : "bg-bg-elevated",
                ].join(" ")}
                style={{ height: `${heightPx}px` }}
                aria-label={`Channel ${i + 1} level ${level}`}
              />
              <span className="text-[9px] text-text-dim mt-1">{i + 1}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default OmniTribeVuMeter;
