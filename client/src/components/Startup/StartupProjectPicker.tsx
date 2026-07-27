/**
 * StartupProjectPicker.tsx — Startbildschirm-Auswahl (v3.292).
 *
 * Beim Programmstart ist zunächst nichts geladen; der User wählt hier, ob er ein
 * neues Projekt anlegt, ein vorhandenes lädt oder das zuletzt geöffnete öffnet.
 * Rein präsentationell — alle Aktionen kommen als Props aus App.tsx.
 *
 * Nur semantische Theme-Klassen (bg-bg-*, text-text-*, border-border-color …),
 * damit der Dialog auf alle Themes reagiert.
 */

import React from "react";

export interface StartupProjectPickerProps {
  open: boolean;
  /** Name des letzten Projekts (oder null → „Letztes öffnen" ausgeblendet). */
  lastProjectName: string | null;
  onNew: () => void;
  onOpen: () => void;
  onOpenLast: () => void;
  /** Ohne Auswahl schließen → leer starten (nichts geladen). */
  onClose: () => void;
}

export function StartupProjectPicker({
  open,
  lastProjectName,
  onNew,
  onOpen,
  onOpenLast,
  onClose,
}: StartupProjectPickerProps): React.ReactElement | null {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      data-testid="startup-picker"
      role="dialog"
      aria-modal="true"
      aria-label="Projekt-Auswahl beim Start"
    >
      <div className="w-[min(92vw,460px)] rounded-2xl border border-border-color bg-bg-panel shadow-2xl">
        <div className="px-6 pt-6 pb-4 text-center">
          <div className="text-2xl font-semibold text-text-primary">
            Synthstudio
          </div>
          <div className="mt-1 text-sm text-text-muted">
            Womit möchtest du starten?
          </div>
        </div>

        <div className="flex flex-col gap-2 px-5 pb-5">
          {lastProjectName && (
            <button
              type="button"
              onClick={onOpenLast}
              data-testid="startup-open-last"
              className="flex items-center gap-3 rounded-xl border border-border-color bg-bg-elevated px-4 py-3 text-left transition-colors hover:border-accent-primary"
            >
              <span className="text-xl" aria-hidden>
                🕒
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text-primary">
                  Letztes Projekt öffnen
                </span>
                <span className="block truncate text-xs text-text-muted">
                  {lastProjectName}
                </span>
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={onNew}
            data-testid="startup-new"
            className="flex items-center gap-3 rounded-xl border border-border-color bg-bg-elevated px-4 py-3 text-left transition-colors hover:border-accent-primary"
          >
            <span className="text-xl" aria-hidden>
              ✨
            </span>
            <span>
              <span className="block text-sm font-medium text-text-primary">
                Neues Projekt
              </span>
              <span className="block text-xs text-text-muted">
                Leeres Projekt anlegen
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={onOpen}
            data-testid="startup-open"
            className="flex items-center gap-3 rounded-xl border border-border-color bg-bg-elevated px-4 py-3 text-left transition-colors hover:border-accent-primary"
          >
            <span className="text-xl" aria-hidden>
              📂
            </span>
            <span>
              <span className="block text-sm font-medium text-text-primary">
                Projekt laden
              </span>
              <span className="block text-xs text-text-muted">
                Eine .synth-Datei öffnen
              </span>
            </span>
          </button>
        </div>

        <div className="border-t border-border-color px-5 py-3 text-center">
          <button
            type="button"
            onClick={onClose}
            data-testid="startup-close"
            className="text-xs text-text-dim transition-colors hover:text-text-primary"
          >
            Leer starten
          </button>
        </div>
      </div>
    </div>
  );
}
