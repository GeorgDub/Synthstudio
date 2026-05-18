/**
 * Synthstudio – alsImport.ts
 *
 * Ableton Live Set (.als) Projekt-Parser.
 *
 * Format: GZIP-komprimiertes XML.
 * Wir nutzen `DecompressionStream` (Browser-Standard) für Gunzip + DOMParser für XML.
 */

import type { ImportResult, ImportedPattern, ImportedPart, ImportedStep } from "./types";
import { ImportError } from "./types";

// ─── Gunzip via DecompressionStream ──────────────────────────────────────────

async function gunzip(buffer: ArrayBuffer): Promise<string> {
  if (typeof DecompressionStream === "undefined") {
    throw new ImportError(
      "DecompressionStream API nicht verfügbar – moderner Browser oder Chromium-basierter Electron erforderlich.",
      "als",
    );
  }
  const stream = new Response(buffer).body!.pipeThrough(new DecompressionStream("gzip"));
  const decompressed = await new Response(stream).arrayBuffer();
  return new TextDecoder("utf-8").decode(decompressed);
}

// ─── XML-Parsing (DOMParser) ─────────────────────────────────────────────────

function parseXml(xmlString: string): Document {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "application/xml");
  const errors = doc.getElementsByTagName("parsererror");
  if (errors.length > 0) {
    throw new ImportError("Ungültiges XML in .als-Datei", "als");
  }
  return doc;
}

// ─── Helper: Value-Attribut ─────────────────────────────────────────────────

function getValueAttr(parent: Element, tagName: string): string | undefined {
  const el = parent.querySelector(tagName);
  return el?.getAttribute("Value") ?? undefined;
}

function getNumAttr(parent: Element, tagName: string): number | undefined {
  const v = getValueAttr(parent, tagName);
  if (!v) return undefined;
  const n = parseFloat(v);
  return isNaN(n) ? undefined : n;
}

// ─── Hauptfunktion ────────────────────────────────────────────────────────────

export async function importAls(file: File): Promise<ImportResult> {
  const arrayBuffer = await file.arrayBuffer();
  const xmlText = await gunzip(arrayBuffer);
  const doc = parseXml(xmlText);

  const warnings: string[] = [];

  // Tempo
  const tempoEl = doc.querySelector("Tempo, MasterTrack > DeviceChain > Mixer > Tempo");
  const bpm = tempoEl ? getNumAttr(tempoEl as Element, "Manual") : undefined;

  // Tracks finden – jeder MidiTrack könnte Drum-Pattern liefern
  const midiTracks = Array.from(doc.querySelectorAll("MidiTrack"));

  const patterns: ImportedPattern[] = [];

  for (const track of midiTracks) {
    const trackNameEl = track.querySelector("Name > EffectiveName");
    const trackName = trackNameEl?.getAttribute("Value") ?? "Track";

    // MidiClips innerhalb des Tracks
    const clips = Array.from(track.querySelectorAll("MidiClip"));
    if (clips.length === 0) continue;

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const clipName = clip.querySelector("Name")?.getAttribute("Value") ?? `${trackName} ${i + 1}`;

      // KeyTrack → Notes
      const keyTracks = Array.from(clip.querySelectorAll("KeyTrack"));
      const partMap = new Map<number, ImportedStep[]>();

      // Clip-Länge (für Step-Count-Schätzung)
      const loopEnd = getNumAttr(clip, "Loop > LoopEnd") ?? 16;
      const stepCount: 16 | 32 | 64 = loopEnd > 32 ? 64 : loopEnd > 16 ? 32 : 16;

      for (const keyTrack of keyTracks) {
        const midiKey = parseInt(keyTrack.querySelector("MidiKey")?.getAttribute("Value") ?? "60", 10);
        if (!partMap.has(midiKey)) {
          partMap.set(midiKey, Array.from({ length: stepCount }, () => ({ active: false })));
        }
        const steps = partMap.get(midiKey)!;

        // Notes pro KeyTrack
        const notes = Array.from(keyTrack.querySelectorAll("Notes > MidiNoteEvent"));
        for (const note of notes) {
          const time = parseFloat(note.getAttribute("Time") ?? "0");
          const velocity = parseFloat(note.getAttribute("Velocity") ?? "100");

          // 4 Beats = 16 Steps → Step = round(time * 4)
          const stepIdx = Math.round(time * 4);
          if (stepIdx >= 0 && stepIdx < stepCount) {
            steps[stepIdx] = { active: true, velocity: Math.round(velocity) };
          }
        }
      }

      if (partMap.size === 0) continue;

      const parts: ImportedPart[] = Array.from(partMap.entries()).map(([midiKey, steps]) => ({
        name: midiKeyToDrumName(midiKey),
        steps,
      }));

      patterns.push({
        name: clipName,
        stepCount,
        bpm,
        parts,
      });
    }
  }

  if (patterns.length === 0) {
    warnings.push("Keine MIDI-Clips mit Drum-Notes gefunden – nur BPM extrahiert.");
    patterns.push({
      name: file.name.replace(/\.als$/i, ""),
      stepCount: 16,
      bpm,
      parts: [],
    });
  }

  warnings.push(
    "Audio-Clips, Plugin-Settings, Automation und Send/Return-Tracks werden noch nicht importiert.",
  );

  return {
    sourceFormat: "als",
    fileName: file.name,
    bpm,
    patterns,
    warnings,
  };
}

// ─── GM-Drum-Map → Name (heuristisch) ─────────────────────────────────────────

function midiKeyToDrumName(midiKey: number): string {
  const drumMap: Record<number, string> = {
    35: "Kick (Acoustic)",
    36: "Kick",
    37: "Side Stick",
    38: "Snare",
    39: "Clap",
    40: "Snare (Electric)",
    41: "Tom Lo",
    42: "Hi-Hat closed",
    43: "Tom Lo (Hi)",
    44: "Pedal Hi-Hat",
    45: "Tom",
    46: "Hi-Hat open",
    47: "Tom (Hi-Mid)",
    48: "Tom Hi",
    49: "Crash",
    50: "Tom Hi (Hi)",
    51: "Ride",
  };
  return drumMap[midiKey] ?? `MIDI ${midiKey}`;
}
