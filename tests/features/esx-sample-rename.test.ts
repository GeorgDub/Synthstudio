import { describe, it, expect } from "vitest";
import {
  renameEsxBankSample,
  renameEsxBankSamples,
  encodeEsxName,
  getEsxMonoHeaderOffset,
  EsxSamplePatchError,
} from "../../client/src/utils/korg/esxSamplePatcher";
import { parseEsxBank } from "../../client/src/utils/korg/esxParser";
import {
  stageEsxSampleRename,
  unstageEsxSampleRename,
  countPendingEsxSampleRenames,
  hasPendingEsxSampleRenames,
  commitEsxSampleRenames,
  esxSampleRenameKey,
} from "../../client/src/utils/korg/esxBankEditorState";
import type { EsxSampleRename } from "../../client/src/utils/korg/esxSamplePatcher";
import {
  ESX1_ADDR_NUM_MONO_SAMPLES,
  ESX1_ADDR_PATTERN_DATA,
  ESX1_ADDR_SAMPLE_DATA,
  ESX1_ADDR_SAMPLE_HEADER_MONO,
  ESX1_ADDR_SAMPLE_HEADER_STEREO,
  ESX1_ADDR_SONG_DATA,
  ESX1_ADDR_VALID_CHECK_2,
  ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO,
  ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO,
  ESX1_EMPTY_OFFSET,
  ESX1_SIGNATURE,
  ESX1_SIZE_FILE_MIN,
  ESX1_SUBMAGIC,
  ESX1_SUBMAGIC_OFFSET,
} from "../../client/src/utils/korg/constants";

/** Baut eine minimale, parsebare ESX-Bank mit einem Mono-Sample in Slot `index`. */
function buildBankWithMonoSample(index: number, name: string): Uint8Array {
  const pcmFrames = 32;
  const pcmBytes = new Uint8Array(pcmFrames * 2); // BE i16
  for (let i = 0; i < pcmBytes.length; i++) pcmBytes[i] = (i * 7 + 1) & 0xff;

  const size = ESX1_SIZE_FILE_MIN + pcmBytes.byteLength + 1024;
  const buf = new Uint8Array(size);
  // Deterministischer Füllmüll (verifiziert Bit-Exaktheit außerhalb der Namen).
  for (let i = ESX1_ADDR_PATTERN_DATA; i < ESX1_ADDR_SONG_DATA; i++)
    buf[i] = (i * 13 + 7) & 0xff;
  for (let i = ESX1_ADDR_SONG_DATA; i < ESX1_ADDR_VALID_CHECK_2; i++)
    buf[i] = (i * 23 + 11) & 0xff;

  buf.set(ESX1_SIGNATURE, 0);
  buf.set(ESX1_SUBMAGIC, ESX1_SUBMAGIC_OFFSET);
  buf.set(ESX1_SIGNATURE, ESX1_ADDR_VALID_CHECK_2);

  const dv = new DataView(buf.buffer);
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 0, 1, false);
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 4, 0, false);

  // Alle Header leer.
  for (let i = 0; i < 256; i++) {
    const off =
      ESX1_ADDR_SAMPLE_HEADER_MONO + i * ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO;
    dv.setUint32(off + 8, ESX1_EMPTY_OFFSET, false);
    dv.setUint32(off + 12, ESX1_EMPTY_OFFSET, false);
  }
  for (let i = 0; i < 128; i++) {
    const off =
      ESX1_ADDR_SAMPLE_HEADER_STEREO + i * ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO;
    dv.setUint32(off + 8, ESX1_EMPTY_OFFSET, false);
    dv.setUint32(off + 12, ESX1_EMPTY_OFFSET, false);
    dv.setUint32(off + 16, ESX1_EMPTY_OFFSET, false);
    dv.setUint32(off + 20, ESX1_EMPTY_OFFSET, false);
  }

  // Mono-Slot `index` belegen.
  const off =
    ESX1_ADDR_SAMPLE_HEADER_MONO + index * ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO;
  buf.set(encodeEsxName(name), off);
  dv.setUint32(off + 8, 0, false);
  dv.setUint32(off + 12, pcmBytes.byteLength, false);
  dv.setUint32(off + 16, 0, false);
  dv.setUint32(off + 20, pcmFrames, false);
  dv.setUint32(off + 24, 0, false);
  dv.setUint32(off + 28, 44100, false);
  buf[off + 34] = 100;
  buf.set(pcmBytes, ESX1_ADDR_SAMPLE_DATA + 0);
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 8, pcmBytes.byteLength, false);

  return buf;
}

describe("renameEsxBankSample — Round-Trip", () => {
  it("neuer Name wird von parseEsxBank zurückgelesen", () => {
    const bank = buildBankWithMonoSample(3, "OLD");
    const before = parseEsxBank(bank, "t.esx");
    expect(before.monoSamples.find(s => s.index === 3)?.name).toBe("OLD");

    const renamed = renameEsxBankSample(bank, {
      index: 3,
      channels: 1,
      name: "KICK99",
    });
    const after = parseEsxBank(new Uint8Array(renamed), "t.esx");
    expect(after.monoSamples.find(s => s.index === 3)?.name).toBe("KICK99");
  });

  it("gleiche Länge, byte-identisch außer den 8 Name-Bytes", () => {
    const bank = buildBankWithMonoSample(3, "OLD");
    const renamed = new Uint8Array(
      renameEsxBankSample(bank, { index: 3, channels: 1, name: "NEW" })
    );
    expect(renamed.byteLength).toBe(bank.byteLength);

    const nameOff = getEsxMonoHeaderOffset(3);
    let diffCount = 0;
    for (let i = 0; i < bank.byteLength; i++) {
      if (bank[i] !== renamed[i]) {
        diffCount++;
        // Jede Abweichung liegt im 8-Byte-Namensfeld.
        expect(i).toBeGreaterThanOrEqual(nameOff);
        expect(i).toBeLessThan(nameOff + 8);
      }
    }
    expect(diffCount).toBeGreaterThan(0);
  });

  it("langer Name wird auf 8 Zeichen gekürzt", () => {
    const bank = buildBankWithMonoSample(0, "A");
    const renamed = parseEsxBank(
      new Uint8Array(
        renameEsxBankSample(bank, {
          index: 0,
          channels: 1,
          name: "VERYLONGNAME",
        })
      ),
      "t.esx"
    );
    expect(renamed.monoSamples.find(s => s.index === 0)?.name).toBe("VERYLONG");
  });
});

describe("renameEsxBankSamples — Batch + Validierung", () => {
  it("mehrere Renames in einem Pass", () => {
    const bank = buildBankWithMonoSample(0, "A");
    // Slot 5 zusätzlich belegen wäre aufwändig; wir prüfen 2× denselben Slot →
    // letzter gewinnt (dokumentiertes Verhalten).
    const renamed = new Uint8Array(
      renameEsxBankSamples(bank, [
        { index: 0, channels: 1, name: "FIRST" },
        { index: 0, channels: 1, name: "SECOND" },
      ])
    );
    const parsed = parseEsxBank(renamed, "t.esx");
    expect(parsed.monoSamples.find(s => s.index === 0)?.name).toBe("SECOND");
  });

  it("Slot-Index außerhalb der Range → wirft", () => {
    const bank = buildBankWithMonoSample(0, "A");
    expect(() =>
      renameEsxBankSample(bank, { index: 999, channels: 1, name: "X" })
    ).toThrow(EsxSamplePatchError);
  });

  it("ungültige Kanalzahl → wirft", () => {
    const bank = buildBankWithMonoSample(0, "A");
    expect(() =>
      renameEsxBankSamples(bank, [
        { index: 0, channels: 3 as unknown as 1, name: "X" },
      ])
    ).toThrow(EsxSamplePatchError);
  });

  it("kaputte Bank (falsches Magic) → wirft", () => {
    const bad = new Uint8Array(ESX1_SIZE_FILE_MIN);
    expect(() =>
      renameEsxBankSample(bad, { index: 0, channels: 1, name: "X" })
    ).toThrow(EsxSamplePatchError);
  });
});

describe("Rename-Staging (esxBankEditorState)", () => {
  it("stage/unstage/count — mono + stereo teilen sich Slot-Index nicht", () => {
    let pending = new Map<string, EsxSampleRename>();
    expect(hasPendingEsxSampleRenames(pending)).toBe(false);
    pending = stageEsxSampleRename(pending, {
      index: 3,
      channels: 1,
      name: "M3",
    });
    pending = stageEsxSampleRename(pending, {
      index: 3,
      channels: 2,
      name: "S3",
    });
    expect(countPendingEsxSampleRenames(pending)).toBe(2);
    expect(pending.get(esxSampleRenameKey(1, 3))?.name).toBe("M3");
    expect(pending.get(esxSampleRenameKey(2, 3))?.name).toBe("S3");

    pending = unstageEsxSampleRename(pending, 1, 3);
    expect(countPendingEsxSampleRenames(pending)).toBe(1);
    // unstage eines nicht vorhandenen → gleiche Referenz
    const same = unstageEsxSampleRename(pending, 1, 99);
    expect(same).toBe(pending);
  });

  it("last-write-wins pro Slot", () => {
    let pending = new Map<string, EsxSampleRename>();
    pending = stageEsxSampleRename(pending, {
      index: 0,
      channels: 1,
      name: "A",
    });
    pending = stageEsxSampleRename(pending, {
      index: 0,
      channels: 1,
      name: "B",
    });
    expect(countPendingEsxSampleRenames(pending)).toBe(1);
    expect(pending.get(esxSampleRenameKey(1, 0))?.name).toBe("B");
  });

  it("commitEsxSampleRenames wendet gestagte Renames an (Round-Trip)", () => {
    const bank = buildBankWithMonoSample(2, "OLD");
    let pending = new Map<string, EsxSampleRename>();
    pending = stageEsxSampleRename(pending, {
      index: 2,
      channels: 1,
      name: "FRESH",
    });
    const out = commitEsxSampleRenames(bank, pending);
    const parsed = parseEsxBank(new Uint8Array(out), "t.esx");
    expect(parsed.monoSamples.find(s => s.index === 2)?.name).toBe("FRESH");
  });

  it("leere Map → frische Kopie (kein Mutations-Leak)", () => {
    const bank = buildBankWithMonoSample(0, "A");
    const out = commitEsxSampleRenames(bank, new Map());
    const outBytes = new Uint8Array(out);
    expect(out.byteLength).toBe(bank.byteLength);
    // Byte-Gleichheit ohne teures toEqual-Diff auf ~2.4 MB.
    let identical = true;
    for (let i = 0; i < bank.byteLength; i++) {
      if (outBytes[i] !== bank[i]) {
        identical = false;
        break;
      }
    }
    expect(identical).toBe(true);
    expect(out).not.toBe(bank.buffer);
  });
});
