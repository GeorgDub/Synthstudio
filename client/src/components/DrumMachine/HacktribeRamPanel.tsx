/**
 * Synthstudio — HacktribeRamPanel (v3.285.0)
 *
 * Werkzeug für Hacktribes RAM-Peek/Poke. Bewusst getrennt vom Live-Regelwerk
 * (Korg-Remote) und bewusst unbequem: Lesen ist frei, Schreiben verlangt zwei
 * ausdrückliche Bestätigungen und wird immer zurückgelesen.
 *
 * ⚠️ Warum die Umständlichkeit: hier landen Bytes im Adressraum eines laufenden
 * Geräts. Es gibt kein Kommando, das den Transportzustand abfragt — ob die Korg
 * gerade spielt, kann nur der Mensch davor beantworten. Deshalb die Checkbox,
 * und deshalb keine Automatik, die etwas anderes vortäuscht.
 *
 * Nicht enthalten: Flash (`0x55`/`0x56`) und Execute (`0x57`). Flash überlebt
 * den Power-Cycle, ein Fehler ist dann nicht mehr durch Aus- und Einschalten zu
 * beheben. Bei RAM hilft ein Power-Cycle — das ist die Grenze dieses Werkzeugs.
 */
import { useState } from "react";
import { useKorgRemoteStore } from "@/store/useKorgRemoteStore";
import { toast } from "@/store/useToastStore";
import { readRam, writeRam } from "@/audio/HacktribeRamTransfer";
import {
  DDR2_BASE,
  E2_RAM_MAP,
  RAM_WRITE_CHUNK,
  addressForSlot,
  findRamMapEntry,
  formatHexDump,
  parseAddress,
  parseHexBytes,
  validateRamRange,
} from "@/utils/korg/hacktribeRam";

const SELECT_CLASS =
  "bg-bg-base border border-border-color rounded px-1 py-0.5 text-[10px] text-text-primary";

function hex(n: number): string {
  return `0x${n.toString(16).toUpperCase().padStart(8, "0")}`;
}

export function HacktribeRamPanel({ onClose }: { onClose?: () => void }) {
  const remote = useKorgRemoteStore();

  const [mapKey, setMapKey] = useState<string>(E2_RAM_MAP[0].key);
  const [slot, setSlot] = useState(0);
  const [addrText, setAddrText] = useState(hex(E2_RAM_MAP[0].base));
  const [lenText, setLenText] = useState(String(E2_RAM_MAP[0].size));
  const [dump, setDump] = useState<string>("");
  const [writeHex, setWriteHex] = useState("");
  const [stoppedOk, setStoppedOk] = useState(false);
  const [understoodOk, setUnderstoodOk] = useState(false);
  const [busy, setBusy] = useState<"read" | "write" | null>(null);

  const entry = findRamMapEntry(mapKey);
  const parsedAddr = parseAddress(addrText);
  const parsedLen = Number.parseInt(lenText, 10);
  const rangeCheck =
    parsedAddr.ok && Number.isFinite(parsedLen)
      ? validateRamRange(parsedAddr.addr, parsedLen)
      : { ok: false as const, reason: "Adresse oder Länge unvollständig" };

  /** Übernimmt Adresse + Länge aus der Karte in die Felder. */
  function applyMapSelection(key: string, slotIndex: number) {
    const e = findRamMapEntry(key);
    if (!e) return;
    const clampedSlot = Math.max(0, Math.min(e.count - 1, slotIndex));
    setSlot(clampedSlot);
    setAddrText(hex(addressForSlot(e, clampedSlot)));
    setLenText(String(e.size));
  }

  async function doRead() {
    if (!parsedAddr.ok) { toast(parsedAddr.reason, { kind: "error" }); return; }
    if (!rangeCheck.ok) { toast(rangeCheck.reason, { kind: "error" }); return; }
    setBusy("read");
    try {
      const res = await readRam(parsedAddr.addr, parsedLen, remote.globalChannel);
      if (!res.ok) { toast(res.error, { kind: "error" }); setDump(""); return; }
      setDump(formatHexDump(res.value, parsedAddr.addr));
      // Gelesenes direkt als Schreibvorlage anbieten — der übliche Arbeitsweg
      // ist lesen, ein Byte ändern, zurückschreiben.
      setWriteHex(
        Array.from(res.value, (b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" "),
      );
      toast(`${res.value.length} Bytes gelesen ab ${hex(parsedAddr.addr)}`, { kind: "success" });
    } finally {
      setBusy(null);
    }
  }

  async function doWrite() {
    if (!parsedAddr.ok) { toast(parsedAddr.reason, { kind: "error" }); return; }
    const parsed = parseHexBytes(writeHex);
    if (!parsed.ok) { toast(`Hex-Eingabe: ${parsed.reason}`, { kind: "error" }); return; }
    const check = validateRamRange(parsedAddr.addr, parsed.bytes.length);
    if (!check.ok) { toast(check.reason, { kind: "error" }); return; }

    setBusy("write");
    try {
      const res = await writeRam(
        parsedAddr.addr,
        parsed.bytes,
        { deviceStopped: true, understood: true },
        remote.globalChannel,
      );
      if (!res.ok) { toast(res.error, { kind: "error" }); return; }
      toast(
        `${res.value.bytesWritten} Bytes in ${res.value.chunks} Häppchen geschrieben und zurückgelesen — identisch`,
        { kind: "success" },
      );
    } finally {
      setBusy(null);
    }
  }

  const canWrite =
    stoppedOk && understoodOk && busy === null && writeHex.trim().length > 0 && parsedAddr.ok;

  return (
    <div className="p-2 space-y-2 text-text-primary" data-testid="hacktribe-ram-panel">
      {/* ── Warnung ─────────────────────────────────────────────────────── */}
      <div
        data-testid="ram-panel-warning"
        className="text-[10px] leading-snug border border-accent-danger/50 rounded px-2 py-1 text-accent-danger"
      >
        <strong>RAM-Zugriff auf das laufende Gerät.</strong> Nur mit
        Hacktribe-Firmware. Schreiben trifft den Adressraum der laufenden App —
        an der falschen Stelle hängt das Gerät. Erlaubt ist ausschließlich das
        DDR2-Fenster ab {hex(DDR2_BASE)}; der Boot-Loader-Bereich ab 0x80000000
        ist gesperrt. Flash und Execute sind in diesem Werkzeug nicht enthalten —
        ein RAM-Fehler ist mit einem Power-Cycle behoben, ein Flash-Fehler nicht.
      </div>

      {/* ── Bekannte Strukturen ─────────────────────────────────────────── */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] text-text-dim">Struktur:</span>
        <select
          data-testid="ram-map-select"
          value={mapKey}
          onChange={(e) => { setMapKey(e.target.value); applyMapSelection(e.target.value, 0); }}
          className={SELECT_CLASS}
        >
          {E2_RAM_MAP.map((e) => (
            <option key={e.key} value={e.key}>{e.label}</option>
          ))}
        </select>
        {entry && entry.count > 1 && (
          <label className="text-[10px] text-text-dim flex items-center gap-1">
            Slot
            <input
              data-testid="ram-slot-input"
              type="number"
              min={0}
              max={entry.count - 1}
              value={slot}
              onChange={(e) => applyMapSelection(mapKey, Number(e.target.value))}
              className={`${SELECT_CLASS} w-16`}
            />
            <span className="text-text-dim">/ {entry.count - 1}</span>
          </label>
        )}
        {entry?.note && <span className="text-[10px] text-text-muted">{entry.note}</span>}
        {onClose && (
          <button
            onClick={onClose}
            className="ml-auto px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:text-text-primary"
          >
            Schließen
          </button>
        )}
      </div>

      {/* ── Adresse / Länge / Lesen ─────────────────────────────────────── */}
      <div className="flex items-center gap-1 flex-wrap">
        <label className="text-[10px] text-text-dim flex items-center gap-1">
          Adresse
          <input
            data-testid="ram-addr-input"
            value={addrText}
            onChange={(e) => setAddrText(e.target.value)}
            className={`${SELECT_CLASS} w-28 font-mono`}
            spellCheck={false}
          />
        </label>
        <label className="text-[10px] text-text-dim flex items-center gap-1">
          Länge
          <input
            data-testid="ram-len-input"
            type="number"
            min={1}
            value={lenText}
            onChange={(e) => setLenText(e.target.value)}
            className={`${SELECT_CLASS} w-20`}
          />
        </label>
        <button
          data-testid="ram-read"
          onClick={() => void doRead()}
          disabled={busy !== null || !rangeCheck.ok}
          title="Bereich aus dem CPU-RAM lesen (gefahrlos)"
          className="px-2 py-1 rounded text-[10px] font-bold bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30 transition-colors disabled:opacity-50"
        >
          {busy === "read" ? "Lese…" : "⬇ Lesen"}
        </button>
        {!rangeCheck.ok && (
          <span data-testid="ram-range-error" className="text-[10px] text-accent-danger">
            {rangeCheck.reason}
          </span>
        )}
      </div>

      {/* ── Hex-Dump ────────────────────────────────────────────────────── */}
      {dump && (
        <pre
          data-testid="ram-dump"
          className="text-[10px] font-mono bg-bg-base border border-border-color rounded p-2 max-h-40 overflow-auto whitespace-pre"
        >
          {dump}
        </pre>
      )}

      {/* ── Schreiben ───────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <label className="text-[10px] text-text-dim block">
          Bytes zum Schreiben (Hex, Leerzeichen erlaubt) — landen ab {hex(parsedAddr.ok ? parsedAddr.addr : 0)}
          <textarea
            data-testid="ram-write-input"
            value={writeHex}
            onChange={(e) => setWriteHex(e.target.value)}
            rows={3}
            spellCheck={false}
            className="mt-1 w-full bg-bg-base border border-border-color rounded px-1 py-0.5 text-[10px] font-mono text-text-primary"
            placeholder="00 01 02 …"
          />
        </label>

        <label className="text-[10px] text-text-muted flex items-start gap-1">
          <input
            data-testid="ram-confirm-stopped"
            type="checkbox"
            checked={stoppedOk}
            onChange={(e) => setStoppedOk(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Das Gerät ist <strong>gestoppt</strong>. (Wir schicken ein MIDI-Stop mit, aber das
            wirkt nur, wenn die Korg auf externe Clock hört — prüfen kann das nur du.)
          </span>
        </label>
        <label className="text-[10px] text-text-muted flex items-start gap-1">
          <input
            data-testid="ram-confirm-understood"
            type="checkbox"
            checked={understoodOk}
            onChange={(e) => setUnderstoodOk(e.target.checked)}
            className="mt-0.5"
          />
          <span>Ich weiß, welche Struktur an dieser Adresse liegt.</span>
        </label>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            data-testid="ram-write"
            onClick={() => void doWrite()}
            disabled={!canWrite}
            title="Schreibt in Häppchen, wartet auf jedes ACK und liest anschließend alles zurück"
            className="px-2 py-1 rounded text-[10px] font-bold bg-accent-danger/25 text-accent-danger border border-accent-danger/50 hover:bg-accent-danger/35 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy === "write" ? "Schreibe…" : "⬆ Schreiben"}
          </button>
          <span className="text-[10px] text-text-dim">
            Häppchen à {RAM_WRITE_CHUNK} B, jedes mit eigener Adress-Setzung und ACK; danach
            wird der ganze Bereich zurückgelesen und verglichen.
          </span>
        </div>
      </div>
    </div>
  );
}

export default HacktribeRamPanel;
