"""Moteur de mouvements V21: poses extraites d'une video (MediaPipe) -> squelette du jeu.
   - conversion landmarks -> joints (memes cles que les BVH), lissage, orientation face camera
   - detection du cycle de pas (autocorrelation), selection de boucles distinctes (= pas differents)
   - rendu via bvh_dancer (render / render_woman, foulard simule)"""
import sys, math, json, numpy as np
from pathlib import Path
from scipy.signal import savgol_filter
import bvh_dancer as bd

LM = dict(nose=0, lear=7, rear=8, lsh=11, rsh=12, lel=13, rel=14, lwr=15, rwr=16, lhip=23, rhip=24, lkn=25, rkn=26, lan=27, ran=28, lheel=29, rheel=30, ltoe=31, rtoe=32)
HEIGHT_UNITS = 25.0     # hauteur du personnage en unites "BVH" (comparable aux clips CMU)

def load_frames(npz):
    d = np.load(npz); W = d['world'].astype(np.float64); fps = float(d['fps']); n = len(W)
    I = d['img'].astype(np.float64)          # coordonnees image normalisees: seules elles voient les sauts (le monde est centre bassin)
    idx = np.arange(n)
    for j in range(33):
        for c in range(2):
            v = I[:, j, c]; m = ~np.isnan(v)
            if m.sum() > 2: I[:, j, c] = np.interp(idx, idx[m], v[m])
    for j in range(33):
        for c in range(3):
            v = W[:, j, c]; m = ~np.isnan(v)
            if m.sum() > 2: W[:, j, c] = np.interp(idx, idx[m], v[m])
    win = int(round(fps * 0.17)) | 1
    W = savgol_filter(W, win, 3, axis=0)
    # repere: x droite, y HAUT, z vers l'avant du monde (MediaPipe: y bas, z vers la camera)
    P = np.stack([W[..., 0], -W[..., 1], -W[..., 2]], axis=-1)
    # sol = pied le plus bas (mediane glissante) ; echelle -> hauteur standard
    sh = (P[:, LM['lsh']] + P[:, LM['rsh']]) / 2; hip = (P[:, LM['lhip']] + P[:, LM['rhip']]) / 2
    ground = np.minimum(P[:, LM['lan'], 1], P[:, LM['ran'], 1])
    head = (P[:, LM['lear']] + P[:, LM['rear']]) / 2 + np.array([0, 0.07, 0])
    height = np.median(head[:, 1] - ground)
    k = HEIGHT_UNITS / height
    # saut: mouvement vertical du bassin dans l'IMAGE (camera fixe), converti en metres via la longueur du tronc
    win_i = int(round(fps * 0.25)) | 1
    I = savgol_filter(I, win_i, 3, axis=0)
    hip_img = (I[:, LM['lhip'], 1] + I[:, LM['rhip'], 1]) / 2; sh_img = (I[:, LM['lsh'], 1] + I[:, LM['rsh'], 1]) / 2
    torso_img = np.median(np.abs(hip_img - sh_img)); torso_w = np.median(np.linalg.norm(sh - hip, axis=1))
    base = np.percentile(hip_img, 90)                    # position basse (pieds au sol, genoux flechis)
    hop = (base - hip_img) * (torso_w / torso_img)       # metres, positif vers le haut
    frames = []
    for i in range(n):
        f = {}
        g = lambda name: P[i, LM[name]] * k
        f['Hips'] = hip[i] * k; f['Neck'] = sh[i] * k; f['Head'] = head[i] * k
        f['LeftArm'], f['LeftForeArm'], f['LeftHand'] = g('lsh'), g('lel'), g('lwr')
        f['RightArm'], f['RightForeArm'], f['RightHand'] = g('rsh'), g('rel'), g('rwr')
        f['LeftUpLeg'], f['LeftLeg'], f['LeftFoot'] = g('lhip'), g('lkn'), g('lan')
        f['RightUpLeg'], f['RightLeg'], f['RightFoot'] = g('rhip'), g('rkn'), g('ran')
        # hauteur reelle du bassin au-dessus du sol (les landmarks sont centres bassin: on la reconstruit)
        hip_h = (-np.median(ground) + hop[i]) * k
        fv = bd.front_view(f)
        fv['_hipsW'] = np.array([0.0, hip_h, 0.0])
        frames.append(fv)
    return frames, fps

def features(seg):
    """signature d'un pas: hauteur des poignets / epaules, ecart des pieds, amplitude laterale, saut"""
    A = np.array([[(f['LeftHand'][1] + f['RightHand'][1]) / 2 - f['Neck'][1],
                   abs(f['LeftFoot'][0] - f['RightFoot'][0]),
                   (f['LeftFoot'][0] + f['RightFoot'][0]) / 2,
                   max(f['LeftFoot'][1], f['RightFoot'][1]) - min(f['LeftFoot'][1], f['RightFoot'][1]),
                   f['_hipsW'][1]] for f in seg])
    return np.array([A[:, 0].mean(), A[:, 1].mean(), A[:, 2].max() - A[:, 2].min(), A[:, 3].mean(), A[:, 4].max() - A[:, 4].min()])

def step_period(frames, fps):
    """periode du cycle de pas (alternance gauche/droite) par autocorrelation de la hauteur relative des pieds"""
    s = np.array([f['LeftFoot'][1] - f['RightFoot'][1] for f in frames]); s -= s.mean()
    n = len(s); ac = np.correlate(s, s, 'full')[n - 1:] / np.arange(n, 0, -1)
    lo, hi = int(0.6 * fps), int(2.5 * fps)
    T = lo + int(np.argmax(ac[lo:hi]))
    return T / fps

def scan(frames, fps, cycles=2, maxyaw=40, k=8, min_gap=6.0):
    """candidats de boucle (cycles pas complets), sans tour du corps, distincts entre eux"""
    T = step_period(frames, fps); L = int(round(cycles * T * fps))
    vecs = np.array([bd.pose_vec(f) for f in frames]); vel = np.linalg.norm(np.diff(vecs, axis=0), axis=1)
    yaws = np.degrees(np.unwrap([f['_yaw'][0] for f in frames]))
    cands = []
    for i in range(0, len(frames) - L - 2, 3):
        j = i + L
        if yaws[i:j].max() - yaws[i:j].min() > maxyaw: continue
        d = np.linalg.norm(vecs[i] - vecs[j]) + 2.0 * np.linalg.norm((vecs[i + 1] - vecs[i]) - (vecs[j + 1] - vecs[j]))
        e = vel[i:j].mean()
        cands.append((i, d, e, features(frames[i:j + 1])))
    if not cands: return T, L, []
    emax = max(c[2] for c in cands)
    cands = [c for c in cands if c[2] > 0.35 * emax]
    cands.sort(key=lambda c: c[1] / (c[2] + 1e-6))
    # normalisation des signatures pour la distance
    F = np.array([c[3] for c in cands]); sd = F.std(0) + 1e-6
    chosen = []
    for c in cands:
        if any(abs(c[0] - o[0]) < min_gap * fps for o in chosen): continue       # pas le meme passage de la video
        if any(np.linalg.norm((c[3] - o[3]) / sd) < 1.6 for o in chosen): continue  # pas le meme geste
        chosen.append(c)
        if len(chosen) >= k: break
    return T, L, chosen




def preview(npz, starts, tag, woman=False, n=10):
    frames, fps = load_frames(npz)
    T, L, _ = scan(frames, fps)
    from PIL import Image
    hts = [f['Head'][1] - min(f['LeftFoot'][1], f['RightFoot'][1]) for f in frames]
    scale_ref = float(np.median(hts)) * 1.12
    sheet = Image.new('RGBA', (150 * n, 190 * len(starts)), (40, 34, 48, 255))
    for r, t0 in enumerate(starts):
        i0 = int(t0 * fps)
        for c in range(n):
            fv = frames[i0 + int(c * L / n)]
            im = (bd.render_woman if woman else bd.render)(fv, scale_ref); im.thumbnail((190, 190))
            sheet.paste(im, (c * 150, r * 190), im)
    sheet.save(f'preview_{tag}.png'); print('preview', tag)


# ============================================================ export tempo-synchrone
import subprocess, shutil
from PIL import Image
OUT = Path('v21_sprites'); OUT.mkdir(exist_ok=True)
CANVAS, CONTENT_H = 160, 156

def make_loop(frames, fps, i0, L, blend=0.22):
    """boucle fermee: les derniers 22 % glissent vers la periode precedente, qui debouche exactement sur l'image 0"""
    seg = [dict(f) for f in frames[i0:i0 + L + 1]]
    nb = max(2, int(L * blend))
    for k in range(nb):
        i = L - nb + k; w = (k + 1) / nb; w = w * w * (3 - 2 * w)
        src = frames[i0 + i - L]
        for key in seg[i]:
            if key == '_yaw': continue
            seg[i][key] = seg[i][key] * (1 - w) + src[key] * w
    seg[L] = dict(frames[i0])
    return seg

def retime(seg, n_out):
    L = len(seg) - 1; idx = np.linspace(0, L, n_out, endpoint=False); out = []
    for n, fi in enumerate(idx):
        a, b = int(math.floor(fi)), min(int(math.floor(fi)) + 1, L); t = fi - a
        fv = {k: seg[a][k] * (1 - t) + seg[b][k] * t for k in seg[a] if k != '_n'}
        fv['_n'] = np.array([n, n_out, 0.0]); out.append(fv)
    return out

def scarf(seg, fps, height):
    hi = sum(1 for f in seg if f['LeftHand'][1] > f['RightHand'][1])
    hand = 'LeftHand' if hi > len(seg) / 2 else 'RightHand'
    bd.SRC_FPS = fps
    return bd.simulate_scarf(seg, len(seg) - 1, hand, height, cycles=4)

def render_sprite(frames_out, name, woman, hanky):
    """rend les images, normalise sur le corps (meme taille pour tous), ecrit <name>.webp dans v21_sprites/"""
    d = OUT / f'frames_{name}'; d.mkdir(exist_ok=True)
    for f in d.iterdir(): f.unlink()
    hts = [f['Head'][1] - min(f['LeftFoot'][1], f['RightFoot'][1]) for f in frames_out]
    scale_ref = float(np.median(hts)) * 1.12
    ims, boxes = [], []
    for n, fv in enumerate(frames_out):
        if woman:
            bd.HANKY = False
            body = bd.render_woman(fv, scale_ref)
            bd.HANKY = hanky
            im = bd.render_woman(fv, scale_ref) if hanky else body
        else:
            im = bd.render(fv, scale_ref); body = im
        boxes.append(body.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()); ims.append(im)
    l = min(b[0] for b in boxes); t = min(b[1] for b in boxes); r = max(b[2] for b in boxes); btm = max(b[3] for b in boxes)
    ext = int(0.28 * (r - l)); W0 = ims[0].size[0]
    l, r = max(0, l - ext), min(W0, r + ext)
    scale = CONTENT_H / (btm - t); nw = max(1, round((r - l) * scale))
    for i, im in enumerate(ims):
        crop = im.crop((l, t, r, btm)).resize((nw, CONTENT_H), Image.LANCZOS)
        out = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0)); out.paste(crop, ((CANVAS - nw) // 2, CANVAS - CONTENT_H), crop)
        out.save(d / f'n{i:03d}.png')
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-framerate', '25', '-i', str(d / 'n%03d.png'), '-c:v', 'libwebp_anim', '-q:v', '62', '-loop', '0', '-an', '-vsync', '0', str(OUT / f'{name}.webp')], check=True)
    sel = ims[:: max(1, len(ims) // 12)][:12]
    sheet = Image.new('RGBA', (150 * len(sel), 190), (40, 34, 48, 255))
    for i, im in enumerate(sel):
        tmb = im.copy(); tmb.thumbnail((190, 190)); sheet.paste(tmb, (i * 150, 0), tmb)
    sheet.save(OUT / f'sheet_{name}.png')
    shutil.rmtree(d)
    print(f'{name}.webp: {len(ims)} images, {(OUT / (name + ".webp")).stat().st_size} o', flush=True)

def n_frames(bpm, beats): return int(round(25 * beats * 60 / bpm))

def export_variant(seg, fps, ident, bpms, woman, hanky, beats=4):
    height = float(np.median([f['Head'][1] - min(f['LeftFoot'][1], f['RightFoot'][1]) for f in seg]))
    if woman and hanky: seg = scarf(seg, fps, height)
    for bpm in bpms:
        render_sprite(retime(seg, n_frames(bpm, beats)), f'{ident}@{bpm}', woman, hanky)

def make_medley(loops, fps, beats_each=8, xfade=0.45):
    """enchainement continu: chaque pas repete sur 8 temps, fondu de pose de 0,45 s a chaque jonction, boucle globale"""
    parts = []
    for s in loops:
        body = s[:-1]; parts.append(body * (beats_each // 4))
    total = sum(len(p) for p in parts); out = []
    for p in parts: out.extend([dict(f) for f in p])
    nx = int(xfade * fps); J = 0
    for k, p in enumerate(parts):
        prev = parts[k - 1]; Lp = len(loops[k - 1]) - 1
        for m in range(nx):
            w = (m + 1) / (nx + 1); w = w * w * (3 - 2 * w)
            a = prev[(len(prev) + m) % Lp]; b = p[m]
            tgt = out[(J + m) % total]
            for key in tgt:
                if key == '_yaw': continue
                tgt[key] = a[key] * (1 - w) + b[key] * w
        J += len(p)
    out.append(dict(out[0]))
    return out

def export_medley(loops, fps, ident, bpms, woman, hanky, beats_each=8):
    med = make_medley(loops, fps, beats_each)
    height = float(np.median([f['Head'][1] - min(f['LeftFoot'][1], f['RightFoot'][1]) for f in med]))
    if woman and hanky: med = scarf(med, fps, height)
    for bpm in bpms:
        render_sprite(retime(med, n_frames(bpm, beats_each * len(loops))), f'{ident}@{bpm}', woman, hanky)

# ------------------------------------------------------------ catalogue des pas (source video, debut en s)
STEPS = [  # (ident homme, ident femme, source, debut s, nom)
    ('m14', 'w8',  'pose_training.npz', 131.5, 'f - pizzica: braccia al cielo'),
    ('m15', 'w9',  'pose_training.npz',  90.3, 'g - pizzica: passo laterale'),
    ('m16', 'w10', 'pose_training.npz', 165.9, 'h - pizzica: mani ai fianchi'),
    ('m17', 'w11', 'pose_training.npz',  45.7, 'i - pizzica: fianchi e piede alzato'),
    ('m18', 'w12', 'pose_basic.npz',     26.0, 'j - pizzica: braccia alte, spostamento'),
    ('m19', 'w13', 'pose_basic.npz',     32.9, 'k - pizzica: saltello puntato'),
]
MEDLEY = ('m20', 'w14', 'l - pizzica: MEDLEY di tutti i passi (continuo)')
BPMS = (96, 99)

def export_all(woman):
    cache = {}; loops = []
    for mid, wid, src, t0, name in STEPS:
        if src not in cache:
            fr, fps = load_frames(src); T, L, _ = scan(fr, fps); cache[src] = (fr, fps, L)
        fr, fps, L = cache[src]
        seg = make_loop(fr, fps, int(t0 * fps), L)
        loops.append(seg)
        export_variant([dict(f) for f in seg], fps, wid if woman else mid, BPMS, woman, woman)
    export_medley(loops, cache[STEPS[0][2]][1], MEDLEY[1] if woman else MEDLEY[0], BPMS, woman, woman)


if __name__ == '__main__':
    if sys.argv[1:] and sys.argv[1] in ('--man', '--woman'):
        if len(sys.argv) > 3 and sys.argv[2] == '--bpms': BPMS = tuple(int(x) for x in sys.argv[3].split(','))
        export_all(sys.argv[1] == '--woman'); sys.exit(0)
    for a in sys.argv[1:]:
        frames, fps = load_frames(a)
        T, L, ch = scan(frames, fps)
        print(f'{a}: {len(frames)} images @ {fps:.1f}, cycle de pas {T:.2f} s -> boucle {L} images ({L / fps:.2f} s)')
        print('  debut(s) | fermeture | energie | bras(+haut) | ecart pieds | ampl.lat | pied leve | saut')
        for i, d, e, f in ch:
            print(f'  {i / fps:7.1f} | {d:6.2f} | {e:5.2f} | {f[0]:+5.1f} | {f[1]:5.1f} | {f[2]:5.1f} | {f[3]:5.1f} | {f[4]:4.1f}')
