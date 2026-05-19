// @vitest-environment node
/**
 * sample-embed-app-wiring.test.ts — v3.137.0
 *
 * Integrations-Smoke-Tests für den App.tsx Save/Load-Pipeline-Wire.
 * Diese Tests instanziieren NICHT App.tsx (DOM-frei, läuft in Node), sondern
 * verifizieren dass die Pipeline-Helpers (prepareProjectForSave +
 * restoreEmbeddedSamples) im wiring-Pfad korrekt zusammenspielen — selbe
 * Inputs/Outputs wie App.tsx, nur ohne React-Render.
 *
 * Zweck: bei Refactoring der App.tsx-Save-Pipeline (z.B. neues Embed-Toggle)
 * fängt dieser Test sofort einen Regression-Bruch ab.  Closes v3.131-Caveat.
 */

import { describe, it, expect } from "vitest";
import {
  prepareProjectForSave,
  restoreEmbeddedSamples,
  countBlobUrlSamples,
  type EmbedProjectLike,
} from "../../client/src/utils/sampleEmbeddingFlow";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

// ─── Mock-Helpers (DOM-frei) ────────────────────────────────────────────────

/**
 * Liefert einen synthetischen AudioBufferLike mit 440Hz Sinus.
 * 100ms @ 48kHz mono → 4800 Frames.  Inhalts-Variation via Seed damit
 * Multi-Sample-Tests deterministisch unterschiedliche Buffers erzeugen können.
 */
function makeMockBuffer(
  durationSec = 0.1,
  sampleRate = 48000,
  channels = 1,
  freqHz = 440,
): AudioBufferLike {
  const length = Math.floor(durationSec * sampleRate);
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    data[i] = Math.sin((i / sampleRate) * freqHz * 2 * Math.PI) * 0.5;
  }
  return {
    sampleRate,
    numberOfChannels: channels,
    length,
    getChannelData: () => data,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("v3.137 App.tsx Save-Pipeline-Wire — prepareProjectForSave integration", () => {
  it("Blob-URL-Sample mit working loadAudioBuffer → embeddedData wird gesetzt", async () => {
    // Simuliert den App.tsx doSaveProject-Pfad: Sample hat path="blob:..." und
    // wir injizieren einen loadAudioBuffer-Adapter der einen Mock-Buffer liefert.
    const project: EmbedProjectLike = {
      samples: [
        { id: "transformed-kick", path: "blob:http://localhost/abc123", name: "Kick (transformed)" },
      ],
    };

    const blobCount = countBlobUrlSamples(project);
    expect(blobCount).toBe(1);

    const result = await prepareProjectForSave(project, {
      embedTransformed: true,
      loadAudioBuffer: async () => makeMockBuffer(0.1, 48000, 1, 440),
    });

    const s = result.samples?.[0];
    expect(s).toBeDefined();
    expect(typeof s!.embeddedData).toBe("string");
    expect(s!.embeddedData!.length).toBeGreaterThan(0);
    // Original-Felder bleiben erhalten (shallow-merge)
    expect(s!.id).toBe("transformed-kick");
    expect(s!.name).toBe("Kick (transformed)");
    expect(s!.path).toBe("blob:http://localhost/abc123");
  });
});

describe("v3.137 App.tsx Load-Pipeline-Wire — restoreEmbeddedSamples integration", () => {
  it("Round-Trip: prepareForSave → restoreEmbeddedSamples → frische Blob-URL", async () => {
    // Simuliert kompletten Save→Load-Cycle ohne tatsächlich auf Disk zu schreiben.
    const project: EmbedProjectLike = {
      samples: [
        { id: "snare-fx", path: "blob:http://orig/xyz", name: "Snare (FX)" },
      ],
    };

    // Save-Phase: embed.
    const saved = await prepareProjectForSave(project, {
      embedTransformed: true,
      loadAudioBuffer: async () => makeMockBuffer(0.05, 44100, 1, 880),
    });
    const embedded = saved.samples?.[0];
    expect(embedded?.embeddedData).toBeDefined();

    // Simuliere Reload: Path ist invalide (Blob-URL gone) — App.tsx setzt
    // bei Browser-Restore das path-Feld bewusst nicht zurück, aber für den
    // Test simulieren wir "frischer Browser-Reload" indem wir die alte
    // Blob-URL als ungültig kennzeichnen (path="" wäre realistisch nach
    // Page-Refresh + Reimport).  restoreEmbeddedSamples skipt jedoch wenn
    // path bereits Blob-URL ist (defensive double-decode-prevention) —
    // wir setzen daher path="" um den echten Restore-Pfad zu testen.
    const reloadedInput: EmbedProjectLike = {
      samples: [
        { ...embedded!, path: "" },
      ],
    };

    let decodeCalled = 0;
    const restored = await restoreEmbeddedSamples(reloadedInput, {
      decodeToBlobUrl: async (b64) => {
        decodeCalled++;
        expect(typeof b64).toBe("string");
        expect(b64.length).toBeGreaterThan(0);
        return "blob:http://restored/freshurl";
      },
    });

    expect(decodeCalled).toBe(1);
    const s = restored.samples?.[0];
    expect(s).toBeDefined();
    expect(s!.path).toBe("blob:http://restored/freshurl");
    // embeddedData bleibt im Sample drin (für späteren Re-Save ohne neuen Embed)
    expect(s!.embeddedData).toBe(embedded!.embeddedData);
    // Original-Felder erhalten
    expect(s!.id).toBe("snare-fx");
    expect(s!.name).toBe("Snare (FX)");
  });
});

describe("v3.137 App.tsx Save-Pipeline-Wire — No-Op-Path", () => {
  it("Project ohne Blob-URL-Samples → samples-Inhalt identisch, kein loadAudioBuffer-Call", async () => {
    // Simuliert App.tsx-Pfad bei Disk-Samples (Electron) oder Pack-Refs:
    // countBlobUrlSamples liefert 0 → Pipeline wird gar nicht aufgerufen
    // (siehe App.tsx if (blobCount > 0)).  Hier verifizieren wir die
    // Library-Garantie: auch wenn Pipeline trotzdem läuft, ist sie no-op.
    const project: EmbedProjectLike = {
      samples: [
        { id: "disk-kick", path: "file:///C:/samples/kick.wav", name: "Kick", tags: ["drum", "punchy"] },
        { id: "pack-snare", path: "pack:readFile:snare.wav", name: "Snare" },
      ],
    };

    expect(countBlobUrlSamples(project)).toBe(0);

    let loadCalled = false;
    const result = await prepareProjectForSave(project, {
      embedTransformed: true,
      loadAudioBuffer: async () => {
        loadCalled = true;
        return makeMockBuffer();
      },
    });

    expect(loadCalled).toBe(false);
    // Samples-Inhalt identisch (keine embeddedData hinzugefügt)
    expect(result.samples).toHaveLength(2);
    expect(result.samples?.[0].embeddedData).toBeUndefined();
    expect(result.samples?.[1].embeddedData).toBeUndefined();
    expect(result.samples?.[0].path).toBe("file:///C:/samples/kick.wav");
    expect(result.samples?.[1].path).toBe("pack:readFile:snare.wav");
    // Original-Felder erhalten
    expect(result.samples?.[0].tags).toEqual(["drum", "punchy"]);
  });
});
