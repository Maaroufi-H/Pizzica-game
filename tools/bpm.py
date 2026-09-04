import subprocess, sys, numpy as np
from scipy.signal import stft
def load(path, sr=22050):
    raw = subprocess.run(['ffmpeg','-v','error','-i',path,'-ac','1','-ar',str(sr),'-f','f32le','-'],capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32), sr
def analyse(path):
    y, sr = load(path)
    hop = 512
    f, t, Z = stft(y, fs=sr, nperseg=2048, noverlap=2048-hop)
    S = np.log1p(50*np.abs(Z))
    flux = np.maximum(0, np.diff(S, axis=1)).sum(0)          # flux spectral (attaques)
    flux -= np.convolve(flux, np.ones(64)/64, 'same')          # retire la tendance lente
    flux = np.maximum(flux, 0)
    fps = sr/hop
    # tempogramme par autocorrelation sur 60..200 bpm
    n = len(flux); ac = np.correlate(flux, flux, 'full')[n-1:]
    lags = np.arange(1, int(fps*60/60)+1)
    bpms = 60*fps/lags
    m = (bpms>=60)&(bpms<=200)
    score = ac[lags[m]] * np.hanning(len(lags[m]))**0.1
    # favoriser 100-160 (pizzica) faiblement
    w = np.exp(-0.5*((bpms[m]-130)/45)**2)
    best = np.argmax(score*w); bpm = bpms[m][best]
    # phase du premier temps: peigne
    period = 60*fps/bpm
    best_ph, best_s = 0, -1
    for ph in np.arange(0, period, 0.25):
        idx = np.arange(ph, min(n, ph+period*64), period).astype(int)
        s = flux[idx].sum()
        if s > best_s: best_s, best_ph = s, ph
    return bpm, best_ph/fps, len(y)/sr
for p in sys.argv[1:]:
    bpm, off, dur = analyse(p)
    print(f'{p.split("/")[-1]}: {bpm:.1f} bpm | premier temps a {off:.3f} s | duree {dur:.1f} s | 4 temps = {240/bpm:.3f} s')
