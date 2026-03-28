/**
 * Synthstudio – NewProjectDialog
 *
 * Dialog zum Erstellen eines neuen Projekts mit Template-Auswahl.
 * Zeigt alle verfügbaren Projekt-Templates mit Vorschau an.
 *
 * ─── GOLDENES GESETZ ─────────────────────────────────────────────────────────
 * Alle Electron-Aufrufe gehen ausschließlich über den useElectron()-Hook.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useState, useCallback } from "react";
import { PROJECT_TEMPLATES, type ProjectTemplate, templateToProjectState } from "../../store/projectTemplates";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface NewProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateProject: (state: ReturnType<typeof templateToProjectState>) => void;
}

// ─── Template-Karte ───────────────────────────────────────────────────────────

function TemplateCard({
  template,
  isSelected,
  onClick,
}: {
  template: ProjectTemplate;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left p-3 rounded-lg border transition-all duration-150
        ${isSelected
          ? "border-cyan-600 bg-cyan-900/20 ring-1 ring-cyan-600/50"
          : "border-slate-700 bg-slate-800/40 hover:border-slate-600 hover:bg-slate-800/60"
        }
      `}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl flex-shrink-0">{template.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-slate-200 truncate">{template.name}</p>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: `${template.accentColor}20`, color: template.accentColor, border: `1px solid ${template.accentColor}40` }}
            >
              {template.genre}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{template.description}</p>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="text-[10px] text-slate-600">{template.bpm} BPM</span>
            <span className="text-[10px] text-slate-600">
              {template.timeSignatureNumerator}/{template.timeSignatureDenominator}
            </span>
            <span className="text-[10px] text-slate-600">
              {template.tracks.length} Tracks
            </span>
            {template.tracks.some((t) => t.steps.length > 0) && (
              <span className="text-[10px] text-slate-600">
                {template.tracks.reduce((sum, t) => sum + t.steps.length, 0)} Steps
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Pattern-Vorschau */}
      {template.tracks.some((t) => t.steps.length > 0) && (
        <div className="mt-2 flex flex-col gap-0.5">
          {template.tracks.slice(0, 4).map((track) => (
            <div key={track.id} className="flex items-center gap-1">
              <span className="text-[9px] text-slate-600 w-12 truncate">{track.name}</span>
              <div className="flex gap-px">
                {Array.from({ length: template.stepsPerPattern }).map((_, i) => {
                  const step = track.steps.find((s) => s.step === i);
                  return (
                    <div
                      key={i}
                      className={`w-2 h-2 rounded-sm ${
                        step
                          ? "opacity-100"
                          : "bg-slate-800 opacity-50"
                      }`}
                      style={step ? { backgroundColor: template.accentColor, opacity: step.velocity / 127 } : {}}
                    />
                  );
                })}
              </div>
            </div>
          ))}
          {template.tracks.length > 4 && (
            <p className="text-[9px] text-slate-700 pl-14">
              +{template.tracks.length - 4} weitere Tracks
            </p>
          )}
        </div>
      )}
    </button>
  );
}

// ─── Hauptkomponente ──────────────────────────────────────────────────────────

export function NewProjectDialog({ isOpen, onClose, onCreateProject }: NewProjectDialogProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("blank");
  const [projectName, setProjectName] = useState<string>("");

  const selectedTemplate = PROJECT_TEMPLATES.find((t) => t.id === selectedTemplateId) ?? PROJECT_TEMPLATES[0];

  const handleCreate = useCallback(() => {
    const state = templateToProjectState(selectedTemplate);
    if (projectName.trim()) {
      state.projectName = projectName.trim();
    }
    onCreateProject(state);
    onClose();
    // State zurücksetzen
    setSelectedTemplateId("blank");
    setProjectName("");
  }, [selectedTemplate, projectName, onCreateProject, onClose]);

  const handleTemplateSelect = useCallback((id: string) => {
    setSelectedTemplateId(id);
    const template = PROJECT_TEMPLATES.find((t) => t.id === id);
    if (template && template.id !== "blank") {
      setProjectName(template.name);
    } else {
      setProjectName("");
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-2xl max-h-[85vh] flex flex-col bg-[#111] border border-slate-700 rounded-xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h2 className="text-base font-semibold text-slate-200">Neues Projekt</h2>
          <button
            onClick={onClose}
            className="text-slate-600 hover:text-slate-400 transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Inhalt */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* Projekt-Name */}
          <div className="mb-5">
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Projekt-Name
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder={selectedTemplate.name}
              className="w-full bg-[#0d0d0d] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-700 transition-colors"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>

          {/* Template-Auswahl */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">
              Template auswählen
            </label>
            <div className="grid grid-cols-1 gap-2">
              {PROJECT_TEMPLATES.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  isSelected={selectedTemplateId === template.id}
                  onClick={() => handleTemplateSelect(template.id)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-800 bg-[#0d0d0d]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-slate-300 transition-colors"
          >
            Abbrechen
          </button>
          <button
            onClick={handleCreate}
            className="px-4 py-2 text-sm rounded-lg bg-cyan-700 text-white border border-cyan-600 hover:bg-cyan-600 transition-colors font-medium"
          >
            Projekt erstellen
          </button>
        </div>
      </div>
    </div>
  );
}

export default NewProjectDialog;
