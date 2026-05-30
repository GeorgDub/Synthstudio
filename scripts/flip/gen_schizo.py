#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Schizo150 — Hardtek/Schizo-Hybrid @ 150 BPM.

Abgeleitet vom echten 38er-Schizo-FLP-Groove (Analyse: Kick 0/4/8/12, Snare
4/12, Offbeat-FX 2/6/10/14, melodischer 8tel-Riff in a-moll, Vocal-Stabs).
Bessere/passende Samples vom Drive (Billx Hardtek Drums) + SYNTHETISIERTER
Hardcore-Lead-Riff (das "Klingeln") + Vocal-Chops vom Drive. Steps variiert,
NICHT identisch zum Original.
"""
import os, sys, json
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from transform import read_wav, write_wav, saturate, normalize, butter, fade, reverb, soft_clip
from fractions import Fraction
from scipy import signal

BILLX = r"E:/Undergroundtekno Billx Hardtek Studio Pack Vol.1 WAV"
OUT   = r"E:\KOPFCHAOT SCHÄTZE\Schizo150_Projekt"
KIT   = os.path.join(OUT, "samples")
SR    = 44100
BPM   = 150

# A-Moll (wie Schizo-Riff). MIDI: A3=57. Basis-Frequenzen:
A1, A2, A3 = 55.0, 110.0, 220.0

def fr(x, frac): return signal.resample_poly(x, frac.numerator, frac.denominator, axis=0)
def to_sr(x, sr):
    if sr == SR: return x
    return fr(x.astype(np.float32), Fraction(SR, sr).limit_denominator(2000))
def stereo(x):
    if x.ndim == 1: x = x[:, None]
    if x.shape[1] == 1: x = np.repeat(x, 2, axis=1)
    return x[:, :2].astype(np.float32)
def slc(x, a, b): return x[int(a*SR):int(b*SR)].copy()

def load(rel, root=BILLX):
    r = read_wav(os.path.join(root, rel))
    if r is None: raise SystemExit("load fail "+rel)
    x, sr = r
    return stereo(to_sr(x, sr))

# ── Synth-Bausteine ──────────────────────────────────────────────────────────
def adsr(n, a=0.005, d=0.08, s=0.6, r=0.12):
    env = np.ones(n); ai=int(a*SR); di=int(d*SR); ri=int(r*SR)
    if ai>0: env[:ai]=np.linspace(0,1,ai)
    if di>0: env[ai:ai+di]=np.linspace(1,s,di)
    if ri>0 and ri<n: env[-ri:]=np.linspace(env[-ri],0,ri)
    return env

def supersaw(freq, dur, voices=6, detune=0.014, cutoff=4500):
    """Hardcore-Supersaw-Lead-One-Shot. Detuned saws → bandpass → ADSR → drive."""
    n = int(dur*SR); t = np.arange(n)/SR
    mix = np.zeros(n)
    for i in range(voices):
        d = 1.0 + detune*(i-(voices-1)/2)/((voices-1)/2 or 1)
        mix += signal.sawtooth(2*np.pi*freq*d*t)
    mix /= voices
    mix = butter(mix[:,None], SR, cutoff, "low")[:,0]
    mix = butter(mix[:,None], SR, 120, "high")[:,0]
    mix *= adsr(n, 0.004, 0.10, 0.55, 0.10)
    mix = np.tanh(mix*2.2)/np.tanh(2.2)          # Hardcore-Edge
    return stereo(np.stack([mix, mix], 1)[:, :, 0] if mix.ndim>1 else mix)

def saw_bass(freq, dur, cutoff=2200):
    n=int(dur*SR); t=np.arange(n)/SR
    x = signal.sawtooth(2*np.pi*freq*t)*0.7 + signal.square(2*np.pi*freq*t)*0.3
    x = butter(x[:,None], SR, cutoff, "low")[:,0]
    x *= adsr(n, 0.003, 0.06, 0.5, 0.08)
    x = np.tanh(x*2.6)/np.tanh(2.6)
    return stereo(np.stack([x,x],1))

def sine(freq, dur, decay, drop=None, sat=0.0):
    n=int(dur*SR); t=np.arange(n)/SR
    f = freq + (drop-freq)*np.exp(-t/0.012) if drop else np.full(n,float(freq))
    x = np.sin(np.cumsum(2*np.pi*f/SR))*np.exp(-t/decay)
    if sat>0: x=np.tanh(x*(1+sat*3))/np.tanh(1+sat*3)
    return stereo(np.stack([x,x],1))

# ── Kit ──────────────────────────────────────────────────────────────────────
def build_kit():
    os.makedirs(KIT, exist_ok=True)
    kit = {}
    def pad(a,L): return np.vstack([a,np.zeros((L-len(a),2),np.float32)])[:L] if len(a)<L else a[:L]

    # Fetter Kick (wie Hardtek v8): Click + Sub-Thump + Mid + Rumble-Tail (tonal A1)
    k = load("KIK Shot/BXKIK SHOT 1.wav"); k=saturate(k,1.8); k=soft_clip(k,0.92); k=fade(k,SR,0.001,0.04)
    sub = sine(48,0.42,0.18,drop=150,sat=0.6); mid=sine(100,0.10,0.045,drop=180,sat=0.3)
    ra=sine(A1,0.95,0.55,drop=66); rb=sine(A1+0.4,0.95,0.55); rc=sine(A2,0.95,0.50)
    rum=ra*0.5+rb*0.5+rc*0.35; rum=np.tanh(rum*3.0)/np.tanh(3.0)
    L=max(len(k),len(sub),len(mid),len(rum))
    k=pad(k,L)*1.0+pad(sub,L)*1.1+pad(mid,L)*0.55+pad(rum,L)*0.6
    k=np.tanh(k*1.4)*0.97; k=fade(k,SR,0,0.06); k=normalize(k,0.99); kit["kick"]=("SZ_Kick.wav",k)

    sn=load("Snare/BXSnare_03.wav"); sn=slc(sn,0,0.5); sn=fade(sn,SR,0.001,0.08); sn=reverb(sn,SR,0.35,0.14); sn=normalize(sn,0.9); kit["snare"]=("SZ_Snare.wav",sn)
    hh=load("HH Loop/Bx HH 190 01.wav")
    hc=slc(hh,0,0.07); hc=butter(hc,SR,500,"high"); hc=fade(hc,SR,0.0005,0.03); hc=normalize(hc,0.7); kit["hat_closed"]=("SZ_HatClosed.wav",hc)
    ho=slc(hh,0.158,0.18); ho=butter(ho,SR,500,"high"); ho=fade(ho,SR,0.0005,0.06); ho=normalize(ho,0.6); kit["hat_open"]=("SZ_HatOpen.wav",ho)

    # Melodischer Lead-Riff-Sound (synth supersaw, Basis A3) = das "Klingeln"
    lead=supersaw(A3,0.42); lead=normalize(lead,0.9); kit["lead"]=("SZ_Lead_A.wav",lead)
    # Hard-Saw-Bass (Basis A1)
    bass=saw_bass(A1,0.30); bass=normalize(bass,0.95); kit["bass"]=("SZ_Bass_A.wav",bass)
    # Sub (A1)
    sb=sine(A1,0.28,0.20,sat=0.5); sb=fade(sb,SR,0.003,0.05); sb=normalize(sb,0.97); kit["subbass"]=("SZ_Sub_A.wav",sb)

    # Vocals vom Drive (gechoppt + verarbeitet)
    try:
        v1=load("Marvii Live 3/Scream 15.wav", root=r"E:/MeLo_PacK"); v1=slc(v1,0,0.8); v1=saturate(v1,1.4); v1=fade(v1,SR,0.003,0.1); v1=reverb(v1,SR,0.4,0.15); v1=normalize(v1,0.9); kit["vox_scream"]=("SZ_Vox_Scream.wav",v1)
    except SystemExit: pass
    try:
        v2=load("balenciaga vocal.wav", root=r"E:/melos"); v2=slc(v2,0,1.4); v2=saturate(v2,1.2); v2=fade(v2,SR,0.005,0.12); v2=normalize(v2,0.92); kit["vox_phrase"]=("SZ_Vox_Phrase.wav",v2)
    except SystemExit: pass

    fx=load("FX/BxFx 190 01.wav"); fx=normalize(fx,0.85); kit["fx"]=("SZ_FX.wav",fx)

    paths={}
    for role,(fn,data) in kit.items():
        p=os.path.join(KIT,fn); write_wav(p,data,SR); paths[role]={"file":fn,"path":p,"buf":data}
    return paths

# ── Riff (a-moll, 8tel) — MEIN Riff, vom Schizo-Stil inspiriert, nicht identisch
# Lead-Pitches relativ zu A3 (Basis-Sample). Am: A C E G.
LEAD_RIFF = {0:0, 2:3, 4:7, 6:3, 8:0, 10:7, 12:10, 14:7}        # A C E C A E G E
LEAD_RIFF2= {0:12,2:7, 4:10,6:7, 8:5, 10:3, 12:0, 14:-2}        # Variation eine Oktave/runter
BASS_LINE = {0:0, 4:0, 8:0, 12:0, 14:7}                          # Root A + Quint-Akzent

def L(steps,p=0): return {s:p for s in steps}

PATTERNS = {
    "SZ Main": {
        "kick":       L([0,4,8,12]),
        "bass":       BASS_LINE,
        "subbass":    {0:0,4:0,8:0,12:0},
        "snare":      L([4,12]),
        "hat_closed": L([2,6,10,14]),
        "lead":       LEAD_RIFF,
        "vox_scream": {0:0},
    },
    "SZ Drop": {
        "kick":       L([0,4,8,12]),
        "bass":       {0:0,2:0,4:0,6:7,8:0,10:0,12:0,14:7},
        "subbass":    {0:0,4:0,8:0,12:0},
        "snare":      {4:0,12:0,15:0},
        "hat_closed": L([2,6,10,14]),
        "hat_open":   L([0,8]),
        "lead":       LEAD_RIFF2,
        "vox_phrase": {0:0},
        "vox_scream": {8:0},
    },
    "SZ Intro": {
        "kick":       L([0,4,8,12]),
        "hat_closed": L([2,6,10,14]),
        "lead":       {0:0,8:7},
        "fx":         {0:0},
    },
}
GAINS={"kick":1.0,"snare":0.72,"hat_closed":0.45,"hat_open":0.5,"bass":0.85,
       "subbass":0.95,"lead":0.62,"vox_scream":0.8,"vox_phrase":0.85,"fx":0.55}

def pitch(buf,semi):
    if semi==0: return buf
    f=2.0**(-semi/12.0); return fr(buf, Fraction(f).limit_denominator(200))

def render(paths):
    sd=60.0/BPM/4.0; bd=sd*16
    arr=[("SZ Intro",2),("SZ Main",4),("SZ Drop",2),("SZ Main",2),("SZ Drop",2)]
    tot=int(sum(n for _,n in arr)*bd*SR)+SR*6
    mix=np.zeros((tot,2),np.float32); bar=0
    for name,nb in arr:
        pat=PATTERNS[name]
        for b in range(nb):
            for role,lane in pat.items():
                if role not in paths: continue
                buf=paths[role]["buf"]; g=GAINS.get(role,0.7)
                for st,pit in lane.items():
                    pos=int(((bar+b)*bd+st*sd)*SR)
                    s=pitch(buf,pit) if pit else buf
                    n=min(len(s),tot-pos)
                    if n>0: mix[pos:pos+n]+=s[:n]*g
        bar+=nb
    mix=np.tanh(mix*1.3)*0.97; mix=soft_clip(mix,0.98); mix=normalize(mix,0.985)
    d=os.path.join(OUT,"Schizo150_DEMO.wav"); write_wav(d,mix,SR); return d

def main():
    os.makedirs(OUT,exist_ok=True)
    paths=build_kit(); demo=render(paths)
    manifest={"bpm":BPM,"projectName":"Schizo 150","kit":{r:{"file":v["file"],"path":v["path"]} for r,v in paths.items()},
              "gains":GAINS,
              "patterns":{n:{r:{str(k):vv for k,vv in lane.items()} for r,lane in pat.items()} for n,pat in PATTERNS.items()},
              "patternOrder":["SZ Intro","SZ Main","SZ Drop"]}
    json.dump(manifest,open(os.path.join(OUT,"manifest.json"),"w",encoding="utf-8"),indent=2,ensure_ascii=False)
    print(f"Kit {len(paths)} -> {KIT}"); print(f"Demo {demo}")
    print("Roles:", list(paths.keys()))

if __name__=="__main__": main()
