/**
 * electron/permissions.ts — Whitelist-Logik für Chromium Permission-Handler.
 *
 * Wird vom Main-Process (`installPermissionHandlers` in main.ts) genutzt und
 * lässt sich isoliert via Vitest testen (kein `app.whenReady` / kein Electron-
 * Import nötig). Das ist Absicht: TASK-243 schreibt Regression-Tests gegen
 * genau dieses Modul, ohne den schweren main.ts-Importgraph zu mocken.
 *
 * Granted permissions (Stand TASK-242, v3.232):
 * - `media`            — Mikrofon-Input für Outboard-FX-Modus
 * - `mediaKeySystem`   — DRM-related Audio (Chromium ruft das implizit)
 * - `midi`             — Web MIDI API (Pads, Controller, KORG-Hardware)
 * - `midiSysex`        — SysEx-Channel für OmniTribe/Electribe2 (NRPN+OTP)
 *
 * Alles andere (geolocation, notifications, usb, hid, bluetooth, …) bleibt
 * verboten. Renderer-Code muss trotzdem Device-Picker via enumerateDevices()
 * zeigen — die Whitelist ersetzt nur den nativen Permission-Dialog.
 *
 * Hardening-Note (Future-Work, nicht TASK-242): bei zusätzlichem Origin-Check
 * könnten wir `webContents.getURL().startsWith('file:')` prüfen, um SysEx nur
 * lokal geladenem Code zu erlauben. Aktuell entkräftet durch CSP (siehe
 * installCspHeaders) + fehlender Remote-Content-Loader.
 */

export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set([
  "media",
  "mediaKeySystem",
  "midi",
  "midiSysex",
]);

/**
 * Pure-Helper, der von beiden Permission-Handlern (Request + Check) genutzt
 * wird. Exportiert für Tests.
 */
export function isPermissionAllowed(permission: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission);
}
