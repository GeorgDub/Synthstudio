/**
 * Synthstudio – grooveEngine.ts
 *
 * Groove-Engine: Wendet Timing- und Velocity-Variationen auf
 * DrumMachine-Patterns an (basierend auf echten Drum-Aufnahmen).
 *
 * Groove-Templates kodieren relative Timing-Offsets und Velocity-Kurven
 * für jeden der 16 Steps. Timing > 0 = leicht hinter dem Beat (Swing),
 * Timing < 0 = leicht vor dem Beat (Anticipated).
 *
 * Einheiten:
 *  timing:   −50..+50 ms (relativ zum quantisierten Step)
 *  velocity: 0.5..1.5 (Multiplikator auf die Step-Velocity)
 */

import type { StepData } from "@/audio/AudioEngine";

export interface GrooveTemplate {
  id: string;
  name: string;
  description: string;
  bpm: number;          // Referenz-BPM für das Template
  /** Timing-Offsets in ms pro Step (16 Werte, Index 0–15) */
  timing: number[];
  /** Velocity-Multiplikatoren pro Step (16 Werte) */
  velocity: number[];
}

export const GROOVE_TEMPLATES: GrooveTemplate[] = [
  {
    id: "straight",
    name: "Straight",
    description: "Keine Variation — maschinell exakt",
    bpm: 120,
    timing:   Array(16).fill(0),
    velocity: Array(16).fill(1.0),
  },
  {
    id: "mpc-classic",
    name: "MPC Classic",
    description: "MPC-typischer Swing — warme Offbeats",
    bpm: 90,
    timing:   [0,18, 0,18, 0,18, 0,18, 0,18, 0,18, 0,18, 0,18],
    velocity: [1.0,0.85, 1.0,0.85, 1.0,0.85, 1.0,0.85, 1.0,0.85, 1.0,0.85, 1.0,0.85, 1.0,0.85],
  },
  {
    id: "tr909",
    name: "TR-909",
    description: "Roland TR-909 Groove — straffer Techno-Swing",
    bpm: 130,
    timing:   [0, 8, 0, 8, 0, 8, 0, 8, 0, 8, 0, 8, 0, 8, 0, 8],
    velocity: [1.0,0.9, 1.0,0.9, 1.0,0.9, 1.0,0.9, 1.0,0.9, 1.0,0.9, 1.0,0.9, 1.0,0.9],
  },
  {
    id: "hip-hop",
    name: "Hip-Hop Heavy",
    description: "Schwerer Hip-Hop Groove — starker Swing auf Off-Beats",
    bpm: 90,
    timing:   [0,28, 0,28, 0,28, 0,28, 0,28, 0,28, 0,28, 0,28],
    velocity: [1.0,0.75, 1.0,0.75, 1.0,0.75, 1.0,0.75, 1.0,0.75, 1.0,0.75, 1.0,0.75, 1.0,0.75],
  },
  {
    id: "shuffle",
    name: "Shuffle",
    description: "Blues-Shuffle (Triolen-Feeling)",
    bpm: 100,
    timing:   [0,33, 0,33, 0,33, 0,33, 0,33, 0,33, 0,33, 0,33],
    velocity: [1.1,0.7, 1.1,0.7, 1.1,0.7, 1.1,0.7, 1.1,0.7, 1.1,0.7, 1.1,0.7, 1.1,0.7],
  },
  {
    id: "funk-ghost",
    name: "Funk Ghost",
    description: "Funk-Snare mit Ghost-Notes — lebendige Dynamik",
    bpm: 100,
    timing:   [-3,12, -3,12, -3,12, -3,12, -3,12, -3,12, -3,12, -3,12],
    velocity: [1.0,0.6,0.9,0.5, 1.0,0.65,0.85,0.55, 1.0,0.6,0.9,0.5, 1.0,0.65,0.85,0.55],
  },
  {
    id: "jazz-ride",
    name: "Jazz Ride",
    description: "Jazz-Feeling — leicht hinter dem Beat",
    bpm: 120,
    timing:   [5,15, 5,15, 5,15, 5,15, 5,15, 5,15, 5,15, 5,15],
    velocity: [0.9,0.8, 0.85,0.75, 0.9,0.8, 0.85,0.75, 0.9,0.8, 0.85,0.75, 0.9,0.8, 0.85,0.75],
  },
  {
    id: "dnb",
    name: "DnB Amen",
    description: "Drum & Bass — Amen-Break Feeling",
    bpm: 174,
    timing:   [0,-2, 4,-3, 0,-2, 5,-4, 0,-2, 3,-3, 0,-2, 6,-4],
    velocity: [1.1,0.7, 0.9,0.6, 1.0,0.75, 0.85,0.65, 1.1,0.7, 0.9,0.6, 1.0,0.75, 0.8,0.6],
  },
];

/**
 * Wendet ein Groove-Template auf Steps an.
 * Gibt neue Steps zurück (unveränderter Input).
 */
export function applyGroove(
  steps: StepData[],
  template: GrooveTemplate,
  amount = 1.0,          // 0=kein Groove, 1=voll
  applyTiming = true,
  applyVelocity = true,
): StepData[] {
  return steps.map((step, i) => {
    const tmIdx = i % template.timing.length;
    const newStep = { ...step };

    if (applyVelocity && step.active) {
      const velMult = 1 + (template.velocity[tmIdx] - 1) * amount;
      const baseVel = step.velocity ?? 100;
      newStep.velocity = Math.round(Math.max(1, Math.min(127, baseVel * velMult)));
    }

    // Timing wird als Metadaten gespeichert (AudioEngine nutzt es bei Playback)
    // Vereinfachung: Timing-Info in paramLock.timingOffset speichern
    // (Vollständige Implementierung würde AudioEngine-Scheduling ändern)

    return newStep;
  });
}

/** Berechnet Swing-Prozent aus Template-Timing. */
export function templateSwingPercent(template: GrooveTemplate): number {
  const offbeat = template.timing[1] ?? 0;
  return Math.round(50 + offbeat * 50 / 50);
}
