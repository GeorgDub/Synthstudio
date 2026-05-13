/**
 * Synthstudio – AiScriptGeneratorDialog (post-v1.24.0 ROADMAP feature)
 *
 * Modal-Dialog im ScriptRunner: Prompt → Anthropic-API → Preview → Save.
 *
 * Flow:
 *   1. User öffnet via "✨ KI-Generator"-Button im ScriptRunner-Header
 *   2. Prompt eintippen (z.B. "Rampe BPM von 100 auf 140 in 4s")
 *   3. "Generieren" → API-Call mit ss.*-System-Prompt
 *   4. Preview: read-only Code + Byte-Count + Status
 *   5. "Als neues Script speichern" → addScript() + dialog close
 *
 * Voraussetzung: Anthropic-API-Key in Settings → KI & API.
 */
import { useCallback, useEffect, useState } from "react";
import { X, Sparkles } from "lucide-react";
import { useApiSettingsStore } from "@/store/useApiSettingsStore";
import {
  generateScriptFromPrompt,
  type AiScriptGenerationResult,
} from "@/utils/aiScriptGenerator";

export interface AiScriptGeneratorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Wird mit dem generierten Code aufgerufen wenn der User auf "Speichern"
   * klickt. Parent (ScriptRunner) sollte addScript() aufrufen und das neue
   * Script auswählen.
   */
  onAccept: (code: string, suggestedName: string) => void;
}

export function AiScriptGeneratorDialog({
  isOpen,
  onClose,
  onAccept,
}: AiScriptGeneratorDialogProps) {
  const api = useApiSettingsStore();
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<AiScriptGenerationResult | null>(null);

  const hasApiKey = api.anthropicApiKey.length > 0;

  // Reset state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setPrompt("");
      setResult(null);
      setGenerating(false);
    }
  }, [isOpen]);

  // ESC zum Schließen
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  const handleGenerate = useCallback(async () => {
    if (!hasApiKey || !prompt.trim()) return;
    setGenerating(true);
    setResult(null);
    const res = await generateScriptFromPrompt(prompt, api.anthropicApiKey, api.aiModel);
    setResult(res);
    setGenerating(false);
  }, [prompt, api.anthropicApiKey, api.aiModel, hasApiKey]);

  const handleAccept = useCallback(() => {
    if (!result?.ok || !result.code) return;
    // Suggested name: erste 40 Zeichen des Prompts als Script-Name
    const suggestedName = `KI: ${prompt.trim().slice(0, 40)}${prompt.length > 40 ? "…" : ""}`;
    onAccept(result.code, suggestedName);
    onClose();
  }, [result, prompt, onAccept, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg-base/80 backdrop-blur-sm"
      data-testid="ai-script-generator-dialog"
      onClick={onClose}
    >
      <div
        className="bg-bg-panel border border-border-color rounded-lg shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-color">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-accent-secondary" />
            <h3 className="text-sm font-bold text-text-primary">KI Script-Generator</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="text-text-dim hover:text-text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!hasApiKey && (
            <div className="px-3 py-2 rounded border border-accent-danger/50 bg-accent-danger/10 text-xs text-accent-danger">
              Anthropic API-Key fehlt. Setze ihn in Settings → KI & API.
            </div>
          )}

          {/* Prompt */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              Was soll das Script tun?
            </label>
            <textarea
              data-testid="ai-script-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="z.B. Rampe BPM von 100 auf 140 in 4 Sekunden. Logge jeden Schritt."
              disabled={generating || !hasApiKey}
              rows={3}
              className="w-full px-3 py-2 text-xs rounded border border-border-color bg-bg-elevated text-text-primary placeholder-text-dim focus:outline-none focus:border-accent-primary disabled:opacity-50"
            />
            <p className="text-[10px] text-text-dim mt-1">
              Nutzt das aktuelle KI-Modell aus Settings (
              <span className="font-mono">{api.aiModel || "—"}</span>) — generiert ss.*-API-konformen Code.
            </p>
          </div>

          {/* Generate Button */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="ai-script-generate"
              onClick={handleGenerate}
              disabled={generating || !hasApiKey || !prompt.trim()}
              className="px-4 py-2 text-xs font-medium rounded bg-accent-primary text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity flex items-center gap-2"
            >
              {generating ? (
                <>
                  <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Generiere…
                </>
              ) : (
                <>✨ Generieren</>
              )}
            </button>
            {result?.byteSize !== undefined && (
              <span className="text-[10px] text-text-dim font-mono">
                {result.byteSize} Bytes
              </span>
            )}
          </div>

          {/* Result */}
          {result && (
            <div>
              {result.ok ? (
                <>
                  <div className="text-[10px] text-accent-success mb-1 uppercase tracking-wider">
                    ✓ Generierung erfolgreich
                  </div>
                  <pre
                    data-testid="ai-script-preview"
                    className="text-[11px] font-mono text-text-primary bg-bg-elevated border border-border-color rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap"
                  >
                    {result.code}
                  </pre>
                </>
              ) : (
                <>
                  <div className="text-[10px] text-accent-danger mb-1 uppercase tracking-wider">
                    ✗ Fehler
                  </div>
                  <div className="text-xs text-accent-danger bg-accent-danger/10 border border-accent-danger/30 rounded p-2">
                    {result.error}
                  </div>
                  {result.code && (
                    <pre className="text-[10px] font-mono text-text-dim bg-bg-elevated border border-border-color rounded p-3 mt-2 overflow-auto max-h-32 whitespace-pre-wrap">
                      {result.code}
                    </pre>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-color">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded border border-border-color text-text-muted hover:text-text-primary hover:border-accent-secondary transition-colors"
          >
            Abbrechen
          </button>
          <button
            type="button"
            data-testid="ai-script-save"
            onClick={handleAccept}
            disabled={!result?.ok || !result.code}
            className="px-3 py-1.5 text-xs font-medium rounded bg-accent-success text-bg-base hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            Als neues Script speichern
          </button>
        </div>
      </div>
    </div>
  );
}
