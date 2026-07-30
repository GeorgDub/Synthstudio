/**
 * korgBankBackup.ts — rotierende Sicherung vor dem Überschreiben einer `.all`.
 *
 * Warum das existiert: `korg:save-bank-as` schrieb bisher direkt über eine
 * bestehende Datei. Eine `.all`-Bank ist aber nicht wiederherstellbar — sie
 * enthält die dekodierten Samples in Gerätekodierung, und wenn die Quell-WAVs
 * nicht mehr vorliegen, ist der Inhalt weg. Ein einziger Fehlgriff im
 * Speichern-Dialog kostete damit eine ganze Bank.
 *
 * Konkreter Anlass: eine am Gerät verifizierte Bank (die einzige ihrer Art im
 * Bestand) lag zum Zeitpunkt der Implementierung ungesichert vor.
 *
 * Kein Electron-Import — reine Node-Logik mit injizierbarem Dateisystem, damit
 * die Rotation ohne echte Dateien testbar ist.
 */

/** Wie viele Generationen aufbewahrt werden (`.bak`, `.bak2`, `.bak3`). */
export const KORG_BANK_BACKUP_KEEP = 3;

/**
 * Minimal-Schnittstelle aufs Dateisystem — genau die vier Operationen, die die
 * Rotation braucht. Erlaubt Tests ohne Platten-I/O.
 */
export interface BackupFs {
  exists(path: string): Promise<boolean>;
  copy(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

/**
 * Name der n-ten Sicherung (1-basiert): `bank.all` → `bank.all.bak`,
 * `bank.all.bak2`, `bank.all.bak3`.
 *
 * Die erste Generation heißt bewusst `.bak` ohne Zahl — das ist die Datei, die
 * ein Nutzer sucht, wenn er „die vorige Version" will.
 */
export function backupPathFor(filePath: string, generation: number): string {
  if (generation < 1) throw new RangeError(`generation muss >= 1 sein, war ${generation}`);
  return generation === 1 ? `${filePath}.bak` : `${filePath}.bak${generation}`;
}

export interface BackupResult {
  /** Wurde eine Sicherung angelegt? `false`, wenn das Ziel eine neue Datei ist. */
  created: boolean;
  /** Pfad der neuen `.bak`-Datei (nur bei `created`). */
  backupPath: string | null;
  /** Ältere Generation, die dabei verworfen wurde (nur wenn `keep` erreicht war). */
  droppedPath: string | null;
}

/**
 * Sichert `filePath`, falls vorhanden, und schiebt bestehende Sicherungen eine
 * Generation weiter.
 *
 * Reihenfolge ist wichtig und läuft **von hinten nach vorn**: erst die älteste
 * verwerfen, dann `.bak2 → .bak3`, `.bak → .bak2`, zuletzt das Original nach
 * `.bak`. Andersherum würde jede Kopie die nächste überschreiben, bevor sie
 * gesichert ist.
 *
 * `copy` statt `rename`, damit ein Absturz zwischen den Schritten nie die
 * Originaldatei verschwinden lässt — im schlimmsten Fall existiert dieselbe
 * Bank zweimal.
 *
 * Fehler werden bewusst **nicht** geschluckt: wenn die Sicherung scheitert,
 * soll der Aufrufer entscheiden, ob trotzdem geschrieben wird. Stillschweigend
 * ohne Backup weiterzuschreiben wäre das Gegenteil des Zwecks.
 */
export async function rotateBankBackups(
  filePath: string,
  fs: BackupFs,
  keep: number = KORG_BANK_BACKUP_KEEP,
): Promise<BackupResult> {
  if (!(await fs.exists(filePath))) {
    return { created: false, backupPath: null, droppedPath: null };
  }

  const generations = Math.max(1, Math.floor(keep));

  // Älteste Generation fällt raus, sonst wächst die Kette unbegrenzt.
  let droppedPath: string | null = null;
  const oldest = backupPathFor(filePath, generations);
  if (await fs.exists(oldest)) {
    await fs.remove(oldest);
    droppedPath = oldest;
  }

  // Von hinten nach vorn durchschieben.
  for (let g = generations - 1; g >= 1; g--) {
    const from = backupPathFor(filePath, g);
    if (await fs.exists(from)) {
      await fs.copy(from, backupPathFor(filePath, g + 1));
    }
  }

  const target = backupPathFor(filePath, 1);
  await fs.copy(filePath, target);
  return { created: true, backupPath: target, droppedPath };
}

/**
 * `BackupFs` auf Basis von `node:fs/promises`.
 *
 * Als Factory und nicht als Modul-Konstante, damit dieses Modul in Tests ohne
 * `fs`-Zugriff importierbar bleibt.
 */
export function nodeBackupFs(fsPromises: {
  access: (p: string) => Promise<void>;
  copyFile: (a: string, b: string) => Promise<void>;
  unlink: (p: string) => Promise<void>;
}): BackupFs {
  return {
    async exists(p) {
      try {
        await fsPromises.access(p);
        return true;
      } catch {
        return false;
      }
    },
    copy: (from, to) => fsPromises.copyFile(from, to),
    remove: p => fsPromises.unlink(p),
  };
}
