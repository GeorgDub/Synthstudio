/**
 * Synthstudio – WelcomeWizard (v3.22.0)
 *
 * First-Run-Tutorial. Zeigt 6 Slides, die die Killer-Features der letzten
 * 42 Releases vorstellen (KORG-Integration, Live-Performance, Sample-Workflow,
 * OmniTribe-Hardware). Erscheint automatisch wenn `shouldAutoShowWelcome()`
 * true ist UND der User noch nicht "Don't show again" angeklickt hat.
 *
 * Manuell reopen via SettingsPanel → "Über" → "Welcome-Tour erneut anzeigen".
 *
 * "Try it now"-Buttons dispatchen einen CustomEvent (siehe
 * dispatchWelcomeTryIt in useWelcomeStore.ts). App.tsx hört darauf und
 * routet — z.B. öffnet Settings, switcht Tabs, scrollt zu Sections.
 *
 * Pure-Tailwind mit semantischen Tokens — keine hardcoded Farben.
 */
import { useEffect, useState, type ReactElement } from "react";
import {
  X,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Cable,
  Mic,
  Scissors,
  Cpu,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import {
  dismissWelcomeWizard,
  markFirstRunComplete,
  dispatchWelcomeTryIt,
  type WelcomeTryItTarget,
} from "@/store/useWelcomeStore";

export interface WelcomeWizardProps {
  /** Steuert Sichtbarkeit. Wenn false → render nichts. */
  open: boolean;
  /**
   * Wird gerufen wenn der User Skip / Close / "Got it!" klickt. Der Wizard
   * markiert intern firstRun=false; "Don't show again" zusätzlich
   * dismissed=true. Der Parent (App.tsx) sollte open=false setzen.
   */
  onClose: () => void;
  /** Override für die App-Version im Header-Subtitle. Default: VERSION_STRING. */
  versionString?: string;
  /**
   * Override für die Slides — primär für Tests / Storybook. Default sind
   * die 6 eingebauten Synthstudio-Slides.
   */
  slides?: WizardSlide[];
}

export interface WizardSlideAction {
  /** Beschriftung des "Try it now"-Buttons. */
  label: string;
  /** CustomEvent-Target — dispatchet auf window.synthstudio:welcome:try-it. */
  target: WelcomeTryItTarget;
}

export interface WizardSlide {
  id: string;
  Icon: LucideIcon;
  title: string;
  body: string;
  bullets?: string[];
  action?: WizardSlideAction;
}

const VERSION_STRING = "v3.22.0";

const DEFAULT_SLIDES: WizardSlide[] = [
  {
    id: "welcome",
    Icon: Sparkles,
    title: "Willkommen bei Synthstudio",
    body:
      "Professionelles Audio-Studio mit Drum-Machine, Synth, Piano-Roll, Mixer und Sample-Manager — als Web-App und als native Desktop-App.",
    bullets: [
      "Über 40 Releases mit Hunderten Features",
      "Voll isomorph: Browser ↔ Electron",
      "MIDI-Learn auf jedem Knopf (Rechtsklick)",
    ],
  },
  {
    id: "korg",
    Icon: Cable,
    title: "KORG-Hardware Integration",
    body:
      "Synthstudio spricht nativ mit KORG Electribe/nanoKONTROL2 — inklusive bit-exaktem Bank-Import und Export.",
    bullets: [
      "nanoKONTROL2 mit LED-Feedback",
      "Electribe USB-Audio + Pattern-Import",
      "E2S .all Bank-Editor mit Slice-Audition",
    ],
    action: { label: "MIDI-Settings öffnen", target: "midi-settings" },
  },
  {
    id: "performance",
    Icon: Mic,
    title: "Live-Performance",
    body:
      "Aufnehmen, loopen, Scenes umschalten — alles ohne den Flow zu unterbrechen.",
    bullets: [
      "Session-Recording inkl. Pattern-Wechsel",
      "Live-Looper mit Quantize",
      "Scene-Launch via Shift+1-8",
    ],
    action: { label: "Scene-Pad zeigen", target: "scene-launch" },
  },
  {
    id: "samples",
    Icon: Scissors,
    title: "Sample-Workflow",
    body:
      "Vom WAV bis zum fertigen KORG-Bank-Export — Onset-Detection, Slicing und Pad-Bank in einem Tool.",
    bullets: [
      "Transient-basiertes Auto-Slicing",
      "Custom Pad-Bank pro Projekt",
      "KORG E2S Bank-Export (.all)",
    ],
    action: { label: "KORG-Bank-Editor öffnen", target: "korg-bank-editor" },
  },
  {
    id: "omnitribe",
    Icon: Cpu,
    title: "OmniTribe (Custom Hardware)",
    body:
      "Wenn du den OmniTribe nutzt: VU-Meter, Spectrum-Analyzer, Chord-Modul und 16-Pad Performance-Grid sind out-of-the-box gewired.",
    bullets: [
      "Echo-Schutz für 60-Hz-Sweeps",
      "Wavetable + Granular Sysex-Upload",
      "User-Chord-Slots beschreibbar",
    ],
    action: { label: "Device-Settings", target: "midi-settings" },
  },
  {
    id: "done",
    Icon: CheckCircle2,
    title: "Du bist startklar",
    body:
      "Du kannst diese Tour jederzeit unter Settings → Über erneut öffnen. Viel Spaß beim Beats bauen!",
    bullets: [
      "Settings: Themes, MIDI, Audio-Engine",
      "Hardware-Templates für 13+ Controller",
      "Rechtsklick auf Knöpfe → MIDI-Learn",
    ],
    action: { label: "Settings öffnen", target: "settings" },
  },
];

export function WelcomeWizard({
  open,
  onClose,
  versionString = VERSION_STRING,
  slides = DEFAULT_SLIDES,
}: WelcomeWizardProps): ReactElement | null {
  const [index, setIndex] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  // Reset slide-pointer bei jedem open=true → false-Übergang.
  useEffect(() => {
    if (open) {
      setIndex(0);
      setDontShowAgain(false);
    }
  }, [open]);

  // ESC schließt den Wizard.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finishAndClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dontShowAgain]);

  if (!open) return null;

  const safeSlides = slides.length > 0 ? slides : DEFAULT_SLIDES;
  const safeIndex = Math.max(0, Math.min(index, safeSlides.length - 1));
  const slide = safeSlides[safeIndex];
  const isLast = safeIndex === safeSlides.length - 1;
  const isFirst = safeIndex === 0;

  function finishAndClose(): void {
    if (dontShowAgain) {
      dismissWelcomeWizard();
    } else {
      markFirstRunComplete();
    }
    onClose();
  }

  function handleNext(): void {
    if (isLast) {
      finishAndClose();
      return;
    }
    setIndex((i) => Math.min(i + 1, safeSlides.length - 1));
  }

  function handleBack(): void {
    if (isFirst) return;
    setIndex((i) => Math.max(i - 1, 0));
  }

  function handleTryItNow(): void {
    if (!slide.action) return;
    dispatchWelcomeTryIt(slide.action.target);
    // Tour beenden, damit der User direkt mit dem aufgerufenen UI arbeiten kann.
    finishAndClose();
  }

  const SlideIcon = slide.Icon;

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome-Tour"
      data-testid="welcome-wizard"
      onClick={(e) => {
        // Klick auf Backdrop schließt
        if (e.target === e.currentTarget) finishAndClose();
      }}
    >
      <div
        className="relative w-full max-w-lg mx-4 rounded-xl border border-border-color bg-bg-panel p-6 shadow-2xl"
        data-testid="welcome-wizard-panel"
      >
        {/* Header: Icon + Title + Close-Button */}
        <div className="flex items-start gap-3 mb-4">
          <div className="rounded-full bg-accent-primary/20 p-2.5 text-accent-primary flex-shrink-0">
            <SlideIcon size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <h2
              className="text-lg font-semibold text-text-primary leading-tight"
              data-testid="welcome-wizard-title"
            >
              {slide.title}
            </h2>
            <p className="text-[11px] text-text-dim mt-0.5">
              {versionString} — Slide {safeIndex + 1} / {safeSlides.length}
            </p>
          </div>
          <button
            type="button"
            onClick={finishAndClose}
            className="text-text-muted hover:text-text-primary p-1 -mr-1 -mt-1 rounded transition-colors"
            aria-label="Schließen"
            data-testid="welcome-wizard-skip"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div
          className="text-sm text-text-muted leading-relaxed transition-opacity duration-200"
          data-testid="welcome-wizard-body"
        >
          <p>{slide.body}</p>
          {slide.bullets && slide.bullets.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {slide.bullets.map((b, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-text-primary text-[13px]"
                >
                  <span
                    className="mt-1.5 h-1.5 w-1.5 rounded-full bg-accent-primary flex-shrink-0"
                    aria-hidden="true"
                  />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Try-it-now action */}
        {slide.action && (
          <button
            type="button"
            onClick={handleTryItNow}
            className="mt-4 w-full rounded border border-accent-primary bg-accent-primary/10 px-3 py-2 text-xs font-medium text-accent-primary hover:bg-accent-primary/20 transition-colors"
            data-testid="welcome-wizard-try-it"
            data-target={slide.action.target}
          >
            → {slide.action.label}
          </button>
        )}

        {/* Progress-Dots */}
        <div
          className="mt-5 flex items-center justify-center gap-1.5"
          aria-label={`Fortschritt: ${safeIndex + 1} von ${safeSlides.length}`}
          data-testid="welcome-wizard-progress"
        >
          {safeSlides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setIndex(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === safeIndex
                  ? "w-6 bg-accent-primary"
                  : "w-1.5 bg-bg-elevated hover:bg-border-color"
              }`}
              aria-label={`Zu Slide ${i + 1} springen`}
              data-testid={`welcome-wizard-dot-${i}`}
            />
          ))}
        </div>

        {/* Footer: Back / Skip / Next */}
        <div className="mt-5 flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer select-none flex-1 min-w-0">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="accent-accent-primary"
              data-testid="welcome-wizard-dont-show"
            />
            <span className="truncate">Nicht mehr anzeigen</span>
          </label>

          <button
            type="button"
            onClick={handleBack}
            disabled={isFirst}
            className="rounded border border-border-color bg-bg-elevated px-3 py-1.5 text-xs text-text-primary hover:bg-bg-base disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
            data-testid="welcome-wizard-back"
          >
            <ChevronLeft size={14} />
            Zurück
          </button>

          <button
            type="button"
            onClick={handleNext}
            className="rounded bg-accent-primary px-4 py-1.5 text-xs font-medium text-bg-base hover:opacity-90 transition-opacity flex items-center gap-1"
            data-testid="welcome-wizard-next"
          >
            {isLast ? "Los geht's" : "Weiter"}
            {!isLast && <ChevronRight size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}
