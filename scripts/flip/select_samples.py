#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sucht tonale Melodien (mit Tonhöhen-Erkennung) + Vocal-Stabs vom Drive für
Schizo150. Gibt Kandidaten sortiert aus — daraus picke ich fürs Projekt."""
import os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from transform import read_wav

NOTE = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]
A_MINOR = {"A","B","C","D","E","F","G"}  # natural a-moll

def mono(x): return x.mean(axis=1) if x.ndim > 1 else x

def detect_pitch(x, sr):
    """FFT-Autokorrelation (O(n log n)) → (freq, clarity 0..1). Downsample auf
    ~11 kHz für Speed (Pitch bis ~1 kHz reicht)."""
    ds = max(1, sr // 11025)
    s = x[: int(sr * 0.5)][::ds]
    rs = sr / ds
    if len(s) < 512: return None, 0.0
    s = (s - s.mean()) * np.hanning(len(s))
    nfft = 1 << int(np.ceil(np.log2(len(s) * 2)))
    sp = np.fft.rfft(s, nfft)
    corr = np.fft.irfft(sp * np.conj(sp))[: len(s)]
    if corr[0] <= 0: return None, 0.0
    corr = corr / corr[0]
    lo, hi = int(rs/1000), int(rs/60)
    if hi >= len(corr): hi = len(corr) - 1
    if lo >= hi: return None, 0.0
    peak = lo + int(np.argmax(corr[lo:hi]))
    return rs/peak, float(corr[peak])

def note_of(freq):
    midi = int(round(69 + 12*np.log2(freq/440.0)))
    return NOTE[midi % 12], midi

def scan_melos(folders, limit=400):
    out = []
    for fo in folders:
        base = os.path.join("E:/", fo)
        if not os.path.isdir(base): continue
        cnt = 0
        for r, _, fs in os.walk(base):
            for f in fs:
                if not f.lower().endswith(".wav"): continue
                p = os.path.join(r, f)
                try:
                    if os.path.getsize(p) > 8_000_000: continue
                    res = read_wav(p)
                except Exception: continue
                if res is None: continue
                x, sr = res; dur = len(x)/sr
                if dur < 0.3 or dur > 6: continue
                m = mono(x); pk = float(np.max(np.abs(m)) + 1e-9)
                freq, clar = detect_pitch(m/pk, sr)
                if freq is None or clar < 0.45: continue
                nm, midi = note_of(freq)
                out.append({"fo": fo, "rel": os.path.relpath(p, base), "dur": dur,
                            "note": nm, "midi": midi, "clarity": clar, "pk": pk})
                cnt += 1
                if cnt >= limit: break
            if cnt >= limit: break
    return out

def scan_vocals(folder, n=300):
    base = os.path.join("E:/", folder)
    out = []
    if not os.path.isdir(base): return out
    for f in sorted(os.listdir(base)):
        if not f.lower().endswith(".wav"): continue
        p = os.path.join(base, f)
        try:
            res = read_wav(p)
        except Exception: continue
        if res is None: continue
        x, sr = res; dur = len(x)/sr
        m = mono(x); rms = float(np.sqrt(np.mean(m**2)))
        out.append({"file": f, "dur": dur, "rms": rms, "pk": float(np.max(np.abs(m)))})
        if len(out) >= n: break
    return out

if __name__ == "__main__":
    print("=== MELOS (tonal, a-moll-tauglich, sortiert nach Klarheit) ===")
    melos = scan_melos(["MeLo_PacK", "melos"])
    melos = [m for m in melos if m["note"] in A_MINOR]
    melos.sort(key=lambda m: -m["clarity"])
    for m in melos[:30]:
        print(f"  [{m['note']:2s}] clar{m['clarity']:.2f} {m['dur']:4.1f}s  {m['fo']}/{m['rel'][:46]}")

    print("\n=== VOCALS (WhatsApp-Clips: kurz + laut = Stab-tauglich) ===")
    vox = scan_vocals("kranke whatsapp audios")
    short = [v for v in vox if 0.3 <= v["dur"] <= 2.0]
    short.sort(key=lambda v: -v["rms"])
    for v in short[:20]:
        print(f"  {v['dur']:4.1f}s rms{v['rms']:.3f} pk{v['pk']:.2f}  {v['file']}")
    print(f"\n(insg. {len(melos)} tonale Melos, {len(vox)} WhatsApp-Clips gescannt)")
