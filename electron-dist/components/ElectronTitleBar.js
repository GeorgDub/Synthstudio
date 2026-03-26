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
        text-slate-400 transition-colors duration-100
        hover:${hoverColor} hover:text-white
        focus:outline-none
      `, style: { WebkitAppRegion: "no-drag" }, children: children }));
}
// ─── Hauptkomponente ──────────────────────────────────────────────────────────
function ElectronTitleBar({ projectName, isDirty = false, className = "", }) {
    const [isMaximized, setIsMaximized] = (0, react_1.useState)(false);
    // Nur in Electron rendern
    if (typeof window === "undefined" || !window.electronAPI) {
        return null;
    }
    const api = window.electronAPI;
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
    const appName = "Synthstudio";
    const titleParts = [appName];
    if (projectName)
        titleParts.push(projectName);
    const title = titleParts.join(" – ");
    return ((0, jsx_runtime_1.jsxs)("div", { className: `
        flex items-center justify-between
        h-8 bg-[#0d0d0d] border-b border-slate-800
        select-none ${className}
      `, style: { WebkitAppRegion: "drag" }, children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex items-center gap-2 px-3 min-w-0", children: [(0, jsx_runtime_1.jsx)("div", { className: "w-4 h-4 rounded-full bg-cyan-500 flex-shrink-0 opacity-80" }), (0, jsx_runtime_1.jsx)("span", { className: "text-xs text-slate-300 truncate font-medium", children: title }), isDirty && ((0, jsx_runtime_1.jsx)("span", { className: "text-cyan-400 text-xs flex-shrink-0", title: "Ungespeicherte \u00C4nderungen", children: "\u25CF" }))] }), projectName && ((0, jsx_runtime_1.jsx)("div", { className: "absolute left-1/2 -translate-x-1/2 pointer-events-none", children: (0, jsx_runtime_1.jsxs)("span", { className: "text-xs text-slate-500 truncate max-w-[200px] block text-center", children: [projectName, isDirty && " *"] }) })), (0, jsx_runtime_1.jsxs)("div", { className: "flex items-center h-full flex-shrink-0", style: { WebkitAppRegion: "no-drag" }, children: [(0, jsx_runtime_1.jsx)(WindowButton, { onClick: handleMinimize, title: "Minimieren", hoverColor: "bg-slate-700", children: (0, jsx_runtime_1.jsx)("svg", { width: "10", height: "1", viewBox: "0 0 10 1", fill: "currentColor", children: (0, jsx_runtime_1.jsx)("rect", { width: "10", height: "1" }) }) }), (0, jsx_runtime_1.jsx)(WindowButton, { onClick: handleMaximize, title: isMaximized ? "Wiederherstellen" : "Maximieren", hoverColor: "bg-slate-700", children: isMaximized ? (
                        /* Wiederherstellen-Icon */
                        (0, jsx_runtime_1.jsxs)("svg", { width: "10", height: "10", viewBox: "0 0 10 10", fill: "none", stroke: "currentColor", strokeWidth: "1", children: [(0, jsx_runtime_1.jsx)("rect", { x: "2", y: "0", width: "8", height: "8" }), (0, jsx_runtime_1.jsx)("rect", { x: "0", y: "2", width: "8", height: "8", fill: "#0d0d0d" }), (0, jsx_runtime_1.jsx)("rect", { x: "0", y: "2", width: "8", height: "8" })] })) : (
                        /* Maximieren-Icon */
                        (0, jsx_runtime_1.jsx)("svg", { width: "10", height: "10", viewBox: "0 0 10 10", fill: "none", stroke: "currentColor", strokeWidth: "1", children: (0, jsx_runtime_1.jsx)("rect", { x: "0", y: "0", width: "10", height: "10" }) })) }), (0, jsx_runtime_1.jsx)(WindowButton, { onClick: handleClose, title: "Schlie\u00DFen", hoverColor: "bg-red-600", children: (0, jsx_runtime_1.jsxs)("svg", { width: "10", height: "10", viewBox: "0 0 10 10", stroke: "currentColor", strokeWidth: "1.2", children: [(0, jsx_runtime_1.jsx)("line", { x1: "0", y1: "0", x2: "10", y2: "10" }), (0, jsx_runtime_1.jsx)("line", { x1: "10", y1: "0", x2: "0", y2: "10" })] }) })] })] }));
}
exports.default = ElectronTitleBar;
