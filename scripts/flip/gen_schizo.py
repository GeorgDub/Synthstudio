#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Schizo150 — Hardtek/Schizo-Hybrid @ 150 BPM, a-moll. ERWEITERT:
7 Patterns, synth Lead-Riff + reale Melo-Stab (transponiert nach A) + 4 echte
Vocal-Shouts vom Drive (WhatsApp-Clips). Vom Schizo-FLP-Groove abgeleitet,
eigene Riffs/Steps.
"""
import os, sys, json
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from transform import read_wav, write_wav, saturate, normalize, butter, fade, reverb, soft_clip
from fractions import Fraction
from scipy import signal

OUT = r"E:\KOPFCHAOT SCHÄTZE\Schizo150_Projekt"
KIT = os.path.join(OUT, "samples")
SR, BPM = 44100, 150
A1, A2, A3 = 55.0, 110.0, 220.0
DR = "E:/"

def frac(x, fr): return signal.resample_poly(x, fr.numerator, fr.denominator, axis=0)
def to_sr(x, sr): return x if sr == SR else frac(x.astype(np.float32), Fraction(SR, sr).limit_denominator(2000))
def stereo(x):
    if x.ndim == 1: x = x[:, None]
    if x.shape[1] == 1: x = np.repeat(x, 2, axis=1)
    return x[:, :2].astype(np.float32)
def slc(x, a, b): return x[int(a*SR):int(b*SR)].copy()
def load(rel, root):
    r = read_wav(os.path.join(root, rel))
    if r is None: raise FileNotFoundError(rel)
    return stereo(to_sr(*r))

def pitch(buf, semi):
    if semi == 0: return buf
    return frac(buf, Fraction(2.0**(-semi/12.0)).limit_denominator(200))

def detect_root_offset_to_A(buf):
    """Erkennt Tonhöhe (FFT-Autokorr) und gibt Semitone-Offset auf nächstes A."""
    m = buf.mean(axis=1); ds = 4; s = m[:int(SR*0.5)][::ds]; rs = SR/ds
    if len(s) < 256: return 0
    s = (s - s.mean()) * np.hanning(len(s))
    nfft = 1 << int(np.ceil(np.log2(len(s)*2)))
    sp = np.fft.rfft(s, nfft); corr = np.fft.irfft(sp*np.conj(sp))[:len(s)]
    if corr[0] <= 0: return 0
    lo, hi = int(rs/1000), int(rs/60)
    if lo >= hi or hi >= len(corr): return 0
    peak = lo + int(np.argmax(corr[lo:hi])); freq = rs/peak
    midi = int(round(69 + 12*np.log2(freq/440.0)))
    off = (9 - midi) % 12            # 9 = A Pitch-Class
    if off > 6: off -= 12
    return off

# ── Synth ────────────────────────────────────────────────────────────────────
def adsr(n, a, d, s, r):
    e = np.ones(n); ai,di,ri = int(a*SR),int(d*SR),int(r*SR)
    if ai>0: e[:ai]=np.linspace(0,1,ai)
    if di>0: e[ai:ai+di]=np.linspace(1,s,di)
    if ri>0 and ri<n: e[-ri:]=np.linspace(e[-ri],0,ri)
    return e
def supersaw(freq, dur, voices=6, det=0.014, cut=4500):
    n=int(dur*SR); t=np.arange(n)/SR; mix=np.zeros(n)
    for i in range(voices):
        d=1.0+det*(i-(voices-1)/2)/((voices-1)/2 or 1)
        mix+=signal.sawtooth(2*np.pi*freq*d*t)
    mix/=voices
    mix=butter(mix[:,None],SR,cut,"low")[:,0]; mix=butter(mix[:,None],SR,120,"high")[:,0]
    mix*=adsr(n,0.004,0.10,0.55,0.10); mix=np.tanh(mix*2.2)/np.tanh(2.2)
    return stereo(np.stack([mix,mix],1))
def saw_bass(freq, dur, cut=2200):
    n=int(dur*SR); t=np.arange(n)/SR
    x=signal.sawtooth(2*np.pi*freq*t)*0.7+signal.square(2*np.pi*freq*t)*0.3
    x=butter(x[:,None],SR,cut,"low")[:,0]; x*=adsr(n,0.003,0.06,0.5,0.08); x=np.tanh(x*2.6)/np.tanh(2.6)
    return stereo(np.stack([x,x],1))
def sine(freq, dur, decay, drop=None, sat=0.0):
    n=int(dur*SR); t=np.arange(n)/SR
    f=freq+(drop-freq)*np.exp(-t/0.012) if drop else np.full(n,float(freq))
    x=np.sin(np.cumsum(2*np.pi*f/SR))*np.exp(-t/decay)
    if sat>0: x=np.tanh(x*(1+sat*3))/np.tanh(1+sat*3)
    return stereo(np.stack([x,x],1))

BILLX = DR+"Undergroundtekno Billx Hardtek Studio Pack Vol.1 WAV"
WA    = DR+"kranke whatsapp audios"

def build_kit():
    os.makedirs(KIT, exist_ok=True); kit={}
    def pad(a,L): return np.vstack([a,np.zeros((L-len(a),2),np.float32)])[:L] if len(a)<L else a[:L]
    # Fetter 4-Layer-Kick (tonal A)
    k=load("KIK Shot/BXKIK SHOT 1.wav",BILLX); k=saturate(k,1.8); k=soft_clip(k,0.92); k=fade(k,SR,0.001,0.04)
    sub=sine(48,0.42,0.18,drop=150,sat=0.6); mid=sine(100,0.10,0.045,drop=180,sat=0.3)
    ra=sine(A1,0.95,0.55,drop=66); rb=sine(A1+0.4,0.95,0.55); rc=sine(A2,0.95,0.50)
    rum=np.tanh((ra*0.5+rb*0.5+rc*0.35)*3.0)/np.tanh(3.0)
    L=max(len(k),len(sub),len(mid),len(rum))
    k=pad(k,L)*1.0+pad(sub,L)*1.1+pad(mid,L)*0.55+pad(rum,L)*0.6
    k=np.tanh(k*1.4)*0.97; k=fade(k,SR,0,0.06); k=normalize(k,0.99); kit["kick"]=("SZ_Kick.wav",k)

    sn=load("Snare/BXSnare_03.wav",BILLX); sn=slc(sn,0,0.5); sn=fade(sn,SR,0.001,0.08); sn=reverb(sn,SR,0.35,0.14); sn=normalize(sn,0.9); kit["snare"]=("SZ_Snare.wav",sn)
    hh=load("HH Loop/Bx HH 190 01.wav",BILLX)
    hc=slc(hh,0,0.07); hc=butter(hc,SR,500,"high"); hc=fade(hc,SR,0.0005,0.03); hc=normalize(hc,0.7); kit["hat_closed"]=("SZ_HatClosed.wav",hc)
    ho=slc(hh,0.158,0.18); ho=butter(ho,SR,500,"high"); ho=fade(ho,SR,0.0005,0.06); ho=normalize(ho,0.6); kit["hat_open"]=("SZ_HatOpen.wav",ho)

    lead=normalize(supersaw(A3,0.42),0.9); kit["lead"]=("SZ_Lead_A.wav",lead)
    bass=normalize(saw_bass(A1,0.30),0.95); kit["bass"]=("SZ_Bass_A.wav",bass)
    sb=sine(A1,0.28,0.20,sat=0.5); sb=fade(sb,SR,0.003,0.05); kit["subbass"]=("SZ_Sub_A.wav",normalize(sb,0.97))

    # Drückend-dumpfer 4x4-Kick: tiefer Sine-Body, Pitch-Drop, KEIN Click
    # (weicher Attack), Lowpass ~160 Hz = dumpf, harte Saturation = Druck.
    kd=sine(A1,0.34,0.24,drop=95,sat=0.2); kd=butter(kd,SR,160,"low")
    kd=np.tanh(kd*2.2)/np.tanh(2.2); kd=fade(kd,SR,0.005,0.05); kd=normalize(kd,0.97)
    kit["kick_dull"]=("SZ_KickDull.wav",kd)

    # Andere Sampler: Clap vom Drive
    try:
        cl=load("Clap-3  -MONO-194-ESXextracted.wav", DR+"melos"); cl=slc(cl,0,0.3)
        cl=fade(cl,SR,0.001,0.05); cl=normalize(cl,0.85); kit["clap"]=("SZ_Clap.wav",cl)
    except Exception as e: print("clap skip:",e)

    # 2. reale Melo (A MeLo, transponiert nach A) — andere Farbe als Cosmo-Ki
    try:
        m2=load("A MeLo.wav", DR+"MeLo_PacK"); m2=slc(m2,0,0.8)
        m2=pitch(m2, detect_root_offset_to_A(m2)); m2=fade(m2,SR,0.003,0.08); m2=normalize(m2,0.82)
        kit["melo2"]=("SZ_Melo2_A.wav",m2)
    except Exception as e: print("melo2 skip:",e)

    # Reale Melo-Stab (Cosmo-Ki, transponiert nach A) — echtes "Klingeln"
    try:
        ml=load("Cosmo Ki-MONO-050-ESXextracted.wav", DR+"melos"); ml=slc(ml,0,0.5)
        ml=pitch(ml, detect_root_offset_to_A(ml)); ml=fade(ml,SR,0.002,0.06); ml=normalize(ml,0.85)
        kit["melo"]=("SZ_Melo_A.wav",ml)
    except Exception as e: print("melo skip:",e)

    # 4 echte Vocal-Shouts vom Drive (WhatsApp), als Stabs verarbeitet
    voxmap={"vox1":"ey halt die fresse mann.wav","vox2":"weil du ein lappen bist man2.wav",
            "vox3":"handgranate.wav","vox4":"du spasst mann.wav",
            "vox5":"was geht aaap.wav","vox6":"terrosiert.wav"}
    for role,fn in voxmap.items():
        try:
            v=load(fn,WA); v=slc(v,0,min(len(v)/SR,1.6)); v=saturate(v,1.25)
            v=fade(v,SR,0.004,0.1); v=reverb(v,SR,0.3,0.1); v=normalize(v,0.92)
            kit[role]=(f"SZ_{role}.wav",v)
        except Exception as e: print(f"{role} skip:",e)

    fx=normalize(load("FX/BxFx 190 01.wav",BILLX),0.85); kit["fx"]=("SZ_FX.wav",fx)

    paths={}
    for role,(fn,data) in kit.items():
        p=os.path.join(KIT,fn); write_wav(p,data,SR); paths[role]={"file":fn,"path":p,"buf":data}
    return paths

# ── 7 Patterns (a-moll: 0=A 3=C 5=D 7=E 10=G 12=A) ──────────────────────────
def Lr(steps,p=0): return {s:p for s in steps}
RIFF1 = {0:0,2:3,4:7,6:3,8:0,10:7,12:10,14:7}     # A C E C A E G E
RIFF2 = {0:12,2:7,4:10,6:7,8:5,10:3,12:0,14:-2}
RIFFUP= {0:0,4:3,8:5,12:7,14:10}

PATTERNS = {
 "SZ Intro": {"kick":Lr([0,4,8,12]),"hat_closed":Lr([2,6,10,14]),"lead":{0:0,8:7},"fx":{0:0}},
 "SZ Main A":{"kick":Lr([0,4,8,12]),"snare":Lr([4,12]),"hat_closed":Lr([2,6,10,14]),
              "bass":Lr([0,4,8,12]),"subbass":Lr([0,4,8,12]),"lead":RIFF1,"vox1":{0:0}},
 "SZ Main B":{"kick":Lr([0,4,8,12]),"snare":Lr([4,12]),"hat_closed":Lr([2,6,10,14]),
              "bass":Lr([0,4,8,12]),"subbass":Lr([0,4,8,12]),"lead":RIFF2,
              "melo":{4:0,12:3},"vox4":{0:0}},
 "SZ Drop A":{"kick":Lr([0,4,8,12]),"snare":{4:0,12:0,15:0},"hat_closed":Lr([2,6,10,14]),"hat_open":Lr([0,8]),
              "bass":{0:0,2:0,4:0,6:7,8:0,10:0,12:0,14:7},"subbass":Lr([0,4,8,12]),
              "lead":RIFF1,"vox2":{0:0},"melo":{8:0}},
 "SZ Drop B":{"kick":Lr([0,4,8,12]),"snare":{4:0,12:0,15:0},"hat_closed":Lr([2,6,10,14]),"hat_open":Lr([0,8]),
              "bass":{0:0,2:0,4:0,6:7,8:0,10:0,12:0,14:7},"subbass":Lr([0,4,8,12]),
              "lead":RIFF2,"vox3":{0:0},"vox1":{8:0},"melo":{2:3,10:7}},
 "SZ Break": {"kick":Lr([0,8]),"hat_closed":Lr([2,6,10,14]),"lead":RIFF1,
              "melo":{0:0,4:3,8:5,12:7},"vox2":{0:0},"vox3":{8:0}},
 "SZ Build": {"kick":Lr([0,4,8,12]),"snare":{8:0,10:0,12:0,13:0,14:0,15:0},
              "fx":{0:0},"lead":RIFFUP,"subbass":{0:0}},
 # Drückend-dumpfer 4x4-Kick — dunkel/hypnotisch
 "SZ Dumpf": {"kick_dull":Lr([0,4,8,12]),"subbass":Lr([0,4,8,12]),"hat_closed":Lr([2,6,10,14]),
              "melo2":{0:0,8:7},"vox5":{0:0}},
 "SZ Dumpf Roll":{"kick_dull":Lr([0,4,8,12]),"subbass":Lr([0,4,8,12]),
              "bass":{2:0,6:7,10:0,14:7},"hat_closed":Lr([2,6,10,14]),"clap":Lr([4,12]),
              "lead":{0:0,8:7},"melo2":{8:0},"vox6":{0:0}},
 # Andere Sampler/Combo: Clap statt nur Snare, 2. Melo, anderes Vocal
 "SZ Main C": {"kick":Lr([0,4,8,12]),"snare":Lr([4,12]),"clap":Lr([4,12]),"hat_closed":Lr([2,6,10,14]),
              "bass":Lr([0,4,8,12]),"subbass":Lr([0,4,8,12]),"lead":RIFF1,
              "melo2":{2:0,10:3},"vox5":{0:0}},
}
GAINS={"kick":1.0,"kick_dull":1.0,"snare":0.72,"clap":0.6,"hat_closed":0.45,"hat_open":0.5,
       "bass":0.85,"subbass":0.95,"lead":0.6,"melo":0.62,"melo2":0.6,
       "vox1":0.85,"vox2":0.85,"vox3":0.85,"vox4":0.85,"vox5":0.85,"vox6":0.85,"fx":0.55}

def render(paths):
    sd=60.0/BPM/4.0; bd=sd*16
    arr=[("SZ Intro",2),("SZ Dumpf",4),("SZ Main A",4),("SZ Main C",4),("SZ Dumpf Roll",4),
         ("SZ Drop A",4),("SZ Break",2),("SZ Build",1),("SZ Drop B",4)]
    tot=int(sum(n for _,n in arr)*bd*SR)+SR*6
    mix=np.zeros((tot,2),np.float32); bar=0
    for name,nb in arr:
        pat=PATTERNS[name]
        for b in range(nb):
            for role,lane in pat.items():
                if role not in paths: continue
                buf=paths[role]["buf"]; g=GAINS.get(role,0.7)
                for st,pit in lane.items():
                    pos=int(((bar+b)*bd+st*sd)*SR); s=pitch(buf,pit) if pit else buf
                    n=min(len(s),tot-pos)
                    if n>0: mix[pos:pos+n]+=s[:n]*g
        bar+=nb
    mix=np.tanh(mix*1.3)*0.97; mix=soft_clip(mix,0.98); mix=normalize(mix,0.985)
    d=os.path.join(OUT,"Schizo150_DEMO.wav"); write_wav(d,mix,SR); return d, sum(n for _,n in arr)

def main():
    os.makedirs(OUT,exist_ok=True)
    paths=build_kit(); demo,bars=render(paths)
    order=["SZ Intro","SZ Main A","SZ Main B","SZ Main C","SZ Dumpf","SZ Dumpf Roll",
           "SZ Drop A","SZ Drop B","SZ Break","SZ Build"]
    manifest={"bpm":BPM,"projectName":"Schizo 150",
              "kit":{r:{"file":v["file"],"path":v["path"]} for r,v in paths.items()},
              "gains":GAINS,
              "patterns":{n:{r:{str(k):vv for k,vv in lane.items()} for r,lane in pat.items()} for n,pat in PATTERNS.items()},
              "patternOrder":order}
    json.dump(manifest,open(os.path.join(OUT,"manifest.json"),"w",encoding="utf-8"),indent=2,ensure_ascii=False)
    print(f"Kit {len(paths)} Sounds -> {KIT}")
    print(f"Demo {demo} ({bars} bars)")
    print("Roles:", list(paths.keys()))
    print("Patterns:", order)

if __name__=="__main__": main()
