/**
 * client/src/components/PatternImageExport/PatternImageExportModal.tsx (v3.66.0)
 *
 * Modal mit Live-Preview zum Export eines Patterns als PNG oder SVG.
 *
 * Style/Größe-Picker, Title-Override, Download-Buttons. Verwendet ausschließlich
 * semantische Tailwind-Tokens (bg-bg-panel, text-text-primary, accent-primary,
 * border-border-color).
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  renderPatternToCanvas,
  exportPatternAsPng,
  exportPatternAsSvg,
  sanitizePatternExportFileName,
  PATTERN_IMAGE_STYLES,
  PATTERN_IMAGE_SIZES,
  type PatternForExport,
  type PatternImageStyleId,
} from "@/utils/patternImageExport";

interface Props {
  isOpen: boolean;
  pattern: PatternForExport | null;
  onClose: () => void;
}

export function PatternImageExportModal({ isOpen, pattern, onClose }: Props) {
  const [styleId, setStyleId] = useState<PatternImageStyleId>("default-dark");
  const [sizeId, setSizeId] = useState<string>("default");
  const [titleOverride, setTitleOverride] = useState<string>("");
  const previewRef = useRef<HTMLDivElement | null>(null);

  const size = useMemo(
    () => PATTERN_IMAGE_SIZES.find((s) => s.id === sizeId) ?? PATTERN_IMAGE_SIZES[0],
    [sizeId],
  );

  // Live-Preview-Canvas. Wir rendern in Originalgröße und skalieren via CSS,
  // damit Style/Size-Auswahl ein präzises Abbild des späteren Downloads zeigt.
  useEffect(() => {
    if (!isOpen || !pattern || !previewRef.current) return;
    const container = previewRef.current;
    container.innerHTML = "";
    try {
      const canvas = renderPatternToCanvas(pattern, {
        width: size.width,
        height: size.height,
        theme: styleId,
        titleText: titleOverride.trim() || undefined,
      });
      // Preview-Skalierung — max 560px Breite im Modal.
      canvas.style.width = "100%";
      canvas.style.height = "auto";
      canvas.style.maxWidth = "560px";
      canvas.style.display = "block";
      canvas.style.border = "1px solid var(--ss-border)";
      canvas.style.borderRadius = "4px";
      container.appendChild(canvas);
    } catch (err) {
      const msg = document.createElement("div");
      msg.className = "text-accent-danger text-xs";
      msg.textContent = `Preview-Fehler: ${(err as Error).message}`;
      container.appendChild(msg);
    }
  }, [isOpen, pattern, styleId, sizeId, titleOverride, size.width, size.height]);

  // ESC schließt
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen || !pattern) return null;

  const handleDownloadPng = async () => {
    try {
      const blob = await exportPatternAsPng(pattern, {
        width: size.width,
        height: size.height,
        theme: styleId,
        titleText: titleOverride.trim() || undefined,
      });
      triggerDownload(blob, sanitizePatternExportFileName(pattern.name, "png"));
    } catch (err) {
      // best-effort UI-feedback (kein toast import um Coupling klein zu halten)
      console.error("PNG-Export fehlgeschlagen:", err);
    }
  };

  const handleDownloadSvg = () => {
    try {
      const svg = exportPatternAsSvg(pattern, {
        width: size.width,
        height: size.height,
        theme: styleId,
        titleText: titleOverride.trim() || undefined,
      });
      const blob = new Blob([svg], { type: "image/svg+xml" });
      triggerDownload(blob, sanitizePatternExportFileName(pattern.name, "svg"));
    } catch (err) {
      console.error("SVG-Export fehlgeschlagen:", err);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      data-testid="pattern-image-export-overlay"
    >
      <div
        className="bg-bg-panel border border-border-color rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Pattern als Bild exportieren"
      >
        <div className="px-4 py-3 border-b border-border-color flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-text-primary">Pattern als Bild exportieren</div>
            <div className="text-xs text-text-muted">
              {pattern.name} · {pattern.stepCount} Steps · {pattern.parts.length} Parts
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text-primary text-lg"
            data-testid="pattern-image-export-close"
            aria-label="Schließen"
          >✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Style-Picker */}
          <div>
            <label className="block text-[10px] text-text-dim uppercase tracking-wider mb-1.5">
              Style
            </label>
            <div className="flex gap-1.5 flex-wrap">
              {(Object.values(PATTERN_IMAGE_STYLES)).map((s) => (
                <button
                  key={s.id}
                  onClick={() => setStyleId(s.id)}
                  data-testid={`pattern-image-style-${s.id}`}
                  className={[
                    "px-3 py-1.5 text-xs rounded border transition-colors",
                    styleId === s.id
                      ? "bg-accent-primary/20 text-accent-primary border-accent-primary"
                      : "bg-bg-elevated text-text-muted border-border-color hover:text-text-primary",
                  ].join(" ")}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Size-Picker */}
          <div>
            <label className="block text-[10px] text-text-dim uppercase tracking-wider mb-1.5">
              Größe
            </label>
            <div className="flex gap-1.5 flex-wrap">
              {PATTERN_IMAGE_SIZES.map((sz) => (
                <button
                  key={sz.id}
                  onClick={() => setSizeId(sz.id)}
                  data-testid={`pattern-image-size-${sz.id}`}
                  className={[
                    "px-3 py-1.5 text-xs rounded border transition-colors",
                    sizeId === sz.id
                      ? "bg-accent-secondary/20 text-accent-secondary border-accent-secondary"
                      : "bg-bg-elevated text-text-muted border-border-color hover:text-text-primary",
                  ].join(" ")}
                >
                  {sz.label}
                </button>
              ))}
            </div>
          </div>

          {/* Title-Override */}
          <div>
            <label
              htmlFor="pattern-image-title-input"
              className="block text-[10px] text-text-dim uppercase tracking-wider mb-1.5"
            >
              Titel-Override (optional)
            </label>
            <input
              id="pattern-image-title-input"
              type="text"
              value={titleOverride}
              onChange={(e) => setTitleOverride(e.target.value)}
              placeholder={pattern.name}
              className="w-full bg-bg-elevated border border-border-color rounded px-2 py-1.5 text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-primary"
              data-testid="pattern-image-title-override"
            />
          </div>

          {/* Live-Preview */}
          <div>
            <label className="block text-[10px] text-text-dim uppercase tracking-wider mb-1.5">
              Live-Preview
            </label>
            <div
              ref={previewRef}
              className="bg-bg-base rounded p-2 flex items-center justify-center min-h-[200px]"
              data-testid="pattern-image-preview"
            />
          </div>
        </div>

        <div className="px-4 py-3 border-t border-border-color flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded bg-bg-elevated text-text-muted hover:text-text-primary transition-colors"
            data-testid="pattern-image-export-cancel"
          >
            Schließen
          </button>
          <button
            onClick={handleDownloadSvg}
            className="px-3 py-1.5 text-xs rounded bg-bg-elevated text-text-primary border border-border-color hover:border-accent-secondary transition-colors"
            data-testid="pattern-image-download-svg"
          >
            Download SVG
          </button>
          <button
            onClick={() => void handleDownloadPng()}
            className="px-3 py-1.5 text-xs rounded bg-accent-primary text-bg-base font-semibold hover:opacity-90 transition-opacity"
            data-testid="pattern-image-download-png"
          >
            Download PNG
          </button>
        </div>
      </div>
    </div>
  );
}

function triggerDownload(blob: Blob, filename: string) {
  if (typeof URL === "undefined" || typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
