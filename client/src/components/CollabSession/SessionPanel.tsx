import { useState, useEffect, useCallback } from "react";
import {
  useSessionStore,
  setMyUserName,
  type SessionParticipant,
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
  }, [isElectron]);

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
            <ParticipantItem key={p.userId} p={p} isMe={p.userId === session.myUserId} />
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
          {isElectron && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: "var(--ss-text-muted)" }}>Sessions im Netzwerk</span>
                <button onClick={discovering ? stopDiscovery : startDiscovery} style={{ background: discovering ? "#e67e22" : "var(--ss-bg-elevated)", border: "1px solid var(--ss-border)", borderRadius: 5, padding: "3px 10px", color: discovering ? "#fff" : "var(--ss-text-muted)", fontWeight: 600, cursor: "pointer", fontSize: 11 }}>
                  {discovering ? "Suche laueft..." : "Suchen"}
                </button>
              </div>
              {discovering && discovered.length === 0 && (
                <div style={{ padding: "10px 0", textAlign: "center", fontSize: 12, color: "var(--ss-text-dim)" }}>Suche nach Sessions&#8230;</div>
              )}
              {discovered.map((s) => (
                <DiscoveredRow key={s.hostIp + s.roomCode} s={s} onJoin={handleJoinDiscovered} />
              ))}
              {discovered.length > 0 && <div style={{ height: 1, background: "var(--ss-border-subtle)" }} />}
            </div>
          )}
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
          <button onClick={() => collab.joinSession(joinCode, joinIp, parseInt(joinPort, 10) || 4242, session.myUserName)} disabled={isConnecting || !joinCode || !joinIp} style={primaryBtn(isConnecting || !joinCode || !joinIp)}>
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
