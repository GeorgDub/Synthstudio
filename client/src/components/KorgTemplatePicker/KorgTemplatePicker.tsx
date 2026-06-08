/**
 * Synthstudio — KorgTemplatePicker (v3.49.0)
 *
 * Modal-Picker für KORG-zentrierte Project-Templates. Zeigt die drei
 * verfügbaren Setups (E2 Studio / ESX Live / nanoKONTROL2 Mix) als Cards
 * und übergibt die User-Selection als applyKorgProjectTemplate-Call zurück
 * an den Caller (App.tsx).
 *
 * Reine Tailwind-Tokens, keine hardcoded Farben. Keine Electron-Aufrufe —
 * das ist ein purer UI-Picker.
 */
import { useEffect, useMemo, type ReactElement } from "react";
import { X, Mic, Disc, Sliders, type LucideIcon } from "lucide-react";
import {
  KORG_PROJECT_TEMPLATES,
  type KorgProjectTemplate,
  type KorgTemplateId,
} from "@/utils/korgProjectTemplates";

// ─── Icon Mapping ─────────────────────────────────────────────────────────────

const ICONS: Record<KorgProjectTemplate["icon"], LucideIcon> = {
  Mic,
  Disc,
  Sliders,
};

// ─── Props ────────────────────────────────────────────────────────────────────

export interface KorgTemplatePickerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Wird mit der gewählten Template-ID aufgerufen. Caller führt apply() aus. */
  onSelect: (id: KorgTemplateId) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function KorgTemplatePicker({
  isOpen,
  onClose,
  onSelect,
}: KorgTemplatePickerProps): ReactElement | null {
  // ESC schließt
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  const templates = useMemo(() => KORG_PROJECT_TEMPLATES, []);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg-base/80 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="korg-template-picker-title"
    >
      <div
        className="relative w-full max-w-4xl mx-4 bg-bg-panel border border-border-color rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border-color">
          <div>
            <h2
              id="korg-template-picker-title"
              className="text-lg font-semibold text-text-primary"
            >
              KORG Quick-Start Templates
            </h2>
            <p className="text-xs text-text-dim mt-0.5">
              Vorgefertigte Setups für KORG-Hardware. Klick auf "Use", um anzuwenden.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors"
            aria-label="Schließen"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Card-Grid */}
        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          {templates.map((tmpl) => (
            <KorgTemplateCard
              key={tmpl.id}
              template={tmpl}
              onUse={() => {
                onSelect(tmpl.id);
                onClose();
              }}
            />
          ))}
        </div>

        {/* Footer-Hint */}
        <div className="px-4 pb-4">
          <p className="text-[11px] text-text-dim">
            Hinweis: Templates überschreiben Pad-Bank und Scenes. Drum-Parts
            werden auf die Template-Anzahl gesetzt. Dein aktuelles Pattern
            bleibt unverändert.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function KorgTemplateCard({
  template,
  onUse,
}: {
  template: KorgProjectTemplate;
  onUse: () => void;
}): ReactElement {
  const Icon = ICONS[template.icon];

  return (
    <div className="flex flex-col p-4 rounded-lg border border-border-color bg-bg-elevated/40 hover:border-accent-primary/50 hover:bg-bg-elevated/60 transition-all">
      <div className="flex items-start gap-3 mb-2">
        <div className="p-2 rounded bg-accent-primary/15 text-accent-primary flex-shrink-0">
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-text-primary">
            {template.name}
          </h3>
          <p className="text-[11px] text-text-muted mt-0.5">{template.tagline}</p>
        </div>
      </div>

      <p className="text-xs text-text-dim mb-3 leading-relaxed">
        {template.description}
      </p>

      {/* Feature-Badges */}
      <div className="flex flex-wrap gap-1 mb-3">
        <Badge>{template.bpm} BPM</Badge>
        <Badge>{template.drumPartCount} Drum</Badge>
        {template.synthPartCount > 0 && <Badge>{template.synthPartCount} Synth</Badge>}
        {template.modifies.midiClockOut && <Badge>Clock-Out</Badge>}
        {template.modifies.midiNoteOut && <Badge>Note-Out</Badge>}
        {template.modifies.scenes && <Badge>{template.modifies.sceneCount} Scenes</Badge>}
        {template.modifies.padBank && <Badge>{template.modifies.padBankSlots} Pads</Badge>}
      </div>

      <button
        onClick={onUse}
        className="mt-auto px-3 py-2 rounded bg-accent-primary text-bg-base font-semibold text-xs hover:opacity-90 transition-opacity"
      >
        Use Template
      </button>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }): ReactElement {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-bg-base border border-border-subtle text-text-muted">
      {children}
    </span>
  );
}
