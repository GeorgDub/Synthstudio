// Synthstudio – projectTemplates.ts (utils)
// Pure data – no React, no audio-engine dependencies.

export type TemplateGenre = "techno" | "house" | "hiphop" | "trap" | "ambient" | "reggaeton";

export interface ProjectTemplate {
  id: TemplateGenre;
  name: string;
  bpm: number;
  description: string;
  /** 16 booleans representing the kick pattern for UI preview */
  preview: boolean[];
  stepCount: 16 | 32;
  parts: Array<{
    name: string;
    steps: boolean[];
    defaultVelocity?: number;
  }>;
}

// ─── Template Data ────────────────────────────────────────────────────────────

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    "id": "techno",
    "name": "Techno",
    "bpm": 135,
    "description": "Minimalistisches 4/4 Techno-Pattern. Kick auf jedem Beat, Clap auf 2+4, treibende Closed-Hats.",
    "stepCount": 16,
    "preview": [true,false,false,false,true,false,false,false,true,false,false,false,true,false,false,false],
    "parts": [
      {
        "name": "Kick",
        "steps": [true,false,false,false,true,false,false,false,true,false,false,false,true,false,false,false],
        "defaultVelocity": 127
      },
      {
        "name": "Snare",
        "steps": [false,false,false,false,true,false,false,false,false,false,false,false,true,false,false,false],
        "defaultVelocity": 110
      },
      {
        "name": "Hi-Hat cl.",
        "steps": [false,false,true,false,false,false,true,false,false,false,true,false,false,false,true,false],
        "defaultVelocity": 90
      },
      {
        "name": "Hi-Hat op.",
        "steps": [false,false,false,false,false,false,true,false,false,false,false,false,false,false,true,false],
        "defaultVelocity": 80
      },
      {
        "name": "Perc",
        "steps": [false,false,false,true,false,false,false,false,false,false,false,true,false,false,false,false],
        "defaultVelocity": 85
      }
    ]
  },
  {
    "id": "house",
    "name": "House",
    "bpm": 124,
    "description": "4-on-the-floor House. Offbeat-Clap auf 2+4, shuffled Hi-Hats, Shaker-Groove.",
    "stepCount": 16,
    "preview": [true,false,false,false,true,false,false,false,true,false,false,false,true,false,false,false],
    "parts": [
      {
        "name": "Kick",
        "steps": [true,false,false,false,true,false,false,false,true,false,false,false,true,false,false,false],
        "defaultVelocity": 127
      },
      {
        "name": "Clap",
        "steps": [false,false,false,false,true,false,false,false,false,false,false,false,true,false,false,false],
        "defaultVelocity": 115
      },
      {
        "name": "Hi-Hat cl.",
        "steps": [false,false,true,false,false,false,true,false,false,false,true,false,false,false,true,false],
        "defaultVelocity": 85
      },
      {
        "name": "Hi-Hat op.",
        "steps": [false,false,false,false,false,false,true,false,false,false,false,false,false,false,true,false],
        "defaultVelocity": 78
      },
      {
        "name": "Shaker",
        "steps": [true,false,false,false,true,false,false,false,true,false,false,false,true,false,false,false],
        "defaultVelocity": 65
      }
    ]
  },
  {
    "id": "hiphop",
    "name": "Hip-Hop",
    "bpm": 90,
    "description": "Laid-back Hip-Hop Groove. Kick auf 1+3 mit Ghostnote, Snare auf 2+4, 16th-Hat-Rolle.",
    "stepCount": 16,
    "preview": [true,false,false,false,false,false,true,false,true,false,false,false,false,false,false,false],
    "parts": [
      {
        "name": "Kick",
        "steps": [true,false,false,false,false,false,true,false,true,false,false,false,false,false,false,false],
        "defaultVelocity": 120
      },
      {
        "name": "Snare",
        "steps": [false,false,false,false,true,false,false,false,false,false,false,false,true,false,false,false],
        "defaultVelocity": 110
      },
      {
        "name": "Hi-Hat cl.",
        "steps": [true,false,true,false,true,false,true,false,true,false,true,false,true,false,true,false],
        "defaultVelocity": 75
      },
      {
        "name": "Hi-Hat op.",
        "steps": [false,false,false,false,false,false,true,false,false,false,false,false,false,false,true,false],
        "defaultVelocity": 70
      },
      {
        "name": "Perc",
        "steps": [false,false,false,true,false,false,false,true,false,false,false,true,false,false,false,true],
        "defaultVelocity": 80
      }
    ]
  },
  {
    "id": "trap",
    "name": "Trap",
    "bpm": 140,
    "description": "808 Trap. Rattling 32nd-Hi-Hats mit Velocity-Variation, Kick auf 1+3, harter Snare auf 2.",
    "stepCount": 16,
    "preview": [true,false,false,false,false,false,false,false,false,false,true,false,false,false,false,false],
    "parts": [
      {
        "name": "Kick",
        "steps": [true,false,false,false,false,false,false,false,false,false,true,false,false,false,false,false],
        "defaultVelocity": 127
      },
      {
        "name": "Snare",
        "steps": [false,false,false,false,true,false,false,false,false,false,false,false,false,false,false,false],
        "defaultVelocity": 120
      },
      {
        "name": "Hi-Hat cl.",
        "steps": [true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true],
        "defaultVelocity": 70
      },
      {
        "name": "Hi-Hat op.",
        "steps": [false,false,true,false,false,false,false,false,false,false,true,false,false,false,false,false],
        "defaultVelocity": 90
      },
      {
        "name": "Perc",
        "steps": [false,true,false,false,false,true,false,false,false,true,false,false,false,true,false,false],
        "defaultVelocity": 80
      }
    ]
  },
  {
    "id": "ambient",
    "name": "Ambient",
    "bpm": 80,
    "description": "Ruhiges Ambient-Pattern. Minimale Perkussion, atmende Pad-Hits, viel Raum.",
    "stepCount": 16,
    "preview": [true,false,false,false,false,false,false,false,true,false,false,false,false,false,false,false],
    "parts": [
      {
        "name": "Kick",
        "steps": [true,false,false,false,false,false,false,false,true,false,false,false,false,false,false,false],
        "defaultVelocity": 90
      },
      {
        "name": "Snare",
        "steps": [false,false,false,false,false,false,false,false,true,false,false,false,false,false,false,false],
        "defaultVelocity": 80
      },
      {
        "name": "Hi-Hat cl.",
        "steps": [false,false,false,false,true,false,false,false,false,false,false,false,true,false,false,false],
        "defaultVelocity": 55
      },
      {
        "name": "Hi-Hat op.",
        "steps": [false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false],
        "defaultVelocity": 60
      },
      {
        "name": "Pad/Perc",
        "steps": [true,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false],
        "defaultVelocity": 70
      }
    ]
  },
  {
    "id": "reggaeton",
    "name": "Reggaeton",
    "bpm": 100,
    "description": "Dembow-Rhythmus. Kick-Snare auf Beat 1 und '+2', Shaker-Groove, treibende Hats.",
    "stepCount": 16,
    "preview": [true,false,false,false,false,false,false,false,true,false,false,false,true,false,false,false],
    "parts": [
      {
        "name": "Kick",
        "steps": [true,false,false,false,false,false,false,false,true,false,false,false,true,false,false,false],
        "defaultVelocity": 127
      },
      {
        "name": "Snare",
        "steps": [false,false,false,false,true,false,false,false,false,false,false,false,false,false,true,false],
        "defaultVelocity": 115
      },
      {
        "name": "Hi-Hat cl.",
        "steps": [true,false,true,false,true,false,true,false,true,false,true,false,true,false,true,false],
        "defaultVelocity": 80
      },
      {
        "name": "Hi-Hat op.",
        "steps": [false,false,false,false,false,false,true,false,false,false,false,false,false,false,true,false],
        "defaultVelocity": 85
      },
      {
        "name": "Shaker",
        "steps": [true,false,false,false,true,false,false,false,true,false,false,false,true,false,false,false],
        "defaultVelocity": 72
      }
    ]
  }
] as ProjectTemplate[];

// ─── Helper ───────────────────────────────────────────────────────────────────

export function getTemplate(id: TemplateGenre): ProjectTemplate | undefined {
  return PROJECT_TEMPLATES.find((t) => t.id === id);
}
