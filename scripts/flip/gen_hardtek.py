#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Hardtek 150 BPM Projekt-Generator.
Kuratiert+verarbeitet ein Kit aus dem Billx-Hardtek-Pack, programmiert
150-BPM-Hardtek-Patterns, rendert einen Demo-Track und schreibt ein Manifest
(Kit-Pfade + Pattern-Grids) das der TS-Schritt zu einem .synth macht.
"""
import os, sys, json
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from transform import (read_wav, write_wav, saturate, normalize, butter,
                       fade, reverb, soft_clip)
from fractions import Fraction
from scipy import signal

BILLX = r"E:/Undergroundtekno Billx Hardtek Studio Pack Vol.1 WAV"
OUT   = r"E:\KOPFCHAOT SCHÄTZE\Hardtek150_Projekt"
KIT   = os.path.join(OUT, "samples")
SR    = 44100
BPM   = 150

def pitch_semi(x, semis):
    """semis>0 = höher (kürzer), <0 = tiefer."""
    if semis == 0:
        return x
    f = 2.0 ** (-semis / 12.0)
    fr = Fraction(f).limit_denominator(200)
    return signal.resample_poly(x, fr.numerator, fr.denominator, axis=0)

def slice_s(x, start, dur):
    a = int(start * SR); b = a + int(dur * SR)
    return x[a:b].copy()

def synth_sine(freq, dur, decay, drop_from=None, sat=0.0):
    """Synthetischer Sine-Ton (stereo) mit exp-Decay + optionalem Pitch-Drop.
    Für Sub-Kick-Layer + Sub-Bass. sat>0 = Saturation (Oberwellen → hörbar
    auf kleinen Boxen)."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    if drop_from:
        # Pitch-Envelope: drop_from -> freq über die ersten ~35ms
        k = np.exp(-t / 0.012)
        finst = freq + (drop_from - freq) * k
    else:
        finst = np.full(n, float(freq))
    phase = np.cumsum(2 * np.pi * finst / SR)
    x = np.sin(phase) * np.exp(-t / decay)
    if sat > 0:
        x = np.tanh(x * (1 + sat * 3)) / np.tanh(1 + sat * 3)
    x = np.stack([x, x], axis=1).astype(np.float32)
    return x

# F-Noten (Hz) für tonale Sub-Layer
F1, F2 = 43.65, 87.31

def load(rel):
    r = read_wav(os.path.join(BILLX, rel))
    if r is None:
        raise SystemExit(f"konnte nicht laden: {rel}")
    x, sr = r
    if sr != SR:
        fr = Fraction(SR, sr).limit_denominator(2000)
        x = signal.resample_poly(x.astype(np.float32), fr.numerator, fr.denominator, axis=0)
    if x.ndim == 1:
        x = x[:, None]
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    return x.astype(np.float32)

# ── Kit bauen ────────────────────────────────────────────────────────────────
def build_kit():
    os.makedirs(KIT, exist_ok=True)
    kit = {}

    # FETTER Kick aus 3 Schichten:
    #  1) KIK-Shot = Attack/Click (Transient, Höhen).
    #  2) Sub-Thump = tiefer Pitch-Drop-Sine (150->48 Hz), langer Decay = Gewicht.
    #  3) Mid-Punch = kurzer ~100-Hz-Sine = Brust-"Knock" zwischen Click und Sub.
    # Danach harte Bus-Saturation für Grit + Lautheit.
    kick = load("KIK Shot/BXKIK SHOT 1.wav")
    kick = saturate(kick, 1.8); kick = soft_clip(kick, 0.92)
    kick = fade(kick, SR, 0.001, 0.04)
    sub_thump = synth_sine(48, 0.42, 0.18, drop_from=150, sat=0.6)
    mid_punch = synth_sine(100, 0.10, 0.045, drop_from=180, sat=0.3)
    # 4) Rumble-Tail: DREI verstimmte tiefe Sines (breiteres Beating) + harte
    # Sättigung auf die Summe → Intermodulation = growlende Oberwellen, nicht nur
    # boomender Sub. Langer Decay (0.55s) über 0.95s → rollt über ~2 Kicks.
    rumble_a = synth_sine(45.5, 0.95, 0.55, drop_from=78)
    rumble_b = synth_sine(46.4, 0.95, 0.55)
    rumble_c = synth_sine(47.3, 0.95, 0.55)
    rumble = (rumble_a + rumble_b + rumble_c) / 3.0
    rumble = np.tanh(rumble * 3.2) / np.tanh(3.2)   # Growl-Distortion
    L = max(len(kick), len(sub_thump), len(mid_punch), len(rumble))
    def padto(a, L):
        if len(a) < L:
            a = np.vstack([a, np.zeros((L - len(a), 2), np.float32)])
        return a[:L]
    kick = (padto(kick, L) * 1.0 + padto(sub_thump, L) * 1.1
            + padto(mid_punch, L) * 0.55 + padto(rumble, L) * 0.6)
    kick = np.tanh(kick * 1.4) * 0.97          # Bus-Drive: Grit + Glue
    kick = fade(kick, SR, 0.0, 0.06); kick = normalize(kick, 0.99)
    kit["kick"] = ("HT_Kick.wav", kick)

    snare = load("Snare/BXSnare_03.wav")
    snare = slice_s(snare, 0.0, 0.5); snare = fade(snare, SR, 0.001, 0.08)
    snare = reverb(snare, SR, 0.35, 0.14); snare = normalize(snare, 0.9)
    kit["snare"] = ("HT_Snare.wav", snare)

    hh = load("HH Loop/Bx HH 190 01.wav")
    hc = slice_s(hh, 0.0, 0.07); hc = butter(hc, SR, 500, "high"); hc = fade(hc, SR, 0.0005, 0.03); hc = normalize(hc, 0.7)
    kit["hat_closed"] = ("HT_HatClosed.wav", hc)
    ho = slice_s(hh, 0.158, 0.18); ho = butter(ho, SR, 500, "high"); ho = fade(ho, SR, 0.0005, 0.06); ho = normalize(ho, 0.62)
    kit["hat_open"] = ("HT_HatOpen.wav", ho)

    # Acid-Bass: KURZ + HART verzerrt für busy 16tel-Rolls. Highpass ~110 Hz →
    # sitzt als Mid-Bass ÜBER dem Sub-Bass (kein Matsch wenn busy). Foldback-
    # Saturation (tanh hoher Drive) + Soft-Clip für aggressive Oberwellen.
    bass = load("BassShot/Bx BassShoot ACID F.wav")
    bass = slice_s(bass, 0.0, 0.15)
    bass = saturate(bass, 3.6); bass = soft_clip(bass, 0.88)
    bass = butter(bass, SR, 110, "high")
    bass = fade(bass, SR, 0.002, 0.025); bass = normalize(bass, 0.97)
    kit["bass"] = ("HT_AcidBass_F.wav", bass)

    # Dedizierte Sub-Bass-Spur: sauberer F2-Sine mit Decay, leicht gesättigt →
    # das eigentliche Tiefton-Fundament unter dem Acid-Bass.
    subb = synth_sine(F2, 0.30, 0.22, sat=0.5)
    subb = fade(subb, SR, 0.003, 0.05); subb = normalize(subb, 0.97)
    kit["subbass"] = ("HT_SubBass_F.wav", subb)

    lead = load("Synth/BxSynth 190 1 F.wav")
    lead = slice_s(lead, 0.0, 0.42); lead = fade(lead, SR, 0.002, 0.08); lead = normalize(lead, 0.85)
    kit["lead"] = ("HT_LeadStab_F.wav", lead)

    growl = load("Growls/Bx Growl 128 F 1.wav")
    growl = slice_s(growl, 0.0, 0.55); growl = saturate(growl, 1.3); growl = fade(growl, SR, 0.003, 0.1); growl = normalize(growl, 0.9)
    kit["growl"] = ("HT_Growl_F.wav", growl)

    fx = load("FX/BxFx 190 01.wav")
    fx = normalize(fx, 0.85)
    kit["fx"] = ("HT_FX_Riser.wav", fx)

    sub = load("Sub fall down 190/Bx SubFallDown_190_F_01.wav")
    sub = normalize(sub, 0.8)
    kit["sub"] = ("HT_SubDrop.wav", sub)

    paths = {}
    for role, (fn, data) in kit.items():
        p = os.path.join(KIT, fn)
        write_wav(p, data, SR)
        paths[role] = {"file": fn, "path": p, "buf": data}
    return paths

# ── Patterns (16 Steps, 150 BPM). pitch = Halbtöne relativ zum Sample-Root. ──
# Jede Lane: dict step->pitch (oder step->0).
def L(steps, pitch=0):
    return {s: pitch for s in steps}

# Bass + subbass laufen auf den Offbeats (zwischen den Kicks) → tight, kein
# Matsch. subbass folgt dem bass für volles Fundament.
PATTERNS = {
    "HT150 Main": {
        "kick":       L([0, 4, 8, 12]),
        # voller 16tel-Acid-Roll (alle Nicht-Kick-Steps), groovige Tonhöhen
        "bass":       {1: 0, 2: 0, 3: 0, 5: 0, 6: 0, 7: 3, 9: 0, 10: 0, 11: 0,
                       13: 0, 14: 5, 15: 7},
        # Sub bleibt sauber/sparsam auf den Offbeats → tighter Tiefton
        "subbass":    {2: 0, 6: 0, 10: 0, 14: 0},
        "snare":      L([4, 12]),
        "hat_closed": L([1, 3, 5, 7, 9, 11, 13, 15]),
        "hat_open":   L([2, 6, 10, 14]),
        "growl":      L([8]),
    },
    "HT150 Drop": {
        "kick":       L([0, 4, 8, 12]),
        # voller 16tel-Roll (alle Nicht-Kick-Steps) — aggressiver Acid-Lauf
        "bass":       {1: 0, 2: 0, 3: 0, 5: 0, 6: 3, 7: 0, 9: 0, 10: 0, 11: 5,
                       13: 0, 14: 7, 15: 3},
        "subbass":    {2: 0, 6: 0, 10: 0, 14: 0},
        "snare":      {4: 0, 12: 0, 7: 0, 15: 0},
        "hat_closed": L([1, 3, 5, 7, 9, 11, 13, 15]),
        "hat_open":   L([2, 6, 10, 14]),
        "lead":       {0: 0, 8: 5},
        "growl":      L([8]),
        "sub":        L([0]),
    },
    "HT150 Intro": {
        "kick":       L([0, 4, 8, 12]),
        "subbass":    {2: 0, 6: 0, 10: 0, 14: 0},
        "hat_open":   L([2, 6, 10, 14]),
        "fx":         L([0]),
    },
}

# Kick + Bass dominieren — mehr Druck.
GAINS = {"kick": 1.0, "snare": 0.7, "hat_closed": 0.42, "hat_open": 0.48,
         "bass": 0.95, "subbass": 1.0, "lead": 0.62, "growl": 0.7,
         "fx": 0.55, "sub": 0.95}

# ── Demo rendern ─────────────────────────────────────────────────────────────
def render_demo(paths):
    step_dur = 60.0 / BPM / 4.0           # 16tel
    bar_dur = step_dur * 16
    arrangement = [("HT150 Intro", 2), ("HT150 Main", 4), ("HT150 Drop", 2),
                   ("HT150 Main", 2), ("HT150 Drop", 2)]
    total_bars = sum(n for _, n in arrangement)
    total = int(total_bars * bar_dur * SR) + SR * 6   # +tail
    mix = np.zeros((total, 2), dtype=np.float32)

    bar = 0
    for pat_name, nbars in arrangement:
        pat = PATTERNS[pat_name]
        for b in range(nbars):
            for role, lane in pat.items():
                buf = paths[role]["buf"]
                g = GAINS.get(role, 0.7)
                for step, pit in lane.items():
                    t = (bar + b) * bar_dur + step * step_dur
                    pos = int(t * SR)
                    s = pitch_semi(buf, pit) if pit else buf
                    n = min(len(s), total - pos)
                    if n > 0:
                        mix[pos:pos+n] += s[:n] * g
        bar += nbars

    # Master: Bus-Drive (Glue + Lautheit) + Limiter + Normalisierung. Härter
    # als v1 → knallt mehr.
    mix = np.tanh(mix * 1.35) * 0.97
    mix = soft_clip(mix, 0.98)
    mix = normalize(mix, 0.985)
    demo = os.path.join(OUT, "Hardtek150_DEMO.wav")
    write_wav(demo, mix, SR)
    return demo, total_bars

def main():
    os.makedirs(OUT, exist_ok=True)
    paths = build_kit()
    demo, bars = render_demo(paths)
    # Manifest für den TS-Schritt (ohne Buffers)
    manifest = {
        "bpm": BPM,
        "projectName": "Hardtek 150",
        "kit": {role: {"file": v["file"], "path": v["path"]} for role, v in paths.items()},
        "gains": GAINS,
        "patterns": {name: {role: {str(k): vv for k, vv in lane.items()}
                            for role, lane in pat.items()}
                     for name, pat in PATTERNS.items()},
        "patternOrder": ["HT150 Intro", "HT150 Main", "HT150 Drop"],
    }
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f"Kit: {len(paths)} Samples -> {KIT}")
    print(f"Demo: {demo}  ({bars} bars @ {BPM} BPM)")
    print(f"Manifest: {os.path.join(OUT, 'manifest.json')}")

if __name__ == "__main__":
    main()
