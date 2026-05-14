/**
 * Synthstudio – Content Security Policy (CSP) Builder
 *
 * Liefert die CSP-Header-Strings für Production- und Development-Builds
 * der Electron-App. Die CSP wird vom Main-Process via
 * `session.defaultSession.webRequest.onHeadersReceived` auf alle
 * Renderer-Responses gesetzt.
 *
 * Trennung von der CSP-Logik aus `main.ts`:
 *  - die reinen Funktionen sind in einem isolierten Modul testbar
 *    (kein Electron-Import nötig)
 *  - drift-Schutz: die in `main.ts` verwendete Quelle ist hier zentralisiert,
 *    es gibt nur eine Stelle, die geändert werden muss
 *
 * Pflicht-Directives (TASK-107):
 *   - default-src 'self'              Basis
 *   - script-src 'self'               keine inline-Scripts (Vite bundled)
 *   - style-src 'self' 'unsafe-inline' Tailwind v4 JIT injiziert inline
 *   - img-src 'self' data: blob:      data-URLs für Embedded-Bilder, blob für Waveforms
 *   - media-src 'self' blob: file:    Electron file:// + Web blobs
 *   - worker-src 'self' blob:         v1.17 Script-Sandbox via Blob-URL Worker
 *   - connect-src 'self' ws: wss: api.openai.com api.anthropic.com
 *                                     LAN-WebSocket für Kollaboration + Dev-HMR
 *                                     + AI-Provider-Endpoints (post-v1.67.0 BUG-024)
 *   - object-src 'none'               keine Flash/PDF/Plugins
 *   - base-uri 'self'                 verhindert <base href="…"> Hijack
 *   - form-action 'self'              verhindert Form-Submit auf externe URL
 *
 * Test-Coverage: tests/electron/csp-header.test.ts
 */

/** Ein einzelnes CSP-Directive als Tuple [Name, Werte[]]. */
export type CspDirective = readonly [string, readonly string[]];

/**
 * Production-Directives (strikt). Verwenden im gepackten Electron-Build.
 *
 * Reihenfolge ist relevant für Snapshot-Tests — bitte nicht ohne Grund umsortieren.
 */
export const CSP_DIRECTIVES_PROD: readonly CspDirective[] = [
  ["default-src", ["'self'"]],
  ["script-src", ["'self'"]],
  ["style-src", ["'self'", "'unsafe-inline'"]],
  ["img-src", ["'self'", "data:", "blob:"]],
  ["media-src", ["'self'", "blob:", "file:"]],
  ["font-src", ["'self'", "data:"]],
  ["worker-src", ["'self'", "blob:"]],
  [
    "connect-src",
    [
      "'self'",
      "ws:",
      "wss:",
      // AI-Provider-Endpoints (BUG-024 / v1.67.0): vor v1.67 hat die strikte
      // connect-src den AI-Script-Generator + Project-Analysis + Pattern-Gen
      // im gepackten Electron-Build geblockt — alle drei Features rufen
      // direkt aus dem Renderer fetch() auf diese Hosts auf.
      "https://api.openai.com",
      "https://api.anthropic.com",
    ],
  ],
  ["object-src", ["'none'"]],
  ["base-uri", ["'self'"]],
  ["form-action", ["'self'"]],
  ["frame-ancestors", ["'none'"]],
] as const;

/**
 * Development-Directives (lockerer).
 *
 * Unterschiede zu Prod:
 *   - script-src enthält zusätzlich http://localhost:* + http://127.0.0.1:*
 *     (Vite-Dev-Server serviert HMR-Client-Scripts via diese Origins)
 *   - style-src behält 'unsafe-inline' (Tailwind v4 JIT)
 *   - connect-src enthält http://localhost:* + http://127.0.0.1:* + ws://localhost:*
 *     für HMR-WebSocket und HTTP-Module-Loading
 *   - img-src behält data: + blob: + http://localhost:* (Vite-Asset-URLs)
 *
 * Wichtig: 'unsafe-eval' ist NICHT erlaubt — Vite 7 nutzt esbuild + nativen
 * import(), kein eval(). Auch im Dev-Mode bleibt eval geblockt.
 */
export const CSP_DIRECTIVES_DEV: readonly CspDirective[] = [
  ["default-src", ["'self'"]],
  ["script-src", ["'self'", "http://localhost:*", "http://127.0.0.1:*"]],
  ["style-src", ["'self'", "'unsafe-inline'"]],
  ["img-src", ["'self'", "data:", "blob:", "http://localhost:*", "http://127.0.0.1:*"]],
  ["media-src", ["'self'", "blob:", "file:", "http://localhost:*", "http://127.0.0.1:*"]],
  ["font-src", ["'self'", "data:"]],
  ["worker-src", ["'self'", "blob:"]],
  [
    "connect-src",
    [
      "'self'",
      "ws:",
      "wss:",
      "http://localhost:*",
      "http://127.0.0.1:*",
      "ws://localhost:*",
      "ws://127.0.0.1:*",
      // Wie Prod: AI-Provider auch im Dev-Mode erlauben (BUG-024 / v1.67.0)
      "https://api.openai.com",
      "https://api.anthropic.com",
    ],
  ],
  ["object-src", ["'none'"]],
  ["base-uri", ["'self'"]],
  ["form-action", ["'self'"]],
] as const;

/**
 * Serialisiert eine Directive-Liste in einen gültigen CSP-Header-String.
 *
 * @example
 *   buildCspHeader([["default-src", ["'self'"]], ["script-src", ["'self'"]]])
 *   // → "default-src 'self'; script-src 'self'"
 */
export function buildCspHeader(directives: readonly CspDirective[]): string {
  return directives
    .map(([name, values]) => {
      if (values.length === 0) {
        // Defensive: keine leeren Directives ausgeben (würde Browser-Parser brechen)
        return name;
      }
      return `${name} ${values.join(" ")}`;
    })
    .join("; ");
}

/** Convenience-Builder für den Production-Header. */
export function buildProductionCsp(): string {
  return buildCspHeader(CSP_DIRECTIVES_PROD);
}

/** Convenience-Builder für den Development-Header. */
export function buildDevCsp(): string {
  return buildCspHeader(CSP_DIRECTIVES_DEV);
}

/**
 * Liefert je nach Modus den passenden CSP-Header.
 *
 * @param isDev wenn true wird der lockere Dev-Header zurückgegeben.
 */
export function buildCspForMode(isDev: boolean): string {
  return isDev ? buildDevCsp() : buildProductionCsp();
}
