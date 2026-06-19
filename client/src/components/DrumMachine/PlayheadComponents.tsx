import { memo } from "react";
import { usePlayheadStep } from "@/store/usePlayheadStore";
import type { PatternData } from "@/audio/AudioEngine";
import { PolyrhythmVisualizer } from "./PolyrhythmVisualizer";
import { ChannelStrip, type ChannelStripProps } from "./ChannelStrip";
import {
  stepGroupBorder,
  getPageCount,
  getPageStepRange,
  getPageForStep,
  getPageRangeLabel,
} from "./drumMachineHelpers";

// ─── TASK-247: Playhead-abonnierende Kind-Komponenten ─────────────────────────
// Diese kleinen Komponenten lesen den Playback-Step via usePlayheadStep() und
// re-rendern pro Step selbst — der 4495-Zeilen-DrumMachine-Parent bleibt stehen.

/** ChannelStrip-Wrapper, der currentStep selbst abonniert. */
export const PlayheadChannelStrip = memo(function PlayheadChannelStrip(
  props: Omit<ChannelStripProps, "currentStep">,
) {
  const currentStep = usePlayheadStep();
  return <ChannelStrip {...props} currentStep={currentStep} />;
});

/** PolyrhythmVisualizer-Wrapper, der currentStep selbst abonniert. */
export const PlayheadPolyrhythmVisualizer = memo(function PlayheadPolyrhythmVisualizer({
  pattern,
}: {
  pattern: PatternData;
}) {
  const currentStep = usePlayheadStep();
  return <PolyrhythmVisualizer pattern={pattern} currentStep={currentStep} />;
});

/** Page-Switcher mit Live-Page-Indikator (abonniert Playhead). */
export const PlayheadPageSwitcher = memo(function PlayheadPageSwitcher({
  stepCount,
  currentPatternPage,
  onSelectPage,
  isPlaying,
  autoPageFollow,
  onToggleAutoFollow,
}: {
  stepCount: number;
  currentPatternPage: number;
  onSelectPage: (p: number) => void;
  isPlaying: boolean;
  autoPageFollow: boolean;
  onToggleAutoFollow: () => void;
}) {
  const currentStep = usePlayheadStep();
  const pageCount = getPageCount(stepCount);
  if (pageCount <= 1) return null;
  const liveStepPage = getPageForStep(currentStep, stepCount);
  return (
    <div
      className="flex items-center gap-2 px-2 py-1 bg-bg-panel border-b border-border-color/50"
      data-testid="dm-page-switcher"
    >
      <span className="text-[10px] text-text-dim">Seite:</span>
      <div className="flex items-center gap-1">
        {Array.from({ length: pageCount }, (_, p) => {
          const isActive = currentPatternPage === p;
          const isLivePage = isPlaying && liveStepPage === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => onSelectPage(p)}
              data-testid={`dm-page-${p}`}
              title={`Steps ${getPageRangeLabel(p, stepCount)} (Page ${p + 1}/${pageCount})`}
              className={[
                "px-2 py-0.5 rounded text-[10px] font-mono transition-colors relative",
                isActive
                  ? "bg-accent-primary text-white"
                  : "bg-bg-elevated text-text-dim hover:text-text-primary ",
              ].join(" ")}
            >
              {getPageRangeLabel(p, stepCount)}
              {isLivePage && !isActive && (
                <span
                  className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full"
                  style={{ background: "var(--ss-accent-secondary)" }}
                />
              )}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onToggleAutoFollow}
        data-testid="dm-page-autofollow"
        title="Automatisch zur Page mit dem aktuellen Step springen während Playback"
        className={[
          "px-2 py-0.5 rounded text-[9px] font-mono transition-colors",
          autoPageFollow
            ? "bg-accent-secondary/30 text-accent-secondary"
            : "bg-bg-elevated text-text-dim hover:text-text-primary",
        ].join(" ")}
      >
        {autoPageFollow ? "Auto-Follow: AN" : "Auto-Follow: AUS"}
      </button>
      <span className="text-[9px] text-text-dim ml-auto">
        {stepCount} Steps / {pageCount} Pages
      </span>
    </div>
  );
});

/** Step-Nummern-Header-Zeile mit Playhead-Highlight (abonniert Playhead). */
export const PlayheadStepNumberRow = memo(function PlayheadStepNumberRow({
  stepCount,
  currentPatternPage,
}: {
  stepCount: number;
  currentPatternPage: number;
}) {
  const currentStep = usePlayheadStep();
  const { start, end } = getPageStepRange(stepCount, currentPatternPage);
  return (
    <>
      {Array.from({ length: end - start }).map((_, idx) => {
        const i = start + idx;
        return (
          <div
            key={i}
            className={[
              "flex-1 text-center text-[8px] leading-none py-0.5 relative",
              stepGroupBorder(idx, end - start),
              i === currentStep ? "font-bold" : "text-text-dim",
              i % 4 === 0 ? "text-text-dim" : "",
            ].join(" ")}
            style={{ color: i === currentStep ? "var(--ss-accent-secondary)" : undefined }}
          >
            {i % 4 === 0 ? i + 1 : "·"}
            {i === currentStep && (
              <div
                className="absolute bottom-0 left-0 right-0 rounded-full"
                style={{ height: 2, background: "var(--ss-accent-secondary)" }}
              />
            )}
          </div>
        );
      })}
    </>
  );
});

/** Footer-Step-Anzeige "Step X/Y" (abonniert Playhead). */
export const PlayheadFooterStep = memo(function PlayheadFooterStep({
  stepCount,
}: {
  stepCount: number;
}) {
  const currentStep = usePlayheadStep();
  return (
    <span>
      Step {currentStep + 1}/{stepCount}
    </span>
  );
});
