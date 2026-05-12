import { useState, useEffect, useCallback } from "react";
import {
  useSessionStore,
  setMyUserName,
  setParticipantRole,
  type SessionParticipant,
  type SessionRole,
} from "../../store/useSessionStore";
import { useCollabSession } from "../../hooks/useCollabSession";

// ─── Typen ────────────────────────────────────────────────────────────────────

interface DiscoveredSession {
  roomCode: string;
  hostIp: string;
  hostName: string;
  port: number;
  lastSeen: number;
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputSt: React.CSSProperties = {
  background: "var(--ss-bg-elevated)",
  border: "1px solid var(--ss-border)",
  borderRadius: 6,
  padding: "6px 10px",
  color: "var(--ss-text-primary)",
  fontSize: 13,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const primaryBtn = (disabled = false): React.CSSProperties => ({
  background: disabled ? "var(--ss-bg-elevated)" : "var(--ss-accent-primary)",
  border: "none",
  borderRadius: 6,
  padding: "9px 0",
  width: "100%",
  color: disabled ? "var(--ss-text-dim)" : "#fff",
  fontWeight: 700,
  cursor: disabled ? "not-allowed" : "pointer",
  fontSize: 13,
  opacity: disabled ? 0.55 : 1,
});

const monoTag: React.CSSProperties = {
  fontFamily: "monospace",
  background: "var(--ss-bg-elevated)",
  border: "1px solid var(--ss-border)",
  borderRadius: 4,
  padding: "2px 8px",
  fontSize: 12,
  color: "var(--ss-text-primary)",
};

// ─── Participant Item ─────────────────────────────────────────────────────────

function ParticipantItem({ p, isMe }: { p: SessionParticipant; isMe: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: p.color, flexShrink: 0 }} />
      <span style={{ color: "var(--ss-text-primary)", fontSize: 13 }}>
        {p.userName}{isMe ? " (Du)" : ""}
      </span>
    </div>
  );
}

// ─── Discovered Session Row ───────────────────────────────────────────────────

function DiscoveredRow({
  s,
  onJoin,
}: {
  s: DiscoveredSession;
  onJoin: (s: DiscoveredSession) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "7px 10px", borderRadius: 6, background: "var(--ss-bg-elevated)", border: "1px solid var(--ss-border)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "var(--ss-accent-success)", fontSize: 9 }}>&#9679;</span>
          <span style={{ ...monoTag }}>{s.roomCode}</span>
          <span style={{ fontSize: 11, color: "var(--ss-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.hostName}</span>
        </div>
        <span style={{ fontSize: 10, color: "var(--ss-text-dim)", fontFamily: "monospace" }}>{s.hostIp}:{s.port}</span>
      </div>
      <button onClick={() => onJoin(s)} style={{ background: "var(--ss-accent-primary)", border: "none", borderRadius: 5, padding: "5px 12px", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 11, flexShrink: 0 }}>
        Beitreten
      </button>
    </div>
  );
}

// ─── Session Panel ────────────────────────────────────────────────────────────

export function SessionPanel() {
  const session = useSessionStore();
  const collab = useCollabSession();

  const [tab, setTab] = useState<"create" | "join">("create");
  const [joinCode, setJoinCode] = useState("");
  const [joinIp, setJoinIp] = useState("");
  const [joinPort, setJoinPort] = useState("4242");
  const [hostAddress, setHostAddress] = useState<{ ip: string; port: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredSession[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [recentSessions, setRecentSessions] = useState<Array<{ code: string; ip: string; port: number; name: string; lastUsed: number }>>([]);

  // Zuletzt verwendete Sessions aus localStorage laden
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ss-collab-recent");
      if (saved) setRecentSessions(JSON.parse(saved).slice(0, 5));
    } catch { /* ignore */ }
  }, []);

  const saveRecentSession = useCallback((code: string, ip: string, port: number, name: string) => {
    const entry = { code, ip, port, name, lastUsed: Date.now() };
    setRecentSessions(prev => {
      const next = [entry, ...prev.filter(s => !(s.code === code && s.ip === ip))].slice(0, 5);
      localStorage.setItem("ss-collab-recent", JSON.stringify(next));
      return next;
    });
  }, []);

  const electron = (window as Window & { electronAPI?: Record<string, unknown> }).electronAPI as
    | {
        getCollabAddress: () => Promise<{ ip: string; port: number; running: boolean }>;
        startCollabAnnounce: (code: string) => Promise<{ success: boolean }>;
        stopCollabAnnounce: () => Promise<{ success: boolean }>;
        startCollabDiscovery: () => Promise<{ success: boolean }>;
        stopCollabDiscovery: () => Promise<{ success: boolean }>;
        getDiscoveredSessions: () => Promise<DiscoveredSession[]>;
      }
    | undefined;

  const isElectron = Boolean(electron);

  useEffect(() => {
    if (session.status !== "hosting" || !isElectron) return;
    electron!.getCollabAddress().then((addr) => setHostAddress({ ip: addr.ip, port: addr.port }));
  }, [session.status, isElectron]);

  useEffect(() => {
    if (session.status === "hosting" && session.sessionCode && isElectron) {
      void electron!.startCollabAnnounce(session.sessionCode);
    }
    return () => { if (isElectron) void electron!.stopCollabAnnounce(); };
  }, [session.status, session.sessionCode, isElectron]);

  const startDiscovery = useCallback(async () => {
    if (!isElectron) return;
    await electron!.startCollabDiscovery();
    setDiscovering(true);
    setDiscovered([]);
  }, [isElectron]);

  // Auto-Start Discovery wenn Join-Tab geöffnet wird (Electron only)
  useEffect(() => {
    if (tab === "join" && isElectron && !discovering) {
      void startDiscovery();
    }
    return () => {
      if (tab !== "join" && discovering && isElectron) {
        void electron!.stopCollabDiscovery();
        setDiscovering(false);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const stopDiscovery = useCallback(async () => {
    if (!isElectron) return;
    await electron!.stopCollabDiscovery();
    setDiscovering(false);
    setDiscovered([]);
  }, [isElectron]);

  useEffect(() => {
    if (!discovering || !isElectron) return;
    const poll = setInterval(async () => {
      const sessions = await electron!.getDiscoveredSessions();
      setDiscovered(sessions);
    }, 1500);
    return () => clearInterval(poll);
  }, [discovering, isElectron]);

  useEffect(() => {
    return () => {
      if (isElectron) {
        void electron!.stopCollabDiscovery();
        void electron!.stopCollabAnnounce();
      }
    };
  }, [isElectron]);

  const isConnecting = session.status === "connecting";

  const panelSt: React.CSSProperties = {
    background: "var(--ss-bg-panel)",
    border: "1px solid var(--ss-border)",
    borderRadius: 8,
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  };

  const handleCopyFull = () => {
    if (!hostAddress || !session.sessionCode) return;
    void navigator.clipboard.writeText(`${hostAddress.ip}:${hostAddress.port}:${session.sessionCode}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleJoinDiscovered = (s: DiscoveredSession) => {
    setTab("join");
    setJoinCode(s.roomCode);
    setJoinIp(s.hostIp);
    setJoinPort(String(s.port));
  };

  // ── Hosting / Joined ──────────────────────────────────────────────────────
  if (session.status === "hosting" || session.status === "joined") {
    const isHost = session.status === "hosting";
    return (
      <div style={panelSt}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ padding: "2px 9px", borderRadius: 12, background: "var(--ss-accent-success)", color: "#fff", fontSize: 11, fontWeight: 700 }}>
            {isHost ? "Session aktiv" : "Verbunden"}
          </span>
        </div>

        {session.sessionCode && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 11, color: "var(--ss-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Code</span>
            <span style={{ fontFamily: "monospace", fontSize: 24, fontWeight: 700, letterSpacing: "0.15em", color: "var(--ss-accent-primary)" }}>
              {session.sessionCode}
            </span>
          </div>
        )}

        {isHost && hostAddress && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, background: "var(--ss-bg-elevated)", border: "1px solid var(--ss-border)", borderRadius: 6, padding: "10px 12px" }}>
            <span style={{ fontSize: 11, color: "var(--ss-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Deine Netzwerk-Adresse</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 2 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 10, color: "var(--ss-text-dim)", width: 30 }}>IP</span>
                  <span style={{ ...monoTag, fontSize: 14 }}>{hostAddress.ip}</span>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 10, color: "var(--ss-text-dim)", width: 30 }}>Port</span>
                  <span style={{ ...monoTag, fontSize: 14 }}>{hostAddress.port}</span>
                </div>
              </div>
              <button onClick={handleCopyFull} style={{ background: copied ? "var(--ss-accent-success)" : "var(--ss-accent-primary)", border: "none", borderRadius: 5, padding: "6px 12px", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 11 }}>
                {copied ? "Kopiert!" : "Alles kopieren"}
              </button>
            </div>
            <span style={{ fontSize: 10, color: "var(--ss-text-dim)" }}>
              Mitteile: <strong style={{ fontFamily: "monospace" }}>{hostAddress.ip} Pkt {hostAddress.port} Pkt {session.sessionCode}</strong>
            </span>
          </div>
        )}

        <div style={{ borderTop: "1px solid var(--ss-border-subtle)", paddingTop: 8 }}>
          <span style={{ fontSize: 11, color: "var(--ss-text-muted)", display: "block", marginBottom: 6 }}>
            Teilnehmer ({session.participants.length})
          </span>
          {session.participants.length === 0 && (
            <span style={{ fontSize: 12, color: "var(--ss-text-dim)" }}>Wartet auf Beitreter&#8230;</span>
          )}
          {session.participants.map((p) => (
            <div key={p.userId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ParticipantItem p={p} isMe={p.userId === session.myUserId} />
              {isHost && p.userId !== session.myUserId && (
                <select
                  value={session.participantRoles[p.userId] ?? "editor"}
                  onChange={e => {
                    const role = e.target.value as SessionRole;
                    setParticipantRole(p.userId, role);
                    collab.broadcast({ type: "role:change" as const, targetUserId: p.userId, role } as Parameters<typeof collab.broadcast>[0]);
                  }}
                  style={{ fontSize: 10, background: "var(--ss-bg-elevated)", border: "1px solid var(--ss-border)", borderRadius: 4, padding: "2px 4px", color: "var(--ss-text-muted)", cursor: "pointer" }}
                  title="Berechtigung des Partners"
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer (nur lesen)</option>
                </select>
              )}
            </div>
          ))}
        </div>

        <button onClick={() => collab.leaveSession()} style={{ background: "var(--ss-accent-danger)", border: "none", borderRadius: 6, padding: "8px 0", width: "100%", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
          {isHost ? "Session beenden" : "Verlassen"}
        </button>
      </div>
    );
  }

  // ── Idle / Error ──────────────────────────────────────────────────────────
  return (
    <div style={panelSt}>
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--ss-border-subtle)", paddingBottom: 8 }}>
        {(["create", "join"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ background: tab === t ? "var(--ss-accent-primary)" : "var(--ss-bg-elevated)", border: "1px solid " + (tab === t ? "var(--ss-accent-primary)" : "var(--ss-border)"), borderRadius: 6, padding: "5px 14px", color: tab === t ? "#fff" : "var(--ss-text-muted)", fontWeight: 600, cursor: "pointer", fontSize: 12 }}>
            {t === "create" ? "Session erstellen" : "Session beitreten"}
          </button>
        ))}
      </div>

      {tab === "create" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, color: "var(--ss-text-muted)" }}>Dein Name</span>
            <input value={session.myUserName} onChange={(e) => setMyUserName((e.target as HTMLInputElement).value)} maxLength={32} style={inputSt} />
          </label>
          <button onClick={() => void collab.createSession(session.myUserName)} disabled={isConnecting} style={primaryBtn(isConnecting)}>
            {isConnecting ? "Verbinde&#8230;" : "Session starten"}
          </button>
        </div>
      )}

      {tab === "join" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* ── Netzwerk-Scan (Electron) / Zuletzt verwendet (Browser) ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "var(--ss-bg-elevated)", border: "1px solid var(--ss-border)", borderRadius: 8, padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ss-text-primary)" }}>
                {isElectron ? "🔍 Netzwerk-Scan" : "🕐 Zuletzt benutzt"}
              </span>
              {isElectron && (
                <button onClick={discovering ? stopDiscovery : startDiscovery}
                  style={{ background: discovering ? "var(--ss-accent-secondary)" : "var(--ss-bg-panel)", border: "1px solid var(--ss-border)", borderRadius: 5, padding: "3px 10px", color: discovering ? "#fff" : "var(--ss-text-muted)", fontWeight: 600, cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                  {discovering ? (
                    <><span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>↻</span> Sucht…</>
                  ) : "Neu scannen"}
                </button>
              )}
            </div>

            {/* Electron: Discovered Sessions */}
            {isElectron && discovering && discovered.length === 0 && (
              <div style={{ textAlign: "center", padding: "12px 0", fontSize: 12, color: "var(--ss-text-dim)" }}>
                Scanne lokales Netzwerk nach Synthstudio-Sessions…
              </div>
            )}
            {isElectron && discovered.map((s) => (
              <button key={s.hostIp + s.roomCode} onClick={() => handleJoinDiscovered(s)}
                style={{ background: "var(--ss-bg-panel)", border: "1px solid var(--ss-accent-secondary)", borderRadius: 6, padding: "8px 12px", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ss-accent-primary)", fontFamily: "monospace", letterSpacing: "0.1em" }}>{s.roomCode}</div>
                  <div style={{ fontSize: 10, color: "var(--ss-text-dim)", marginTop: 2 }}>{s.hostIp}:{s.port} · {s.hostName || "Unbekannter Host"}</div>
                </div>
                <span style={{ fontSize: 11, color: "var(--ss-accent-secondary)", fontWeight: 600 }}>Beitreten →</span>
              </button>
            ))}
            {isElectron && !discovering && discovered.length === 0 && (
              <div style={{ fontSize: 11, color: "var(--ss-text-dim)", textAlign: "center", padding: "4px 0" }}>
                Keine aktiven Sessions gefunden. Session starten oder Code manuell eingeben.
              </div>
            )}

            {/* Browser: Zuletzt verwendete Sessions */}
            {!isElectron && recentSessions.length === 0 && (
              <div style={{ fontSize: 11, color: "var(--ss-text-dim)" }}>Noch keine gespeicherten Sessions. Code manuell eingeben.</div>
            )}
            {!isElectron && recentSessions.map(s => (
              <button key={s.code + s.ip} onClick={() => { setJoinCode(s.code); setJoinIp(s.ip); setJoinPort(String(s.port)); }}
                style={{ background: "var(--ss-bg-panel)", border: "1px solid var(--ss-border)", borderRadius: 6, padding: "7px 10px", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ss-accent-primary)", fontFamily: "monospace" }}>{s.code}</div>
                  <div style={{ fontSize: 10, color: "var(--ss-text-dim)" }}>{s.ip}:{s.port}</div>
                </div>
                <span style={{ fontSize: 10, color: "var(--ss-text-dim)" }}>{new Date(s.lastUsed).toLocaleDateString()}</span>
              </button>
            ))}
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, color: "var(--ss-text-muted)" }}>Dein Name</span>
            <input value={session.myUserName} onChange={(e) => setMyUserName((e.target as HTMLInputElement).value)} maxLength={32} style={inputSt} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, color: "var(--ss-text-muted)" }}>Session-Code</span>
            <input value={joinCode} onChange={(e) => setJoinCode((e.target as HTMLInputElement).value.toUpperCase().slice(0, 6))} placeholder="A3F7KL" style={{ ...inputSt, fontFamily: "monospace", letterSpacing: "0.1em" }} />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 2 }}>
              <span style={{ fontSize: 11, color: "var(--ss-text-muted)" }}>Host-IP</span>
              <input value={joinIp} onChange={(e) => setJoinIp((e.target as HTMLInputElement).value)} placeholder="192.168.1.x" style={inputSt} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
              <span style={{ fontSize: 11, color: "var(--ss-text-muted)" }}>Port</span>
              <input value={joinPort} onChange={(e) => setJoinPort((e.target as HTMLInputElement).value)} placeholder="4242" style={inputSt} />
            </label>
          </div>
          <button onClick={() => {
            const port = parseInt(joinPort, 10) || 4242;
            collab.joinSession(joinCode, joinIp, port, session.myUserName);
            saveRecentSession(joinCode, joinIp, port, session.myUserName);
          }} disabled={isConnecting || !joinCode || !joinIp} style={primaryBtn(isConnecting || !joinCode || !joinIp)}>
            {isConnecting ? "Verbinde&#8230;" : "Beitreten"}
          </button>
        </div>
      )}

      {session.errorMessage && (
        <div style={{ color: "var(--ss-accent-danger)", fontSize: 12, marginTop: 4 }}>{session.errorMessage}</div>
      )}
    </div>
  );
}
