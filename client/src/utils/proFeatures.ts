/**
 * Synthstudio – Pro-Feature Registry (TASK-232, v2.97)
 *
 * Central list of features that require a Pro license (or an active 30-day
 * trial). Components check `isFeatureUnlocked(...)` before performing the
 * Pro action — UI may still render the entry-point (with a lock badge) so
 * users discover what's behind the paywall.
 *
 * Free-mode policy:
 *   - In the 30-day trial: **everything** unlocked.
 *   - After the trial (or never-activated permanent-free user): only the
 *     base DAW (drum-machine, mixer, sample-manager) is usable.
 *
 * To add a new gated feature:
 *   1. Add a `PRO_FEATURE_*` const here.
 *   2. Add the const to `PRO_FEATURES` (full list).
 *   3. Add the user-facing label to `PRO_FEATURE_LABELS`.
 *   4. Call `requireProFeature(...)` at the entry point of the feature.
 */
import { isPro, getLicenseState } from "@/store/useLicenseStore";
import { toast } from "@/store/useToastStore";
import { GUMROAD_PRODUCT_URL } from "@/utils/licenseConfig";

// ─── Pro-Feature constants ────────────────────────────────────────────────────

export const PRO_FEATURE_LIVE_LOOPING       = "live-looping";
export const PRO_FEATURE_USB_AUDIO_IN       = "usb-audio-in";
export const PRO_FEATURE_STEM_BOUNCE        = "stem-bounce";
export const PRO_FEATURE_ELECTRIBE_IMPORT   = "electribe-import";
export const PRO_FEATURE_MIDI_NOTE_OUT      = "midi-note-out";
export const PRO_FEATURE_KORG_BANK_IMPORT   = "korg-bank-import";
export const PRO_FEATURE_KORG_BANK_WRITE    = "korg-bank-write";
export const PRO_FEATURE_E2_PATTERN_EXPORT  = "e2-pattern-export";

/** Full registry — keep in sync with constants above. */
export const PRO_FEATURES = [
  PRO_FEATURE_LIVE_LOOPING,
  PRO_FEATURE_USB_AUDIO_IN,
  PRO_FEATURE_STEM_BOUNCE,
  PRO_FEATURE_ELECTRIBE_IMPORT,
  PRO_FEATURE_MIDI_NOTE_OUT,
  PRO_FEATURE_KORG_BANK_IMPORT,
  PRO_FEATURE_KORG_BANK_WRITE,
  PRO_FEATURE_E2_PATTERN_EXPORT,
] as const;

export type ProFeature = (typeof PRO_FEATURES)[number];

/** Human-readable labels used in toasts + tooltips. */
export const PRO_FEATURE_LABELS: Record<string, string> = {
  [PRO_FEATURE_LIVE_LOOPING]:     "Live-Looping",
  [PRO_FEATURE_USB_AUDIO_IN]:     "USB-Audio-Eingang",
  [PRO_FEATURE_STEM_BOUNCE]:      "Stem-Bounce",
  [PRO_FEATURE_ELECTRIBE_IMPORT]: "Electribe-Import",
  [PRO_FEATURE_MIDI_NOTE_OUT]:    "MIDI-Note-Out",
  [PRO_FEATURE_KORG_BANK_IMPORT]: "KORG Sample-Bank-Import",
  [PRO_FEATURE_KORG_BANK_WRITE]:  "KORG Sample-Bank-Export (E2S .all)",
  [PRO_FEATURE_E2_PATTERN_EXPORT]: "KORG E2 Pattern-Export (.e2spat)",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true if the user may use the given Pro-feature right now.
 *
 * `unknownFeature` defaults to `false` — unknown strings are treated as
 * gated. Pass `true` for transitional code that needs to allow rollouts.
 */
export function isFeatureUnlocked(feature: string, unknownFeature: boolean = false): boolean {
  if (!PRO_FEATURES.includes(feature as ProFeature)) return unknownFeature;
  return isPro();
}

/**
 * Convenience wrapper used at feature entry-points: returns true if the user
 * is allowed, otherwise shows a toast + returns false. Components can call
 *
 *   if (!requireProFeature(PRO_FEATURE_STEM_BOUNCE)) return;
 *
 * and let the helper handle the user feedback.
 */
export function requireProFeature(feature: ProFeature): boolean {
  if (isFeatureUnlocked(feature)) return true;
  const label = PRO_FEATURE_LABELS[feature] ?? feature;
  const state = getLicenseState();
  const message =
    state.status === "expired"
      ? `${label} ist ein Pro-Feature — dein 30-Tage-Trial ist abgelaufen.`
      : `${label} ist ein Pro-Feature — bitte aktiviere eine Lizenz.`;
  toast(message, {
    kind: "warning",
    duration: 6000,
    action: {
      label: "Lizenz kaufen",
      onClick: () => {
        try {
          if (typeof window !== "undefined") window.open(GUMROAD_PRODUCT_URL, "_blank");
        } catch { /* */ }
      },
    },
  });
  return false;
}
