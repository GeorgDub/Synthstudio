import React, { useState } from 'react';
import { X } from 'lucide-react';
import { addCustomTheme, applyCustomTheme, type CustomTheme } from '@/store/useThemeStore';

const defaultColors: CustomTheme['colors'] = {
    '--ss-bg-base': '#ffffff',
    '--ss-bg-panel': '#f8fafc',
    '--ss-bg-elevated': '#f1f5f9',
    '--ss-text-primary': '#0f172a',
    '--ss-text-muted': '#475569',
    '--ss-text-dim': '#94a3b8',
    '--ss-border': '#e2e8f0',
    '--ss-border-subtle': '#f1f5f9',
    '--ss-accent-primary': '#2563eb',
    '--ss-accent-secondary': '#db2777',
    '--ss-accent-tertiary': '#6366f1',
    '--ss-accent-success': '#059669',
    '--ss-accent-warning': '#f59e0b',
    '--ss-accent-danger': '#dc2626',
};

const colorLabels: Record<keyof CustomTheme['colors'], string> = {
    '--ss-bg-base': 'Haupthintergrund',
    '--ss-bg-panel': 'Panel-Hintergrund',
    '--ss-bg-elevated': 'Erhöhter Hintergrund',
    '--ss-text-primary': 'Haupttext',
    '--ss-text-muted': 'Gedämpfter Text',
    '--ss-text-dim': 'Dunkler Text',
    '--ss-border': 'Rahmen',
    '--ss-border-subtle': 'Dezenter Rahmen',
    '--ss-accent-primary': 'Akzentfarbe (primär)',
    '--ss-accent-secondary': 'Akzentfarbe (sekundär)',
    '--ss-accent-tertiary': 'Akzentfarbe (tertiär)',
    '--ss-accent-success': 'Erfolgsfarbe',
    '--ss-accent-warning': 'Warnung',
    '--ss-accent-danger': 'Gefahr/Fehler',
};

interface Props {
    onClose: () => void;
}

export function CustomThemeCreator({ onClose }: Props) {
    const [name, setName] = useState('');
    const [colors, setColors] = useState(defaultColors);
    const [showExtras, setShowExtras] = useState(false);
    const [fontSize, setFontSize] = useState(12);
    const [borderRadius, setBorderRadius] = useState(6);
    const [glowIntensity, setGlowIntensity] = useState(0);
    const [glassEffect, setGlassEffect] = useState(0);
    const [customCss, setCustomCss] = useState('');

    const handleColorChange = (key: keyof CustomTheme['colors'], value: string) => {
        setColors(prev => ({ ...prev, [key]: value }));
    };

    const handleSave = () => {
        if (!name.trim()) {
            alert('Bitte gib einen Namen für das Theme ein.');
            return;
        }
        const extras = {
          fontSize: fontSize !== 12 ? fontSize : undefined,
          borderRadius: borderRadius !== 6 ? borderRadius : undefined,
          glowIntensity: glowIntensity > 0 ? glowIntensity : undefined,
          glassEffect: glassEffect > 0 ? glassEffect : undefined,
          customCss: customCss.trim() || undefined,
        };
        const newId = addCustomTheme({ name, colors, extras });
        applyCustomTheme(newId);
        setName('');
        setColors(defaultColors);
        onClose();
    };

    return (
        <div className="mt-6 border-t border-border-color pt-6">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-text-primary">Eigenes Design erstellen</h3>
                <button
                    onClick={onClose}
                    className="w-6 h-6 rounded text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors flex items-center justify-center"
                    aria-label="Close"
                    title="Schließen"
                >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Name des Designs"
                    className="col-span-2 bg-bg-elevated text-white px-3 py-2 rounded border border-border-color"
                />
                {Object.entries(colorLabels).map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between">
                        <label className="text-xs text-text-muted">{label}</label>
                        <input
                            type="color"
                            value={colors[key as keyof CustomTheme['colors']] ?? '#000000'}
                            onChange={(e) => handleColorChange(key as keyof CustomTheme['colors'], e.target.value)}
                            className="bg-transparent border-none rounded"
                        />
                    </div>
                ))}
            </div>
            {/* ── Erweiterte Einstellungen ─────────────────────────── */}
            <button onClick={() => setShowExtras(p => !p)}
                className="mt-3 w-full text-left text-xs text-text-dim hover:text-text-primary py-1.5 border-t border-border-color flex items-center justify-between">
                <span>Erweiterte Einstellungen</span>
                <span>{showExtras ? "▲" : "▼"}</span>
            </button>

            {showExtras && (
                <div className="space-y-3 mt-1">
                    {/* Font Size */}
                    <div className="flex items-center gap-3">
                        <label className="text-xs text-text-muted w-28">Schriftgröße</label>
                        <input type="range" min={10} max={18} step={1} value={fontSize}
                            onChange={e => setFontSize(Number(e.target.value))}
                            className="flex-1 accent-accent-primary" />
                        <span className="text-xs font-mono text-text-primary w-10">{fontSize}px</span>
                    </div>

                    {/* Border Radius */}
                    <div className="flex items-center gap-3">
                        <label className="text-xs text-text-muted w-28">Abrundung</label>
                        <input type="range" min={0} max={20} step={1} value={borderRadius}
                            onChange={e => setBorderRadius(Number(e.target.value))}
                            className="flex-1 accent-accent-primary" />
                        <span className="text-xs font-mono text-text-primary w-10">{borderRadius}px</span>
                    </div>

                    {/* Glow Effect */}
                    <div className="flex items-center gap-3">
                        <label className="text-xs text-text-muted w-28">Glow-Intensität</label>
                        <input type="range" min={0} max={1} step={0.05} value={glowIntensity}
                            onChange={e => setGlowIntensity(Number(e.target.value))}
                            className="flex-1 accent-accent-secondary" />
                        <span className="text-xs font-mono text-text-primary w-10">{Math.round(glowIntensity * 100)}%</span>
                    </div>

                    {/* Glass Effect */}
                    <div className="flex items-center gap-3">
                        <label className="text-xs text-text-muted w-28">Glaseffekt</label>
                        <input type="range" min={0} max={1} step={0.05} value={glassEffect}
                            onChange={e => setGlassEffect(Number(e.target.value))}
                            className="flex-1 accent-accent-secondary" />
                        <span className="text-xs font-mono text-text-primary w-10">{Math.round(glassEffect * 100)}%</span>
                    </div>

                    {/* Custom CSS */}
                    <div>
                        <label className="text-xs text-text-muted block mb-1">Custom CSS (optional)</label>
                        <textarea
                            value={customCss}
                            onChange={e => setCustomCss(e.target.value)}
                            placeholder="/* Eigenes CSS hier einfügen */&#10;.bg-bg-panel { opacity: 0.9; }"
                            className="w-full bg-bg-base text-text-primary text-[10px] font-mono px-2 py-1.5 rounded border border-border-color resize-none placeholder:text-text-dim"
                            style={{ minHeight: 64 }}
                            spellCheck={false}
                        />
                        <p className="text-[10px] text-text-dim mt-0.5">Wird direkt nach den Theme-Variablen injiziert.</p>
                    </div>
                </div>
            )}

            <button
                onClick={handleSave}
                className="mt-4 w-full px-4 py-2 bg-accent-success hover:opacity-80 rounded text-white font-bold text-sm transition-opacity"
            >
                Eigenes Design speichern & anwenden
            </button>
        </div>
    );
}
