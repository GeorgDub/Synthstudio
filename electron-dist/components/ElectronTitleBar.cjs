"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ElectronTitleBar = ElectronTitleBar;
const jsx_runtime_1 = require("react/jsx-runtime");
/**
 * Synthstudio – ElectronTitleBar (Frontend-Agent)
 *
 * Benutzerdefinierte Titelleiste für Electron.
 * Zeigt App-Name, Projektname, isDirty-Indikator und Fenster-Buttons.
 * Gibt null zurück wenn nicht in Electron (window.electronAPI undefined).
 *
 * Verwendung:
 * ```tsx
 * <ElectronTitleBar projectName="Mein Projekt" isDirty={true} />
 * ```
 */
const react_1 = require("react");
function WindowButton({ onClick, title, hoverColor, children }) {
    return ((0, jsx_runtime_1.jsx)("button", { onClick: onClick, title: title, className: `
        w-12 h-full flex items-center justify-center
        text-text-muted transition-colors duration-100
        hover:${hoverColor} hover:text-text-primary
        focus:outline-none
      `, style: { WebkitAppRegion: "no-drag" }, children: children }));
}
// ─── Hauptkomponente ──────────────────────────────────────────────────────────
function ElectronTitleBar({ projectName, isDirty = false, className = "", }) {
    const [isMaximized, setIsMaximized] = (0, react_1.useState)(false);
    const [isFullscreen, setIsFullscreen] = (0, react_1.useState)(false);
    // Nur in Electron rendern
    const inElectron = typeof window !== "undefined" && !!window.electronAPI;
    const api = inElectron ? window.electronAPI : null;
    // BUG-009 Fix: Im Fullscreen versteckt sich die Custom-TitleBar komplett.
    // Hintergrund: `WebkitAppRegion: drag` auf dem TitleBar-Container wird im
    // Fullscreen-Mode von Chromium anders gehandled — die Drag-Region schluckt
    // pointer-events von darüberliegenden `fixed inset-0` Overlays (z.B. das
    // Performance-Mode Mode-Toggle), was deren Buttons unklickbar macht. In
    // Fullscreen ist die Drag-Region ohnehin sinnlos (Fenster lässt sich nicht
    // bewegen), also rendern wir die TitleBar gar nicht erst.
    (0, react_1.useEffect)(() => {
        if (!api)
            return;
        // Initial-State abfragen — User könnte via OS-Shortcut (F11/CMD+CTRL+F) in
        // Fullscreen sein bevor der Renderer mountet.
        api.isFullscreen?.().then((fs) => setIsFullscreen(!!fs)).catch(() => { });
        // Subscription für Fullscreen-Wechsel
        const cleanup = api.onFullscreenChanged?.(setIsFullscreen);
        return cleanup;
    }, [api]);
    if (!inElectron || !api)
        return null;
    if (isFullscreen)
        return null;
    const handleMinimize = (0, react_1.useCallback)(() => {
        api.minimizeWindow?.();
    }, [api]);
    const handleMaximize = (0, react_1.useCallback)(() => {
        api.maximizeWindow?.();
        setIsMaximized((prev) => !prev);
    }, [api]);
    const handleClose = (0, react_1.useCallback)(() => {
        api.forceCloseWindow?.();
    }, [api]);
    // ── Titel zusammensetzen ──────────────────────────────────────────────────
    // BUG-015 Fix: linke Seite zeigt nur "Synthstudio" wenn die Mitte einen
    // Projektnamen anzeigt — sonst überlappen sich beide Texte bei schmalen
    // Fenstern oder kurzen Projektnamen.
    const appName = "Synthstudio";
    const leftTitle = appName; // ohne ProjectName um Doppelung mit der Mitte zu vermeiden
    return ((0, jsx_runtime_1.jsxs)("div", { className: `
        flex items-center justify-between relative
        h-8 bg-bg-base border-b border-border-color
        select-none ${className}
      `, style: { WebkitAppRegion: "drag" }, children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex items-center gap-2 px-3 min-w-0", children: [(0, jsx_runtime_1.jsx)("div", { className: "w-4 h-4 rounded-full bg-accent-primary flex-shrink-0 opacity-80" }), (0, jsx_runtime_1.jsx)("span", { className: "text-xs text-text-primary truncate font-medium", children: leftTitle }), isDirty && ((0, jsx_runtime_1.jsx)("span", { className: "text-accent-primary text-xs flex-shrink-0", title: "Ungespeicherte \u00C4nderungen", "aria-label": "Ungespeicherte \u00C4nderungen", children: "\u25CF" }))] }), projectName && ((0, jsx_runtime_1.jsx)("div", { className: "absolute left-1/2 -translate-x-1/2 pointer-events-none", children: (0, jsx_runtime_1.jsxs)("span", { className: "text-xs text-text-dim truncate max-w-[200px] block text-center", children: [projectName, isDirty && " *"] }) })), (0, jsx_runtime_1.jsxs)("div", { className: "flex items-center h-full flex-shrink-0", style: { WebkitAppRegion: "no-drag" }, children: [(0, jsx_runtime_1.jsx)(WindowButton, { onClick: handleMinimize, title: "Minimieren", hoverColor: "bg-bg-elevated", children: (0, jsx_runtime_1.jsx)("svg", { width: "10", height: "1", viewBox: "0 0 10 1", fill: "currentColor", children: (0, jsx_runtime_1.jsx)("rect", { width: "10", height: "1" }) }) }), (0, jsx_runtime_1.jsx)(WindowButton, { onClick: handleMaximize, title: isMaximized ? "Wiederherstellen" : "Maximieren", hoverColor: "bg-bg-elevated", children: isMaximized ? (
                        /* Wiederherstellen-Icon
                         * Note: SVG rect fill below uses raw hex "#0d0d0d" intentionally —
                         * it acts as the punch-through mask for the back rectangle of the
                         * "restore" icon and is rendered on the title-bar bg. We keep it
                         * theme-independent because <rect fill="..."> doesn't resolve
                         * CSS variables; matching the title-bar bg via currentColor would
                         * require a different SVG structure. Color-Refactor-Sonderfall. */
                        (0, jsx_runtime_1.jsxs)("svg", { width: "10", height: "10", viewBox: "0 0 10 10", fill: "none", stroke: "currentColor", strokeWidth: "1", children: [(0, jsx_runtime_1.jsx)("rect", { x: "2", y: "0", width: "8", height: "8" }), (0, jsx_runtime_1.jsx)("rect", { x: "0", y: "2", width: "8", height: "8", fill: "#0d0d0d" }), (0, jsx_runtime_1.jsx)("rect", { x: "0", y: "2", width: "8", height: "8" })] })) : (
                        /* Maximieren-Icon */
                        (0, jsx_runtime_1.jsx)("svg", { width: "10", height: "10", viewBox: "0 0 10 10", fill: "none", stroke: "currentColor", strokeWidth: "1", children: (0, jsx_runtime_1.jsx)("rect", { x: "0", y: "0", width: "10", height: "10" }) })) }), (0, jsx_runtime_1.jsx)(WindowButton, { onClick: handleClose, title: "Schlie\u00DFen", hoverColor: "bg-accent-danger", children: (0, jsx_runtime_1.jsxs)("svg", { width: "10", height: "10", viewBox: "0 0 10 10", stroke: "currentColor", strokeWidth: "1.2", children: [(0, jsx_runtime_1.jsx)("line", { x1: "0", y1: "0", x2: "10", y2: "10" }), (0, jsx_runtime_1.jsx)("line", { x1: "10", y1: "0", x2: "0", y2: "10" })] }) })] })] }));
}
exports.default = ElectronTitleBar;
