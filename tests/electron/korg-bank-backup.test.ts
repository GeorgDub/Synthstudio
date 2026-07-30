/**
 * Synthstudio – Auto-Backup für `.all`-Bänke (electron/korgBankBackup.ts)
 *
 * Kein Electron-, kein echter fs-Zugriff: das Modul nimmt ein injiziertes
 * `BackupFs`, hier ein In-Memory-Fake. Geprüft wird vor allem die
 * **Reihenfolge** der Rotation — sie ist der Teil, an dem eine naive
 * Implementierung Daten verliert, ohne dass es auffällt.
 */
import { describe, it, expect } from "vitest";
import {
  KORG_BANK_BACKUP_KEEP,
  backupPathFor,
  rotateBankBackups,
  nodeBackupFs,
  type BackupFs,
} from "../../electron/korgBankBackup";

/** In-Memory-Dateisystem: Pfad → Inhalt. Protokolliert alle Operationen. */
function fakeFs(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const ops: string[] = [];
  const fs: BackupFs = {
    async exists(p) {
      return files.has(p);
    },
    async copy(from, to) {
      ops.push(`copy ${from} -> ${to}`);
      const v = files.get(from);
      if (v === undefined) throw new Error(`copy: ${from} fehlt`);
      files.set(to, v);
    },
    async remove(p) {
      ops.push(`remove ${p}`);
      files.delete(p);
    },
  };
  return { fs, files, ops };
}

const BANK = "/music/e2sSample.all";

describe("backupPathFor", () => {
  it("nennt die erste Generation ohne Zahl", () => {
    // Das ist die Datei, die man sucht, wenn man "die vorige Version" will.
    expect(backupPathFor(BANK, 1)).toBe("/music/e2sSample.all.bak");
  });

  it("numeriert ältere Generationen", () => {
    expect(backupPathFor(BANK, 2)).toBe("/music/e2sSample.all.bak2");
    expect(backupPathFor(BANK, 3)).toBe("/music/e2sSample.all.bak3");
  });

  it("weist Generation 0 und negative zurück", () => {
    expect(() => backupPathFor(BANK, 0)).toThrow(RangeError);
    expect(() => backupPathFor(BANK, -1)).toThrow(RangeError);
  });
});

describe("rotateBankBackups", () => {
  it("tut nichts, wenn das Ziel eine neue Datei ist", () => {
    // Beim ersten Speichern gibt es nichts zu sichern — es darf auch keine
    // leere .bak entstehen.
    const { fs, files, ops } = fakeFs();
    return rotateBankBackups(BANK, fs).then(res => {
      expect(res).toEqual({ created: false, backupPath: null, droppedPath: null });
      expect(ops).toEqual([]);
      expect(files.size).toBe(0);
    });
  });

  it("legt beim ersten Überschreiben eine .bak an", async () => {
    const { fs, files } = fakeFs({ [BANK]: "v1" });
    const res = await rotateBankBackups(BANK, fs);
    expect(res.created).toBe(true);
    expect(res.backupPath).toBe(`${BANK}.bak`);
    expect(files.get(`${BANK}.bak`)).toBe("v1");
    // Das Original bleibt liegen — geschrieben wird es erst danach vom Aufrufer.
    expect(files.get(BANK)).toBe("v1");
  });

  it("schiebt bestehende Sicherungen eine Generation weiter", async () => {
    const { fs, files } = fakeFs({
      [BANK]: "v3",
      [`${BANK}.bak`]: "v2",
      [`${BANK}.bak2`]: "v1",
    });
    await rotateBankBackups(BANK, fs);
    expect(files.get(`${BANK}.bak`)).toBe("v3");
    expect(files.get(`${BANK}.bak2`)).toBe("v2");
    expect(files.get(`${BANK}.bak3`)).toBe("v1");
  });

  it("rotiert von hinten nach vorn — sonst überschreibt sich die Kette selbst", async () => {
    // Der eigentliche Fallstrick. Liefe die Schleife vorwärts, würde .bak
    // zuerst nach .bak2 kopiert, danach .bak2 (bereits der neue Inhalt) nach
    // .bak3 — zwei Generationen wären identisch und eine verloren.
    const { fs, ops } = fakeFs({
      [BANK]: "v3",
      [`${BANK}.bak`]: "v2",
      [`${BANK}.bak2`]: "v1",
    });
    await rotateBankBackups(BANK, fs);
    const copies = ops.filter(o => o.startsWith("copy"));
    expect(copies).toEqual([
      `copy ${BANK}.bak2 -> ${BANK}.bak3`,
      `copy ${BANK}.bak -> ${BANK}.bak2`,
      `copy ${BANK} -> ${BANK}.bak`,
    ]);
  });

  it("verwirft die älteste Generation und meldet das", async () => {
    const { fs, files } = fakeFs({
      [BANK]: "v4",
      [`${BANK}.bak`]: "v3",
      [`${BANK}.bak2`]: "v2",
      [`${BANK}.bak3`]: "v1",
    });
    const res = await rotateBankBackups(BANK, fs);
    expect(res.droppedPath).toBe(`${BANK}.bak3`);
    // v1 ist raus, alles andere eine Stufe weiter.
    expect(files.get(`${BANK}.bak3`)).toBe("v2");
    expect(files.get(`${BANK}.bak2`)).toBe("v3");
    expect(files.get(`${BANK}.bak`)).toBe("v4");
    expect([...files.values()]).not.toContain("v1");
  });

  it("hält die Kette über viele Speichervorgänge auf keep begrenzt", async () => {
    const { fs, files } = fakeFs({ [BANK]: "gen0" });
    for (let i = 1; i <= 8; i++) {
      await rotateBankBackups(BANK, fs);
      files.set(BANK, `gen${i}`); // der Aufrufer schreibt danach
    }
    const baks = [...files.keys()].filter(k => k.includes(".bak"));
    expect(baks).toHaveLength(KORG_BANK_BACKUP_KEEP);
    // Die drei jüngsten Vorgänger, absteigend.
    expect(files.get(`${BANK}.bak`)).toBe("gen7");
    expect(files.get(`${BANK}.bak2`)).toBe("gen6");
    expect(files.get(`${BANK}.bak3`)).toBe("gen5");
  });

  it("respektiert ein abweichendes keep", async () => {
    const { fs, files } = fakeFs({ [BANK]: "a" });
    for (let i = 0; i < 4; i++) {
      await rotateBankBackups(BANK, fs, 1);
      files.set(BANK, `x${i}`);
    }
    const baks = [...files.keys()].filter(k => k.includes(".bak"));
    expect(baks).toEqual([`${BANK}.bak`]);
  });

  it("schluckt Fehler nicht — ohne Sicherung soll der Aufrufer entscheiden", async () => {
    const { fs } = fakeFs({ [BANK]: "v1" });
    const failing: BackupFs = {
      ...fs,
      copy: async () => {
        throw new Error("EACCES");
      },
    };
    await expect(rotateBankBackups(BANK, failing)).rejects.toThrow("EACCES");
  });
});

describe("nodeBackupFs", () => {
  it("bildet access() auf exists() ab, ohne zu werfen", async () => {
    const present = nodeBackupFs({
      access: async () => undefined,
      copyFile: async () => undefined,
      unlink: async () => undefined,
    });
    await expect(present.exists("/x")).resolves.toBe(true);

    const missing = nodeBackupFs({
      access: async () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
      copyFile: async () => undefined,
      unlink: async () => undefined,
    });
    await expect(missing.exists("/x")).resolves.toBe(false);
  });

  it("reicht copy/remove an fs weiter", async () => {
    const calls: string[] = [];
    const io = nodeBackupFs({
      access: async () => undefined,
      copyFile: async (a, b) => {
        calls.push(`copy:${a}:${b}`);
      },
      unlink: async p => {
        calls.push(`unlink:${p}`);
      },
    });
    await io.copy("/a", "/b");
    await io.remove("/c");
    expect(calls).toEqual(["copy:/a:/b", "unlink:/c"]);
  });
});
