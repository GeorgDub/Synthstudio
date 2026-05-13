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
import { AI_SCRIPT_TEMPLATES, groupTemplatesByCategory } from "@/utils/aiScriptTemplates";
import { useAiCostStore, getProviderUsage, setMonthlyCap } from "@/store/useAiCostStore";

export interface AiScriptGeneratorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Wird mit dem generierten Code aufgerufen wenn der User auf "Speichern"
   * klickt. Parent (ScriptRunner) sollte addScript() aufrufen und das neue
   * Script auswählen.
   */
  onAccept: (code: string, suggestedName: string) => void;
  /**
   * Optional: aktueller Script-Code des selektierten Scripts. Wenn vorhanden,
   * bietet der Dialog zusätzlich einen "Iterieren"-Modus an, bei dem das LLM
   * den bestehenden Code als Vorgabe bekommt und nur die gewünschte
   * Änderung einbaut (Welle 2 von Phase S, post-v1.25.0).
   */
  currentCode?: string;
  /** Optional: aktueller Script-Name (für sinnvollen Iterate-Suggested-Name). */
  currentName?: string;
  /**
   * Wird mit dem iterierten Code aufgerufen — alternative Action zu onAccept
   * wenn der User das bestehende Script aktualisieren statt neu anlegen will.
   * Wenn undefined → nur "Als neues Script speichern" verfügbar.
   */
  onIterateAccept?: (code: string) => void;
}

export function AiScriptGeneratorDialog({
  isOpen,
  onClose,
  onAccept,
  currentCode,
  currentName,
  onIterateAccept,
}: AiScriptGeneratorDialogProps) {
  const api = useApiSettingsStore();
  useAiCostStore(); // re-render on cost-changes
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<AiScriptGenerationResult | null>(null);
  /** Iterate-Mode aktiviert (nur möglich wenn currentCode + onIterateAccept verfügbar). */
  const [iterateMode, setIterateMode] = useState(false);
  /** Template-Dropdown geöffnet. */
  const [templatesOpen, setTemplatesOpen] = useState(false);
  /** Cap-Editor geöffnet. */
  const [capEditorOpen, setCapEditorOpen] = useState(false);
  const [capDraft, setCapDraft] = useState("");

  // AI4-B: Aktueller Verbrauch des aktiven Providers
  const usage = getProviderUsage(api.activeProvider);

  // Multi-Provider-Support (post-v1.25.0): liest Key + Modell des AKTIVEN
  // Providers aus dem Store. `aiEnabled` reflektiert ob dieser Provider einen
  // Key hat. `aiModel` ist das Modell des aktiven Providers.
  const activeProviderKey = api.providers[api.activeProvider].apiKey;
  const hasApiKey = activeProviderKey.length > 0;
  const canIterate = Boolean(currentCode && currentCode.trim().length > 0 && onIterateAccept);

  // Reset state when dialog closes; default iterateMode = canIterate beim Öffnen
  useEffect(() => {
    if (!isOpen) {
      setPrompt("");
      setResult(null);
      setGenerating(false);
      setIterateMode(false);
    } else {
      // Beim Öffnen: wenn ein Script ausgewählt ist → Iterate-Mode default an
      setIterateMode(canIterate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const opts = {
      ...(iterateMode && currentCode ? { existingCode: currentCode } : {}),
      provider: api.activeProvider,
    };
    const res = await generateScriptFromPrompt(prompt, activeProviderKey, api.aiModel, opts);
    setResult(res);
    setGenerating(false);
  }, [prompt, activeProviderKey, api.aiModel, api.activeProvider, hasApiKey, iterateMode, currentCode]);

  const handleAccept = useCallback(() => {
    if (!result?.ok || !result.code) return;
    // Suggested name: erste 40 Zeichen des Prompts als Script-Name
    const suggestedName = `KI: ${prompt.trim().slice(0, 40)}${prompt.length > 40 ? "…" : ""}`;
    onAccept(result.code, suggestedName);
    onClose();
  }, [result, prompt, onAccept, onClose]);

  /** Iterate-Update: ersetzt den bestehenden Code-Inhalt des selektierten Scripts. */
  const handleIterateAccept = useCallback(() => {
    if (!result?.ok || !result.code) return;
    onIterateAccept?.(result.code);
    onClose();
  }, [result, onIterateAccept, onClose]);

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

          {/* Iterate-Mode-Toggle (nur sichtbar wenn currentCode + onIterateAccept gegeben) */}
          {canIterate && (
            <div className="flex items-center gap-2 px-2 py-1.5 rounded border border-border-color bg-bg-elevated">
              <input
                type="checkbox"
                id="ai-iterate-mode"
                data-testid="ai-script-iterate-toggle"
                checked={iterateMode}
                onChange={(e) => setIterateMode(e.target.checked)}
                disabled={generating}
                className="cursor-pointer accent-accent-primary"
              />
              <label htmlFor="ai-iterate-mode" className="text-xs text-text-primary cursor-pointer flex-1">
                <span className="font-medium">Iterieren</span>
                <span className="text-text-dim ml-2">
                  → bestehenden Code von <span className="font-mono text-accent-secondary">{currentName ?? "ausgewähltem Script"}</span> als Vorgabe nutzen
                </span>
              </label>
            </div>
          )}

          {/* Templates Dropdown — schneller Onboarding für neue User */}
          <div>
            <button
              type="button"
              onClick={() => setTemplatesOpen((o) => !o)}
              data-testid="ai-script-templates-toggle"
              className="flex items-center gap-1 text-[10px] text-text-dim hover:text-accent-secondary"
            >
              📋 Beispiel-Templates ({AI_SCRIPT_TEMPLATES.length})
              <span className="ml-1">{templatesOpen ? "▾" : "▸"}</span>
            </button>
            {templatesOpen && (
              <div className="mt-2 max-h-44 overflow-y-auto rounded border border-border-color bg-bg-elevated p-2 space-y-2">
                {Object.entries(groupTemplatesByCategory()).map(([category, templates]) => (
                  <div key={category}>
                    <div className="text-[9px] uppercase tracking-wider text-text-dim mb-1">{category}</div>
                    {templates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setPrompt(t.prompt);
                          setTemplatesOpen(false);
                        }}
                        data-testid={`ai-script-template-${t.id}`}
                        className="w-full text-left px-2 py-1 rounded text-[10px] hover:bg-bg-base"
                        title={t.description}
                      >
                        <div className="text-text-primary">{t.label}</div>
                        <div className="text-[9px] text-text-dim">{t.description}</div>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Prompt */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {iterateMode ? "Was soll am Script geändert werden?" : "Was soll das Script tun?"}
            </label>
            <textarea
              data-testid="ai-script-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                iterateMode
                  ? "z.B. Logge zusätzlich nach jedem BPM-Schritt einen Zeitstempel. Oder: mach die Rampe schneller (1 Sekunde)."
                  : "z.B. Rampe BPM von 100 auf 140 in 4 Sekunden. Logge jeden Schritt."
              }
              disabled={generating || !hasApiKey}
              rows={3}
              className="w-full px-3 py-2 text-xs rounded border border-border-color bg-bg-elevated text-text-primary placeholder-text-dim focus:outline-none focus:border-accent-primary disabled:opacity-50"
            />
            <p className="text-[10px] text-text-dim mt-1">
              Nutzt das aktuelle KI-Modell aus Settings (
              <span className="font-mono">{api.aiModel || "—"}</span>) — generiert ss.*-API-konformen Code.
              {iterateMode && (
                <> Im Iterate-Mode wird der existierende Code als Kontext mitgesendet.</>
              )}
            </p>
          </div>

          {/* Generate Button */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="ai-script-generate"
              onClick={handleGenerate}
              disabled={generating || !hasApiKey || !prompt.trim() || usage.capExceeded}
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

          {/* AI4-B: Cost-Tracking Display */}
          <div
            data-testid="ai-script-cost"
            className={[
              "px-3 py-2 rounded border text-[10px]",
              usage.capExceeded
                ? "bg-accent-danger/10 border-accent-danger/40 text-accent-danger"
                : "bg-bg-elevated border-border-color text-text-dim",
            ].join(" ")}
          >
            <div className="flex items-center justify-between">
              <span>
                Verbrauch <span className="font-mono">{api.activeProvider}</span> diesen Monat:{" "}
                <span className="font-mono text-text-primary">{usage.total.toLocaleString()}</span> Tokens
                {usage.cap !== null && (
                  <>
                    {" / "}
                    <span className="font-mono">{usage.cap.toLocaleString()}</span>
                  </>
                )}
                <span className="text-text-dim ml-2">({usage.callCount} Calls)</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setCapDraft(usage.cap !== null ? String(usage.cap) : "");
                  setCapEditorOpen((o) => !o);
                }}
                data-testid="ai-script-cost-cap-toggle"
                className="text-[10px] hover:text-accent-primary"
              >
                {usage.cap === null ? "Cap setzen" : "Cap anpassen"}
              </button>
            </div>
            {capEditorOpen && (
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border-color">
                <input
                  type="number"
                  value={capDraft}
                  onChange={(e) => setCapDraft(e.target.value)}
                  placeholder="z.B. 100000"
                  className="flex-1 px-2 py-0.5 text-[10px] rounded border border-border-color bg-bg-base text-text-primary"
                  data-testid="ai-script-cost-cap-input"
                />
                <button
                  type="button"
                  onClick={() => {
                    const n = parseInt(capDraft, 10);
                    setMonthlyCap(api.activeProvider, Number.isFinite(n) && n > 0 ? n : null);
                    setCapEditorOpen(false);
                  }}
                  className="px-2 py-0.5 text-[10px] rounded bg-accent-primary text-white"
                >
                  OK
                </button>
                {usage.cap !== null && (
                  <button
                    type="button"
                    onClick={() => {
                      setMonthlyCap(api.activeProvider, null);
                      setCapEditorOpen(false);
                    }}
                    className="px-2 py-0.5 text-[10px] rounded border border-border-color"
                  >
                    Entfernen
                  </button>
                )}
              </div>
            )}
            {usage.capExceeded && (
              <div className="mt-1 text-accent-danger">
                ⚠ Monats-Cap erreicht. Generierung deaktiviert bis Cap angepasst wird oder neuer Monat anfängt.
              </div>
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
          {/* Im Iterate-Mode: Update-Button für bestehendes Script + zusätzlich "Als neues" als Alternative.
              Im Plain-Mode: nur "Als neues Script speichern". */}
          {iterateMode && onIterateAccept && (
            <button
              type="button"
              data-testid="ai-script-iterate-save"
              onClick={handleIterateAccept}
              disabled={!result?.ok || !result.code}
              className="px-3 py-1.5 text-xs font-medium rounded bg-accent-primary text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              title="Aktuelles Script mit dem generierten Code überschreiben"
            >
              Script aktualisieren
            </button>
          )}
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
