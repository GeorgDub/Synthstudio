/**
 * tests/features/user-midi-templates.test.ts
 *
 * v1.96: User-defined MIDI-Template Store. Persistiert per localStorage,
 * Singleton-Pattern + React-Hook.
 */
import { describe, it, expect, beforeEach } from "vitest";

// localStorage Mock (vor Module-Load setzen)
function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem:    (key: string): string | null => store[key] ?? null,
    setItem:    (key: string, value: string): void => { store[key] = value; },
    removeItem: (key: string): void => { delete store[key]; },
    clear:      (): void => { store = {}; },
  };
}
const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true, configurable: true });

import {
  getUserMidiTemplates,
  getUserMidiTemplate,
  saveUserMidiTemplate,
  deleteUserMidiTemplate,
  renameUserMidiTemplate,
  __resetUserMidiTemplatesForTests,
} from "../../client/src/store/useUserMidiTemplatesStore";

beforeEach(() => {
  localStorageMock.clear();
  __resetUserMidiTemplatesForTests();
});

describe("useUserMidiTemplatesStore (v1.96)", () => {
  it("getUserMidiTemplates ist initial leer", () => {
    expect(getUserMidiTemplates()).toEqual([]);
  });

  it("saveUserMidiTemplate persistiert ein neues Template", () => {
    const t = saveUserMidiTemplate({
      name: "Mein Setup",
      ccMappings: [{ cc: 7, channel: 1, target: { type: "masterVolume" }, label: "Master" }],
      noteMappings: [],
    });
    expect(t.id).toBeTruthy();
    expect(t.name).toBe("Mein Setup");
    expect(getUserMidiTemplates()).toHaveLength(1);
    expect(getUserMidiTemplates()[0].id).toBe(t.id);
  });

  it("speichert Device-Name wenn übergeben", () => {
    const t = saveUserMidiTemplate({
      name: "Electribe-Setup",
      deviceName: "Korg Electribe 2",
      ccMappings: [],
      noteMappings: [{ note: 36, channel: 10, partId: "p1", label: "Kick" }],
    });
    expect(t.deviceName).toBe("Korg Electribe 2");
  });

  it("getUserMidiTemplate findet per ID", () => {
    const t = saveUserMidiTemplate({ name: "Test", ccMappings: [], noteMappings: [{ note: 36, channel: 1, partId: "p1", label: "k" }] });
    expect(getUserMidiTemplate(t.id)?.name).toBe("Test");
  });

  it("getUserMidiTemplate liefert undefined bei unbekannter ID", () => {
    expect(getUserMidiTemplate("nicht-existent")).toBeUndefined();
  });

  it("renameUserMidiTemplate ändert Name + updatedAt", async () => {
    const t = saveUserMidiTemplate({ name: "Alt", ccMappings: [], noteMappings: [{ note: 1, channel: 1, partId: "p", label: "x" }] });
    const oldUpdate = t.updatedAt;
    await new Promise(r => setTimeout(r, 5)); // damit updatedAt sicher anders ist
    renameUserMidiTemplate(t.id, "Neu");
    const after = getUserMidiTemplate(t.id);
    expect(after?.name).toBe("Neu");
    expect(after!.updatedAt).toBeGreaterThanOrEqual(oldUpdate);
  });

  it("renameUserMidiTemplate ignoriert leeren Namen", () => {
    const t = saveUserMidiTemplate({ name: "Original", ccMappings: [], noteMappings: [{ note: 1, channel: 1, partId: "p", label: "x" }] });
    renameUserMidiTemplate(t.id, "   ");
    expect(getUserMidiTemplate(t.id)?.name).toBe("Original");
  });

  it("deleteUserMidiTemplate entfernt das Template", () => {
    const t = saveUserMidiTemplate({ name: "Zu löschen", ccMappings: [], noteMappings: [{ note: 1, channel: 1, partId: "p", label: "x" }] });
    expect(getUserMidiTemplates()).toHaveLength(1);
    deleteUserMidiTemplate(t.id);
    expect(getUserMidiTemplates()).toHaveLength(0);
  });

  it("deleteUserMidiTemplate ist No-Op bei unbekannter ID", () => {
    saveUserMidiTemplate({ name: "A", ccMappings: [], noteMappings: [{ note: 1, channel: 1, partId: "p", label: "x" }] });
    deleteUserMidiTemplate("nicht-existent");
    expect(getUserMidiTemplates()).toHaveLength(1);
  });

  it("Liste ist nach updatedAt absteigend sortiert (neueste zuerst)", async () => {
    const t1 = saveUserMidiTemplate({ name: "A", ccMappings: [], noteMappings: [{ note: 1, channel: 1, partId: "p", label: "x" }] });
    await new Promise(r => setTimeout(r, 5));
    const t2 = saveUserMidiTemplate({ name: "B", ccMappings: [], noteMappings: [{ note: 2, channel: 1, partId: "p", label: "y" }] });
    const list = getUserMidiTemplates();
    expect(list[0].id).toBe(t2.id);
    expect(list[1].id).toBe(t1.id);
  });

  it("saveUserMidiTemplate updated bestehendes Template wenn id übergeben", async () => {
    const t1 = saveUserMidiTemplate({ name: "Original", ccMappings: [{ cc: 1, channel: 1, target: { type: "bpm" }, label: "BPM" }], noteMappings: [] });
    await new Promise(r => setTimeout(r, 5));
    saveUserMidiTemplate({
      id: t1.id,
      name: "Updated",
      ccMappings: [{ cc: 7, channel: 1, target: { type: "masterVolume" }, label: "Master" }],
      noteMappings: [],
    });
    expect(getUserMidiTemplates()).toHaveLength(1); // nicht dupliziert
    expect(getUserMidiTemplate(t1.id)?.name).toBe("Updated");
    expect(getUserMidiTemplate(t1.id)?.ccMappings[0].cc).toBe(7);
  });

  it("Leerer Name beim Save fällt auf 'Unbenannt' zurück", () => {
    const t = saveUserMidiTemplate({ name: "   ", ccMappings: [], noteMappings: [{ note: 1, channel: 1, partId: "p", label: "x" }] });
    expect(t.name).toBe("Unbenannt");
  });
});
