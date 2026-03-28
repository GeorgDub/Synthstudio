/**
 * Tests – useSessionStore.ts (v1.10)
 *
 * Testet den kollaborativen Session-Store:
 * Initialzustand, alle Setter, Teilnehmer-Verwaltung, resetSession,
 * getSessionState, setSessionError.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// localStorage existiert nicht im Node-Test-Environment – minimaler Stub
const _localStorageStore: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: (k: string) => _localStorageStore[k] ?? null,
  setItem: (k: string, v: string) => { _localStorageStore[k] = v; },
  removeItem: (k: string) => { delete _localStorageStore[k]; },
  clear: () => { Object.keys(_localStorageStore).forEach((k) => delete _localStorageStore[k]); },
});
import {
  getSessionState,
  setSessionStatus,
  setSessionCode,
  setWsUrl,
  setParticipants,
  addParticipant,
  removeParticipant,
  setSessionError,
  setRemoteBpm,
  setMyUserName,
  resetSession,
  __resetSessionForTests,
  type SessionParticipant,
} from "../client/src/store/useSessionStore";

const PARTICIPANT_A: SessionParticipant = {
  userId: "u-001",
  userName: "Alice",
  color: "#e74c3c",
  joinedAt: 1_000_000,
};

const PARTICIPANT_B: SessionParticipant = {
  userId: "u-002",
  userName: "Bob",
  color: "#3498db",
  joinedAt: 1_000_100,
};

beforeEach(() => {
  __resetSessionForTests();
});

describe("useSessionStore – Initialzustand", () => {
  it("status ist 'idle'", () => {
    expect(getSessionState().status).toBe("idle");
  });

  it("sessionCode ist null", () => {
    expect(getSessionState().sessionCode).toBeNull();
  });

  it("participants ist ein leeres Array", () => {
    expect(getSessionState().participants).toHaveLength(0);
  });

  it("myUserId ist 'test-user' (Test-Reset-Wert)", () => {
    expect(getSessionState().myUserId).toBe("test-user");
  });

  it("myUserName ist 'TestUser' (Test-Reset-Wert)", () => {
    expect(getSessionState().myUserName).toBe("TestUser");
  });

  it("remoteBpm ist null", () => {
    expect(getSessionState().remoteBpm).toBeNull();
  });
});

describe("useSessionStore – Setter", () => {
  it("setSessionStatus() ändert den Status", () => {
    setSessionStatus("hosting");
    expect(getSessionState().status).toBe("hosting");
  });

  it("setSessionCode() setzt den Raum-Code", () => {
    setSessionCode("ABCD12");
    expect(getSessionState().sessionCode).toBe("ABCD12");
  });

  it("setWsUrl() setzt die WebSocket-URL", () => {
    setWsUrl("ws://192.168.1.42:41234");
    expect(getSessionState().wsUrl).toBe("ws://192.168.1.42:41234");
  });

  it("setRemoteBpm() speichert den BPM-Wert", () => {
    setRemoteBpm(135);
    expect(getSessionState().remoteBpm).toBe(135);
  });

  it("setMyUserName() kürzt auf max. 32 Zeichen", () => {
    setMyUserName("A".repeat(50));
    expect(getSessionState().myUserName).toHaveLength(32);
  });

  it("setMyUserName() mit leerem String → 'Beatmaker'", () => {
    setMyUserName("   ");
    expect(getSessionState().myUserName).toBe("Beatmaker");
  });
});

describe("useSessionStore – Teilnehmer-Verwaltung", () => {
  it("setParticipants() ersetzt die Liste vollständig", () => {
    setParticipants([PARTICIPANT_A, PARTICIPANT_B]);
    expect(getSessionState().participants).toHaveLength(2);
  });

  it("addParticipant() fügt einen neuen Teilnehmer hinzu", () => {
    addParticipant(PARTICIPANT_A);
    expect(getSessionState().participants[0].userId).toBe("u-001");
  });

  it("addParticipant() ignoriert Duplikate (gleiche userId)", () => {
    addParticipant(PARTICIPANT_A);
    addParticipant(PARTICIPANT_A);
    expect(getSessionState().participants).toHaveLength(1);
  });

  it("removeParticipant() entfernt den Teilnehmer per userId", () => {
    setParticipants([PARTICIPANT_A, PARTICIPANT_B]);
    removeParticipant("u-001");
    const participants = getSessionState().participants;
    expect(participants).toHaveLength(1);
    expect(participants[0].userId).toBe("u-002");
  });

  it("removeParticipant() mit unbekannter userId → keine Änderung", () => {
    setParticipants([PARTICIPANT_A]);
    removeParticipant("u-999");
    expect(getSessionState().participants).toHaveLength(1);
  });
});

describe("useSessionStore – Fehlerbehandlung", () => {
  it("setSessionError() setzt Fehlermeldung und Status 'error'", () => {
    setSessionError("Verbindung fehlgeschlagen");
    const s = getSessionState();
    expect(s.errorMessage).toBe("Verbindung fehlgeschlagen");
    expect(s.status).toBe("error");
  });

  it("setSessionError(null) löscht die Fehlermeldung", () => {
    setSessionError("Fehler");
    setSessionStatus("idle"); // Status manuell rücksetzen
    setSessionError(null);
    expect(getSessionState().errorMessage).toBeNull();
  });
});

describe("useSessionStore – resetSession()", () => {
  it("setzt sessionCode, wsUrl und participants zurück", () => {
    setSessionCode("XYZABC");
    setWsUrl("ws://127.0.0.1:9999");
    addParticipant(PARTICIPANT_A);
    resetSession();
    const s = getSessionState();
    expect(s.sessionCode).toBeNull();
    expect(s.wsUrl).toBeNull();
    expect(s.participants).toHaveLength(0);
  });

  it("behält myUserId und myUserName bei", () => {
    const before = getSessionState().myUserId;
    setSessionCode("ABC");
    resetSession();
    expect(getSessionState().myUserId).toBe(before);
  });

  it("setzt status zurück auf 'idle'", () => {
    setSessionStatus("joined");
    resetSession();
    expect(getSessionState().status).toBe("idle");
  });
});
