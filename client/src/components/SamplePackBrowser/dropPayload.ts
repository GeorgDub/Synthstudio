/**
 * Synthstudio – Pack-Sample Drag-Drop Payload (v3.107.0)
 *
 * Pure-Helper: parse + validate dataTransfer payload für die MIME
 * `application/x-synthstudio-pack-sample`. Wird vom SamplePackBrowser
 * gesendet (drag-start) und von DrumMachine ChannelStrip empfangen (drop).
 */

export interface PackSampleDragPayload {
  sampleId: string;
  packId: string;
  filename: string;
  relPath: string;
}

export const PACK_SAMPLE_DRAG_MIME = "application/x-synthstudio-pack-sample";

/**
 * Parsed das JSON-Payload und prüft Pflicht-Felder. Liefert null bei jeder
 * Form von Garbage (kein Throw — Drops sind häufig und sollen den UI nicht
 * stören).
 */
export function parsePackSamplePayload(raw: unknown): PackSampleDragPayload | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  if (
    typeof p.sampleId !== "string" || p.sampleId.length === 0 ||
    typeof p.packId !== "string" || p.packId.length === 0 ||
    typeof p.filename !== "string" || p.filename.length === 0 ||
    typeof p.relPath !== "string"
  ) return null;
  return {
    sampleId: p.sampleId,
    packId: p.packId,
    filename: p.filename,
    relPath: p.relPath,
  };
}
