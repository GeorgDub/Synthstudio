/**
 * Synthstudio – ProLockBadge (TASK-232-FOLLOWUP-3, v2.98)
 *
 * Kleines Inline-Badge, das ein Lock-Icon mit Tooltip anzeigt, wenn ein
 * Pro-Feature für den aktuellen Lizenz-Status gesperrt ist. Während des
 * Trials und mit aktiver Pro-Lizenz wird nichts gerendert (returnt null).
 *
 * Wichtig:
 *  - Das Badge ist **nicht** klickbar und blockiert auch keinen Klick auf das
 *    darunterliegende UI-Element. Discovery bleibt erhalten — der eigentliche
 *    Klick auf den Pro-Button feuert dann `requireProFeature()` und zeigt
 *    einen kontextuellen Toast.
 *  - Nutzt ausschließlich semantische Tailwind-Tokens (text-text-dim etc.).
 *  - Re-rendert beim License-State-Wechsel automatisch via `useLicenseStore`.
 */
import { Lock } from "lucide-react";
import { isFeatureUnlocked, PRO_FEATURE_LABELS } from "@/utils/proFeatures";
import { useLicenseStore } from "@/store/useLicenseStore";

export interface ProLockBadgeProps {
  /** Pro-Feature-Konstante aus `proFeatures.ts` (z.B. PRO_FEATURE_STEM_BOUNCE). */
  feature: string;
  /** Optionaler className-Override für Layout-Spezialfälle. */
  className?: string;
  /** Optional: Tooltip-Text überschreiben (Default: "<Label> — Pro-Feature"). */
  title?: string;
  /** Icon-Größe in px (Default 12). */
  size?: number;
}

export function ProLockBadge({ feature, className, title, size = 12 }: ProLockBadgeProps) {
  // Subscribe — re-render sobald sich der License-Status ändert.
  useLicenseStore();

  if (isFeatureUnlocked(feature)) return null;

  const label = PRO_FEATURE_LABELS[feature] ?? feature;
  const tooltip = title ?? `${label} — Pro-Feature`;

  return (
    <span
      data-testid={`pro-lock-badge-${feature}`}
      role="img"
      aria-label={tooltip}
      title={tooltip}
      className={[
        "inline-flex items-center justify-center text-text-dim opacity-70",
        // pointer-events-none damit Klicks am Badge vorbei aufs Button-Underlay
        // gehen (Badge blockiert nichts — Toast erscheint beim Klick auf den
        // Button via requireProFeature).
        "pointer-events-none select-none",
        className ?? "",
      ].join(" ")}
    >
      <Lock size={size} aria-hidden="true" />
    </span>
  );
}

export default ProLockBadge;
