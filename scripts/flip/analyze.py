#!/usr/bin/env python3
"""Analysiert das 38er-ShizoStyle-Projekt: WAV-Specs + FLP-Tempo/Struktur.
Nur Lese-Operationen. Robust gegen Nicht-PCM-WAVs (fmt=85 MP3-in-WAV)."""
import os, struct, sys

SRC = r"E:\KOPFCHAOT SCHÄTZE\38er ShizoStyle"

def read_wav_header(path):
    """Liest RIFF/fmt/data ohne Dekodieren. Gibt dict oder Fehler."""
    with open(path, "rb") as f:
        riff = f.read(12)
        if riff[:4] != b"RIFF" or riff[8:12] != b"WAVE":
            return {"error": "not-RIFF-WAVE"}
        fmt = None
        data_size = None
        while True:
            hdr = f.read(8)
            if len(hdr) < 8:
                break
            cid, csz = struct.unpack("<4sI", hdr)
            if cid == b"fmt ":
                raw = f.read(csz)
                (audio_fmt, ch, sr, _byte_rate, _blk, bits) = struct.unpack("<HHIIHH", raw[:16])
                fmt = {"fmt": audio_fmt, "ch": ch, "sr": sr, "bits": bits}
            elif cid == b"data":
                data_size = csz
                f.seek(csz, 1)
            else:
                f.seek(csz, 1)
            if csz % 2 == 1:
                f.seek(1, 1)
        if not fmt:
            return {"error": "no-fmt"}
        dur = None
        if data_size and fmt["ch"] and fmt["sr"] and fmt["bits"]:
            dur = data_size / (fmt["ch"] * fmt["sr"] * (fmt["bits"] // 8 or 1))
        fmt["dur"] = dur
        fmt["data_bytes"] = data_size
        return fmt

FMT_NAMES = {1: "PCM", 3: "float", 85: "MP3", 0xFFFE: "ext"}

def main():
    files = sorted(os.listdir(SRC))
    wavs = [f for f in files if f.lower().endswith(".wav")]
    print(f"=== {len(wavs)} WAV-Dateien ===")
    decodable = []
    undecodable = []
    for w in wavs:
        p = os.path.join(SRC, w)
        h = read_wav_header(p)
        if "error" in h:
            undecodable.append((w, h["error"]))
            print(f"  [SKIP] {w:50.50s} {h['error']}")
            continue
        fmt_name = FMT_NAMES.get(h["fmt"], f"fmt{h['fmt']}")
        dur = h.get("dur") or 0
        flag = "" if h["fmt"] in (1, 3) else "  <-- nicht-PCM"
        line = f"  {w:50.50s} {fmt_name:6s} {h['ch']}ch {h['sr']}Hz {h['bits']}b  {dur:7.2f}s{flag}"
        print(line)
        if h["fmt"] in (1, 3):
            decodable.append((w, h, dur))
        else:
            undecodable.append((w, fmt_name))
    print(f"\n=== Zusammenfassung: {len(decodable)} dekodierbar, {len(undecodable)} nicht ===")
    # Kategorisierung nach Länge (heuristisch)
    oneshots = [(w, d) for (w, h, d) in decodable if d < 2.0]
    loops = [(w, d) for (w, h, d) in decodable if 2.0 <= d < 30.0]
    longs = [(w, d) for (w, h, d) in decodable if d >= 30.0]
    print(f"  One-Shots (<2s):  {len(oneshots)}")
    print(f"  Loops (2-30s):    {len(loops)}")
    print(f"  Lang (>30s):      {len(longs)}  {[w for w,_ in longs]}")

    # FLP-Tempo + grobe Struktur
    flp = os.path.join(SRC, "38er Shizo Style.flp")
    if os.path.exists(flp):
        with open(flp, "rb") as f:
            data = f.read()
        print(f"\n=== FLP: {os.path.basename(flp)} ({len(data)} bytes) ===")
        # Tempo: Event 0x9C (DWORD) = bpm*1000. Suche im FLdt-Stream.
        # Grobe Heuristik: scanne nach 0x9C gefolgt von plausiblem DWORD.
        tempos = []
        i = data.find(b"FLdt")
        i = i + 8 if i >= 0 else 0
        pat_count = 0
        note_events = 0
        while i < len(data) - 1:
            ev = data[i]; i += 1
            if ev < 64:
                i += 1
            elif ev < 128:
                i += 2
                if ev == 0x41:
                    pat_count += 1
            elif ev < 192:
                val = struct.unpack("<I", data[i:i+4])[0] if i+4 <= len(data) else 0
                i += 4
                if ev == 0x9C and 10000 < val < 1000000:
                    tempos.append(val/1000.0)
            else:
                # varlen length
                length = 0; shift = 0
                while i < len(data):
                    b = data[i]; i += 1
                    length |= (b & 0x7F) << shift
                    if not (b & 0x80):
                        break
                    shift += 7
                if ev == 0xE0:
                    note_events += length // 24
                i += length
        print(f"  Tempo-Events (0x9C): {tempos[:5]}{'...' if len(tempos)>5 else ''}")
        print(f"  NewPattern-Events (0x41): {pat_count}")
        print(f"  Note-Events (0xE0 /24): ~{note_events}")

if __name__ == "__main__":
    main()
