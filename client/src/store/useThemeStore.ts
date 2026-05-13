import { useEffect, useReducer } from "react";
import { applyTheme as applyBaseTheme } from "@/components/Settings/ThemeSettings";

export interface CustomTheme {
  id: string;
  name: string;
  colors: {
    '--ss-bg-base': string;
    '--ss-bg-panel': string;
    '--ss-bg-elevated': string;
    '--ss-text-primary': string;
    '--ss-text-muted': string;
    '--ss-text-dim': string;
    '--ss-border': string;
    '--ss-border-subtle': string;
    '--ss-accent-primary': string;
    '--ss-accent-secondary': string;
    '--ss-accent-success': string;
    '--ss-accent-danger': string;
  };
  /** Erweiterte Einstellungen */
  extras?: {
    /** Globale Schriftgröße (px, 10–18) */
    fontSize?: number;
    /** Border-Radius der Buttons/Panels (px, 0–16) */
    borderRadius?: number;
    /** Allgemeine UI-Transparenz (0=undurchsichtig, 1=glasartig) */
    glassEffect?: number;
    /** Akzent-Glow-Intensität (0=kein, 1=stark) */
    glowIntensity?: number;
    /** Hintergrund-Bild-URL (z.B. Textur) */
    backgroundImage?: string;
    /** Custom CSS (wird direkt injiziert) */
    customCss?: string;
  };
}

interface ThemeStoreState {
  customThemes: CustomTheme[];
  activeCustomTheme: string | null;
}

type Listener = () => void;

const STORAGE_KEY = "synthstudio:custom-themes:v1";
const STYLE_ELEMENT_ID = "synthstudio-custom-theme";

function makeId(): string {
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadState(): ThemeStoreState {
  const base: ThemeStoreState = { customThemes: [], activeCustomTheme: null };
  if (typeof window === "undefined") return base;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    return { ...base, ...(JSON.parse(raw) as Partial<ThemeStoreState>) };
  } catch {
    return base;
  }
}

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
  } catch {}
}

let _state: ThemeStoreState = loadState();

const _listeners = new Set<Listener>();
function notify(): void { _listeners.forEach((l) => l()); }

export function addCustomTheme(theme: Omit<CustomTheme, 'id'>): string {
  const newTheme: CustomTheme = { ...theme, id: makeId() };
  _state = { ..._state, customThemes: [..._state.customThemes, newTheme] };
  persist();
  notify();
  return newTheme.id;
}

export function updateCustomTheme(id: string, theme: CustomTheme): void {
  _state = {
    ..._state,
    customThemes: _state.customThemes.map(t => (t.id === id ? theme : t)),
  };
  persist();
  notify();
}

export function deleteCustomTheme(id: string): void {
  const wasActive = _state.activeCustomTheme === id;
  _state = {
    ..._state,
    customThemes: _state.customThemes.filter(t => t.id !== id),
    activeCustomTheme: wasActive ? null : _state.activeCustomTheme,
  };
  if (wasActive) {
      applyCustomTheme(null);
  }
  persist();
  notify();
}

function removeCustomThemeStyle() {
    const styleEl = document.getElementById(STYLE_ELEMENT_ID);
    if (styleEl) {
        styleEl.remove();
    }
}

export function applyCustomTheme(id: string | null): void {
    removeCustomThemeStyle();
    document.documentElement.removeAttribute("data-theme");

    if (!id) {
        _state = { ..._state, activeCustomTheme: null };
        persist();
        notify();
        void import("@/utils/popoutThemeSync").then(m => m.broadcastThemeToPopouts());
        return;
    }

    const theme = _state.customThemes.find(t => t.id === id);
    if (theme) {
        const styleEl = document.createElement('style');
        styleEl.id = STYLE_ELEMENT_ID;

        const cssVars = Object.entries(theme.colors).map(([key, value]) => `${key}: ${value};`).join('\n    ');

        // Extras: Font-Size, Border-Radius, Glow, Background, Custom CSS
        const extras = theme.extras ?? {};
        const extraVars: string[] = [];
        if (extras.fontSize)     extraVars.push(`font-size: ${extras.fontSize}px;`);
        if (extras.borderRadius !== undefined) extraVars.push(`--ss-radius: ${extras.borderRadius}px;`);
        if (extras.glowIntensity !== undefined) {
          const glow = extras.glowIntensity;
          extraVars.push(`--ss-glow: 0 0 ${Math.round(8 * glow)}px var(--ss-accent-primary), 0 0 ${Math.round(20 * glow)}px var(--ss-accent-primary)60;`);
        }

        const bgImage = extras.backgroundImage
          ? `background-image: url('${extras.backgroundImage}'); background-size: cover; background-attachment: fixed;`
          : "";

        const glassCss = extras.glassEffect
          ? `backdrop-filter: blur(${Math.round(extras.glassEffect * 12)}px); -webkit-backdrop-filter: blur(${Math.round(extras.glassEffect * 12)}px);`
          : "";

        const radiusCss = extras.borderRadius !== undefined
          ? `button, input, select, .rounded, .rounded-lg, .rounded-xl { border-radius: ${extras.borderRadius}px !important; }`
          : "";

        styleEl.innerHTML = `
            :root {
                ${cssVars}
                ${extraVars.join('\n    ')}
            }
            ${bgImage ? `html, body, #root { ${bgImage} }` : ""}
            ${glassCss ? `.bg-bg-panel, .bg-bg-elevated { ${glassCss} }` : ""}
            ${radiusCss}
            ${extras.customCss ?? ""}
        `;

        document.head.appendChild(styleEl);
        _state = { ..._state, activeCustomTheme: id };
        persist();
        notify();
    }
    // MIG-3C: dockview-popout-Fenster bekommen Custom-Theme-Style mit
    void import("@/utils/popoutThemeSync").then(m => m.broadcastThemeToPopouts());
}

// When a base theme is applied, deactivate any custom theme
export function applyTheme(themeId: any) {
    applyCustomTheme(null);
    applyBaseTheme(themeId);
}

export function useThemeStore(): ThemeStoreState {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    if (_state.activeCustomTheme) {
        applyCustomTheme(_state.activeCustomTheme);
    }
    return () => { _listeners.delete(rerender); };
  }, []);
  return _state;
}
