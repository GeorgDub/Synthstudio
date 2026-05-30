#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""38er ShizoStyle -> Dark Industrial / Hard-Techno Flip.

Liest die Original-WAVs, wendet kategorieabhaengige DSP an (Pitch-Down,
Saturation, Filter, Reverb, Bitcrush, Reverse) und schreibt ein neues
Sample-Set mit GLEICHEN Dateinamen -> die Original-FLP laedt beim Import
in Synthstudio automatisch die transformierten Sounds (Basename-Match).

Nur numpy + scipy. Robust gegen 8/16/24/32-bit + float, mono/stereo.
"""
import os, struct, sys
import numpy as np
from scipy import signal
from fractions import Fraction

SRC = r"E:\KOPFCHAOT SCHÄTZE\38er ShizoStyle"
DST = r"E:\KOPFCHAOT SCHÄTZE\38er ShizoStyle_FLIP"
BONUS = os.path.join(DST, "bonus_material")
OUT_SR = 44100

# Vollstaendig ausgeschlossen (kommerzielle/ganze Songs).
EXCLUDE = {
    "the offspring - pretty fly for a white guy (wipeout riddim)‏.wav",
    "hope  cutted.wav",
}

# ---------------------------------------------------------------- WAV I/O

def _find_chunks(data):
    """Gibt (fmt_dict, data_offset, data_size) oder None."""
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        return None
    i = 12
    fmt = None
    doff = dsize = None
    while i + 8 <= len(data):
        cid = data[i:i+4]; csz = struct.unpack("<I", data[i+4:i+8])[0]; i += 8
        if cid == b"fmt ":
            af, ch, sr, _br, _ba, bits = struct.unpack("<HHIIHH", data[i:i+16])
            fmt = {"fmt": af, "ch": ch, "sr": sr, "bits": bits}
        elif cid == b"data":
            doff, dsize = i, csz
        i += csz + (csz & 1)
    if fmt is None or doff is None:
        return None
    return fmt, doff, dsize

def read_wav(path):
    """-> (float32 array shape (n, ch) in [-1,1], sr) oder None."""
    with open(path, "rb") as f:
        raw = f.read()
    c = _find_chunks(raw)
    if not c:
        return None
    fmt, doff, dsize = c
    af, ch, sr, bits = fmt["fmt"], fmt["ch"], fmt["sr"], fmt["bits"]
    buf = raw[doff:doff+dsize]
    if af in (1, 0xFFFE):  # PCM (int)
        if bits == 8:
            a = np.frombuffer(buf, dtype=np.uint8).astype(np.float32)
            a = (a - 128.0) / 128.0
        elif bits == 16:
            a = np.frombuffer(buf, dtype="<i2").astype(np.float32) / 32768.0
        elif bits == 24:
            b = np.frombuffer(buf, dtype=np.uint8)
            n = (len(b) // 3) * 3
            b = b[:n].reshape(-1, 3).astype(np.int32)
            a = (b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)).astype(np.int32)
            a = np.where(a & 0x800000, a - (1 << 24), a).astype(np.float32) / 8388608.0
        elif bits == 32:
            a = np.frombuffer(buf, dtype="<i4").astype(np.float32) / 2147483648.0
        else:
            return None
    elif af == 3:  # IEEE float
        a = np.frombuffer(buf, dtype="<f4").astype(np.float32)
    else:
        return None  # MP3-in-WAV etc.
    if ch > 1:
        n = (len(a) // ch) * ch
        a = a[:n].reshape(-1, ch)
    else:
        a = a.reshape(-1, 1)
    return a, sr

def write_wav(path, x, sr=OUT_SR):
    """Schreibt 16-bit PCM stereo."""
    x = np.atleast_2d(x)
    if x.shape[0] < x.shape[1] and x.shape[0] <= 2:
        x = x.T
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    elif x.shape[1] > 2:
        x = x[:, :2]
    x = np.clip(x, -1.0, 1.0)
    pcm = (x * 32767.0).astype("<i2")
    raw = pcm.tobytes()
    with open(path, "wb") as f:
        f.write(b"RIFF"); f.write(struct.pack("<I", 36 + len(raw))); f.write(b"WAVE")
        f.write(b"fmt "); f.write(struct.pack("<IHHIIHH", 16, 1, 2, sr, sr*2*2, 4, 16))
        f.write(b"data"); f.write(struct.pack("<I", len(raw))); f.write(raw)

# ---------------------------------------------------------------- DSP

def to_sr(x, sr, target=OUT_SR):
    if sr == target:
        return x
    fr = Fraction(target, sr).limit_denominator(2000)
    return signal.resample_poly(x, fr.numerator, fr.denominator, axis=0)

def pitch_down(x, semitones):
    """Pitch (und Tempo) nach unten via Resampling. semitones > 0 = tiefer."""
    if semitones == 0:
        return x
    f = 2.0 ** (semitones / 12.0)  # Streckfaktor (laenger + tiefer)
    fr = Fraction(f).limit_denominator(200)
    return signal.resample_poly(x, fr.numerator, fr.denominator, axis=0)

def normalize(x, peak=0.89):
    m = np.max(np.abs(x)) + 1e-9
    return x * (peak / m)

def saturate(x, drive=2.0):
    return np.tanh(x * drive) / np.tanh(drive)

def soft_clip(x, t=0.8):
    return np.clip(x, -t, t) / t

def butter(x, sr, cutoff, btype, order=2):
    ny = sr / 2.0
    if isinstance(cutoff, (list, tuple)):
        wn = [max(1, c)/ny for c in cutoff]
        wn = [min(0.999, w) for w in wn]
    else:
        wn = min(0.999, max(1, cutoff)/ny)
    b, a = signal.butter(order, wn, btype=btype)
    return signal.filtfilt(b, a, x, axis=0)

def bitcrush(x, bits=10, ds=2):
    lv = 2 ** bits
    q = np.round(x * lv) / lv
    if ds > 1:
        held = np.repeat(q[::ds], ds, axis=0)[:len(q)]
        if len(held) < len(q):
            pad = np.repeat(held[-1:], len(q)-len(held), axis=0)
            held = np.vstack([held, pad])
        q = held
    return q

def _comb(x, d, g):
    """Feedback-Comb via IIR: y = x + g*y[n-d]. Vektorisiert (lfilter)."""
    a = np.zeros(d + 1, dtype=np.float64); a[0] = 1.0; a[d] = -g
    return signal.lfilter([1.0], a, x, axis=0)

def _allpass(x, d, g):
    b = np.zeros(d + 1, dtype=np.float64); b[0] = -g; b[d] = 1.0
    a = np.zeros(d + 1, dtype=np.float64); a[0] = 1.0; a[d] = -g
    return signal.lfilter(b, a, x, axis=0)

def reverb(x, sr, decay=0.5, mix=0.25):
    """Schroeder-Reverb (4 Combs parallel + 2 Allpass seriell), vektorisiert."""
    if mix <= 0:
        return x
    peak0 = np.max(np.abs(x)) + 1e-9
    combs = [(int(sr*d), decay*g) for d, g in
             ((0.0297, 0.84), (0.0371, 0.80), (0.0411, 0.78), (0.0437, 0.76))]
    out = np.zeros_like(x, dtype=np.float64)
    for d, g in combs:
        out += _comb(x, d, g)
    out /= len(combs)
    for d, g in ((int(sr*0.005), 0.7), (int(sr*0.0017), 0.7)):
        if d >= 1:
            out = _allpass(out, d, g)
    out = out.astype(np.float32)
    return (1-mix)*x + mix*normalize(out, peak0)

def fade(x, sr, fin=0.003, fout=0.02):
    n = len(x)
    ni = min(int(sr*fin), n//2); no = min(int(sr*fout), n//2)
    if ni > 0:
        x[:ni] *= np.linspace(0, 1, ni)[:, None]
    if no > 0:
        x[-no:] *= np.linspace(1, 0, no)[:, None]
    return x

def decay_env(x, sr, dur):
    n = len(x); d = int(sr*dur)
    env = np.ones(n, dtype=np.float32)
    if d < n:
        env[d:] = np.linspace(1, 0, n-d)
    else:
        env = np.exp(-np.linspace(0, 3, n))
    return x * env[:, None]

# ---------------------------------------------------------------- Kategorisierung

def categorize(name):
    s = name.lower()
    def has(*ks): return any(k in s for k in ks)
    if has("scream", "screech"):
        return "scream"
    if has("kick", "hammer", "hardstyla", "websterhardbass", "clyde sadistic", "new kick"):
        return "kick"
    if has("snare", "snar", "nervensturz", "perk", "clydesnare"):
        return "snare"
    if has("closed hh", " hh", "cymbal", "crash", "mecha", "hat"):
        return "hat"
    if has("voc", "fotze", "lil jon", "rambo", "konsum", "pr�si", "loikami",
           "haimkind", "meccano", "she17", "bakalla", "heilige wut", "die eier",
           "vorschlaghammer", "badattitude", "die1", "crazy", "sickmf"):
        return "vocal"
    if has("synth", "syhnt", "lead", "mello", "pad", "supachor", "killa bees",
           "vec2 synths", "bass", "blub", "01 - synth"):
        return "synth"
    return "fx"

# ---------------------------------------------------------------- Transform pro Kategorie

def transform(cat, x, sr, idx):
    if cat == "kick":
        x = pitch_down(x, 2); x = saturate(x, 4.0); x = soft_clip(x, 0.85)
        x = decay_env(x, sr, 0.30); x = normalize(x, 0.95)
    elif cat == "snare":
        x = pitch_down(x, 1); x = saturate(x, 2.6); x = reverb(x, sr, 0.4, 0.18)
        x = normalize(x, 0.9)
    elif cat == "hat":
        x = butter(x, sr, 600, "high"); x = bitcrush(x, 10, 2)
        x = fade(x, sr, 0.001, 0.04); x = normalize(x, 0.8)
    elif cat == "scream":
        x = pitch_down(x, 5); x = butter(x, sr, 4500, "low"); x = saturate(x, 1.6)
        x = reverb(x, sr, 0.7, 0.33); x = normalize(x, 0.88)
    elif cat == "synth":
        x = pitch_down(x, 3); x = butter(x, sr, 5500, "low"); x = saturate(x, 1.9)
        x = reverb(x, sr, 0.5, 0.16); x = normalize(x, 0.9)
    elif cat == "vocal":
        x = pitch_down(x, 3)
        x = butter(x, sr, [280, 3200], "band") if idx % 2 == 0 else butter(x, sr, 6000, "low")
        x = saturate(x, 1.4); x = reverb(x, sr, 0.6, 0.36); x = normalize(x, 0.9)
    else:  # fx
        if idx % 2 == 1:
            x = x[::-1].copy()
        x = pitch_down(x, 2); x = butter(x, sr, 6500, "low")
        x = reverb(x, sr, 0.55, 0.26); x = normalize(x, 0.9)
    return x

# ---------------------------------------------------------------- Main

def main():
    os.makedirs(DST, exist_ok=True)
    os.makedirs(BONUS, exist_ok=True)
    files = sorted(os.listdir(SRC))
    wavs = [f for f in files if f.lower().endswith(".wav")]
    counts = {}
    ok = skipped = 0
    bonus_made = 0
    for i, w in enumerate(wavs):
        if w.lower() in EXCLUDE:
            print(f"  [EXCL] {w}")
            skipped += 1
            continue
        r = read_wav(os.path.join(SRC, w))
        if r is None:
            print(f"  [SKIP-undecodable] {w}")
            skipped += 1
            continue
        x, sr = r
        if len(x) < 8:
            print(f"  [SKIP-empty] {w}")
            skipped += 1
            continue
        # Lange Loops (>30s) auf max 20s kuerzen (Material, keine ganzen Songs)
        if len(x) / sr > 30:
            x = x[: int(sr * 20)]
        x = to_sr(x.astype(np.float32), sr, OUT_SR); sr = OUT_SR
        cat = categorize(w)
        try:
            y = transform(cat, x.copy(), sr, i)
        except Exception as e:
            print(f"  [ERR] {w}: {e}")
            skipped += 1
            continue
        write_wav(os.path.join(DST, w), y, sr)
        counts[cat] = counts.get(cat, 0) + 1
        ok += 1
        # Bonus: aus laengeren scream/synth-Loops einen reversed-Riser bauen
        if cat in ("scream", "synth") and len(x)/sr > 2.5:
            rev = x[::-1].copy()
            rev = pitch_down(rev, 4); rev = butter(rev, sr, 5000, "low")
            rev = reverb(rev, sr, 0.8, 0.4); rev = fade(rev, sr, 0.5, 0.05)
            rev = normalize(rev, 0.85)
            base = os.path.splitext(w)[0]
            write_wav(os.path.join(BONUS, f"{base}_RISER.wav"), rev, sr)
            bonus_made += 1
    print(f"\n=== fertig: {ok} transformiert, {skipped} uebersprungen, {bonus_made} Bonus-Riser ===")
    print(f"  Kategorien: {counts}")
    print(f"  -> {DST}")

if __name__ == "__main__":
    main()
