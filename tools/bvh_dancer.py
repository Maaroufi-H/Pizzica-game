# Danseur pilote par de la VRAIE capture de mouvement (CMU Mocap, BVH):
#  1. parse BVH + cinematique directe -> positions 3D des articulations
#  2. vue de face stable (le bassin est re-oriente face camera a chaque image)
#  3. recherche automatique d'une BOUCLE de ~1.6 s (pose de fin ~ pose de debut)
#  4. rendu dans le style du jeu (chemise, gilet, fascia, vraies mains),
#     ordre de dessin par profondeur, pieds normalises au sol.
import math, sys, re
import numpy as np
from pathlib import Path
from PIL import Image, ImageDraw

BASE = Path(__file__).resolve().parent
SS = 3
W = H = 420 * SS
N_OUT = 40
LOOP_SEC = 1.6
HANKY = False
MAX_YAW = None         # degres: rotation max du bassin admise dans une boucle (evite les tours qui, vus de face, semblent frenetiques)          # mouchoir blanc dans la main droite de la danseuse (pizzica)

SKIN = (238, 190, 150); SKIN_D = (206, 156, 118); HAIR = (46, 30, 22)
SHIRT = (252, 250, 245); SHIRT_SH = (226, 222, 212)
VEST = (34, 40, 56); VEST_D = (24, 29, 42)
SASH = (176, 42, 36); PANTS = (26, 28, 36); PANTS_D = (18, 20, 26)
SHOE = (16, 16, 18); LINE = (28, 24, 22)
OUTL = 2.0 * SS


# ------------------------------------------------------------ BVH
class Joint:
    def __init__(self, name, parent):
        self.name, self.parent, self.offset, self.channels, self.children = name, parent, np.zeros(3), [], []


def parse_bvh(path):
    txt = Path(path).read_text(encoding='utf-8', errors='replace')
    hier, motion = txt.split('MOTION')
    tokens = hier.replace('{', ' { ').replace('}', ' } ').split()
    joints, stack, root = [], [], None
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t in ('ROOT', 'JOINT'):
            j = Joint(tokens[i + 1], stack[-1] if stack else None)
            if stack: stack[-1].children.append(j)
            else: root = j
            joints.append(j); i += 2
        elif t == 'End':
            j = Joint(stack[-1].name + '_End', stack[-1]); stack[-1].children.append(j); joints.append(j); i += 2
        elif t == '{':
            stack.append(joints[-1]); i += 1
        elif t == '}':
            stack.pop(); i += 1
        elif t == 'OFFSET':
            stack[-1].offset = np.array([float(tokens[i + 1]), float(tokens[i + 2]), float(tokens[i + 3])]); i += 4
        elif t == 'CHANNELS':
            n = int(tokens[i + 1]); stack[-1].channels = tokens[i + 2:i + 2 + n]; i += 2 + n
        else:
            i += 1
    m = motion.split()
    nfr = int(m[m.index('Frames:') + 1]); ft = float(m[m.index('Time:') + 1])
    vals = np.array(m[m.index('Time:') + 2:], dtype=float)
    nch = sum(len(j.channels) for j in joints)
    frames = vals[:nfr * nch].reshape(nfr, nch)
    return root, joints, frames, ft


def rot(axis, deg):
    a = math.radians(deg); c, s = math.cos(a), math.sin(a)
    if axis == 'X': return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    if axis == 'Y': return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def fk(root, joints, frame):
    """positions monde de toutes les articulations pour une image"""
    pos, ch = {}, 0
    def rec(j, ppos, prot):
        nonlocal ch
        vals = frame[ch:ch + len(j.channels)]; ch += len(j.channels)
        tr = np.zeros(3); R = np.eye(3)
        for c, v in zip(j.channels, vals):
            if c.endswith('position'): tr['XYZ'.index(c[0])] = v
            else: R = R @ rot(c[0], v)
        p = ppos + prot @ (j.offset + tr)
        Rw = prot @ R
        pos[j.name] = p
        for k in j.children: rec(k, p, Rw)
    rec(root, np.zeros(3), np.eye(3))
    return pos


# ------------------------------------------------------------ vue de face + boucle
def front_view(pos):
    """re-oriente le bassin face camera; retourne dict name -> (x, y, z) avec y vers le HAUT"""
    L, R = pos['LeftUpLeg'], pos['RightUpLeg']
    lat = R - L; lat[1] = 0
    ang = math.atan2(lat[2], lat[0])              # angle de l'axe lateral dans le plan XZ
    c, s = math.cos(-ang), math.sin(-ang)
    Ry = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    hip = pos['Hips']
    out = {k: Ry @ (v - hip) for k, v in pos.items()}
    out['_yaw'] = np.array([ang, 0.0, 0.0])
    out['_hipsW'] = np.array([0.0, hip[1], 0.0])   # hauteur reelle du bassin (sauts) pour la physique du foulard
    return out


KEYS = ['Hips', 'Head', 'Neck', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
        'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot']


def pose_vec(fv):
    return np.concatenate([fv[k] for k in KEYS])


def find_loop(frames_fv, fps, sec=LOOP_SEC):
    n = len(frames_fv); L = int(round(sec * fps))
    vecs = np.array([pose_vec(f) for f in frames_fv])
    vel = np.linalg.norm(np.diff(vecs, axis=0), axis=1)
    yaws = np.degrees(np.unwrap([f['_yaw'][0] for f in frames_fv])) if '_yaw' in frames_fv[0] else None
    cands = []
    for i in range(0, n - L - 1, 4):
        j = i + L
        if MAX_YAW is not None and yaws[i:j].max() - yaws[i:j].min() > MAX_YAW: continue
        d = np.linalg.norm(vecs[i] - vecs[j]) + 2.0 * np.linalg.norm((vecs[i + 1] - vecs[i]) - (vecs[j + 1] - vecs[j]))
        cands.append((i, d, vel[i:j].mean()))
    if not cands: raise SystemExit('aucune fenetre sans tour: augmenter --maxyaw')
    emax = max(c[2] for c in cands)
    if MAX_YAW is not None:
        cands = [c for c in cands if c[2] >= 0.55 * emax]   # pas de pose quasi statique (sinon: score historique)
    best = min(cands, key=lambda c: c[1] / (c[2] + 1e-6))
    if yaws is not None:
        print(f'   fenetre {best[0]}: rotation bassin {yaws[best[0]:best[0] + L].max() - yaws[best[0]:best[0] + L].min():.0f} deg, energie {best[2]:.2f} (max {emax:.2f})')
    return best[0], L


# ------------------------------------------------------------ rendu
def limb(d, pts, width, color):
    d.line(pts, fill=LINE, width=int(width + OUTL), joint='curve')
    for p in pts:
        r = (width + OUTL) / 2; d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=LINE)
    d.line(pts, fill=color, width=int(width), joint='curve')
    for p in pts:
        r = width / 2; d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=color)


def hand(d, wrist, ang, u, sgn):
    ux, uy = math.cos(ang), math.sin(ang); nx, ny = -uy, ux
    pl, pw = 5.2 * u, 4.2 * u
    c = (wrist[0] + ux * pl * 0.55, wrist[1] + uy * pl * 0.55)
    palm = [(c[0] + ux * a * pl / 2 + nx * b * pw / 2, c[1] + uy * a * pl / 2 + ny * b * pw / 2) for a, b in ((-1, 1), (1, 1), (1, -1), (-1, -1))]
    d.polygon(palm, fill=SKIN, outline=LINE)
    tip = (c[0] + ux * pl / 2, c[1] + uy * pl / 2)
    for k in range(4):
        off = (k - 1.5) * pw / 3.6; sp = (k - 1.5) * 0.10
        fx, fy = math.cos(ang + sp), math.sin(ang + sp)
        p0 = (tip[0] + nx * off, tip[1] + ny * off); p1 = (p0[0] + fx * 4.2 * u, p0[1] + fy * 4.2 * u)
        d.line([p0, p1], fill=LINE, width=int(2.4 * u)); d.line([p0, p1], fill=SKIN, width=int(1.4 * u))
    ts = -sgn
    t0 = (c[0] - ux * pl * 0.1 + nx * pw / 2 * ts, c[1] - uy * pl * 0.1 + ny * pw / 2 * ts)
    t1 = (t0[0] + (ux * 0.5 + nx * ts * 0.9) * 3.4 * u, t0[1] + (uy * 0.5 + ny * ts * 0.9) * 3.4 * u)
    d.line([t0, t1], fill=LINE, width=int(2.6 * u)); d.line([t0, t1], fill=SKIN, width=int(1.6 * u))


def shoe(d, ankle, sgn, u):
    L, hgt = 15.0 * u, 6.2 * u
    x0 = ankle[0] - (4.5 * u if sgn > 0 else L - 4.5 * u)
    d.rounded_rectangle([x0, ankle[1] - hgt, x0 + L, ankle[1]], radius=2.6 * u, fill=SHOE, outline=LINE, width=int(OUTL))


def render(fv, scale_ref):
    """fv: dict -> (x,y,z) vue de face, y vers le haut, unites BVH"""
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    CH = H * 0.86; ground = H * 0.955; cx = W * 0.5
    # echelle: hauteur totale (pieds->tete) de reference -> 100 unites
    u = CH / 100.0
    k = 100.0 / scale_ref                            # unites BVH -> % hauteur
    feet_y = min(fv['LeftFoot'][1], fv['RightFoot'][1])
    def P(name, dy=0.0):
        v = fv[name]
        return (cx + v[0] * k * u, ground - (v[1] - feet_y) * k * u - dy * u)
    def Z(name): return fv[name][2]

    hips = P('Hips'); neck = P('Neck'); head = P('Head')
    lsh, lel, lwr = P('LeftArm'), P('LeftForeArm'), P('LeftHand')
    rsh, rel, rwr = P('RightArm'), P('RightForeArm'), P('RightHand')
    lhip, lkn, lan = P('LeftUpLeg'), P('LeftLeg'), P('LeftFoot')
    rhip, rkn, ran = P('RightUpLeg'), P('RightLeg'), P('RightFoot')
    # a l'ecran, la gauche du danseur (LeftArm) est a DROITE (vue de face) -> sgn
    sgnL = 1 if lsh[0] > rsh[0] else -1

    # ordre de profondeur: membres les plus loin d'abord (z plus petit = plus loin? camera regarde -z)
    parts = []
    parts.append((Z('LeftLeg'), 'legL')); parts.append((Z('RightLeg'), 'legR'))
    parts.append((0.0, 'body')); parts.append((Z('LeftForeArm'), 'armL')); parts.append((Z('RightForeArm'), 'armR'))
    parts.sort(key=lambda t: t[0])                    # loin -> proche

    def draw_leg(hp, kn, an, sgn, col):
        an2 = (an[0], an[1] - 4.6 * u)
        limb(d, [hp, kn, an2], 9.4 * u, col); shoe(d, an, sgn, u)

    def draw_arm(sh, el, wr, sgn):
        limb(d, [sh, el, wr], 5.4 * u, SKIN)
        mid = ((sh[0] + el[0]) / 2, (sh[1] + el[1]) / 2)
        limb(d, [sh, mid], 7.4 * u, SHIRT)
        d.ellipse([mid[0] - 3.6 * u, mid[1] - 3.6 * u, mid[0] + 3.6 * u, mid[1] + 3.6 * u], fill=SHIRT_SH, outline=LINE, width=int(OUTL * 0.7))
        hand(d, wr, math.atan2(wr[1] - el[1], wr[0] - el[0]), u, sgn)

    def draw_body():
        # bassin/fascia
        hl = (min(lhip[0], rhip[0]) - 4 * u, hips[1] - 2 * u); hr = (max(lhip[0], rhip[0]) + 4 * u, hips[1] - 2 * u)
        d.polygon([(hl[0], hips[1] - 7 * u), (hr[0], hips[1] - 7 * u), (hr[0] - 1 * u, hips[1] + 3 * u), (hl[0] + 1 * u, hips[1] + 3 * u)], fill=SASH, outline=LINE)
        # chemise: epaules -> hanches
        sl = (min(lsh[0], rsh[0]) - 2.5 * u, min(lsh[1], rsh[1]) + 1 * u); sr = (max(lsh[0], rsh[0]) + 2.5 * u, sl[1])
        sl = (sl[0], lsh[1] if lsh[0] < rsh[0] else rsh[1]); sr = (sr[0], rsh[1] if lsh[0] < rsh[0] else lsh[1])
        d.polygon([sl, sr, (hr[0], hips[1] - 6 * u), (hl[0], hips[1] - 6 * u)], fill=SHIRT, outline=LINE)
        # gilet: deux pans
        midx = (sl[0] + sr[0]) / 2
        d.polygon([sl, (midx - 4 * u, sl[1] + 3 * u), (hl[0] + (hr[0] - hl[0]) * 0.28, hips[1] - 6 * u), (hl[0], hips[1] - 6 * u)], fill=VEST_D, outline=LINE)
        d.polygon([sr, (midx + 4 * u, sr[1] + 3 * u), (hl[0] + (hr[0] - hl[0]) * 0.72, hips[1] - 6 * u), (hr[0], hips[1] - 6 * u)], fill=VEST, outline=LINE)
        d.ellipse([hr[0] - 3 * u, hips[1] - 6 * u, hr[0] + 3 * u, hips[1] + 1 * u], fill=SASH, outline=LINE, width=int(OUTL))
        # cou + col + tete
        d.polygon([(neck[0] - 3.4 * u, neck[1] + 3.5 * u), (neck[0] + 3.4 * u, neck[1] + 3.5 * u), (head[0] + 2.8 * u, head[1] + 2 * u), (head[0] - 2.8 * u, head[1] + 2 * u)], fill=SKIN_D)
        d.arc([neck[0] - 6.5 * u, neck[1] - 1.5 * u, neck[0] + 6.5 * u, neck[1] + 7 * u], start=200, end=340, fill=LINE, width=int(OUTL))
        r = 9.6 * u; hc = (head[0], head[1] - 3.5 * u)
        tilt = math.degrees(math.atan2(head[0] - neck[0], neck[1] - head[1]))
        d.ellipse([hc[0] + r * 0.82 - 1.6 * u, hc[1] - 0.5 * u, hc[0] + r * 0.82 + 1.6 * u, hc[1] + 3.4 * u], fill=SKIN_D)
        d.ellipse([hc[0] - r, hc[1] - r, hc[0] + r, hc[1] + r], fill=SKIN)
        d.pieslice([hc[0] - r * 1.03, hc[1] - r * 1.08, hc[0] + r * 1.03, hc[1] + r * 0.30], start=180 + tilt, end=360 + tilt, fill=HAIR)
        d.ellipse([hc[0] - r, hc[1] - r * 0.35, hc[0] - r * 0.62, hc[1] + r * 0.35], fill=HAIR)
        for ex in (-0.36 * r, 0.32 * r):
            d.ellipse([hc[0] + ex - 0.085 * r, hc[1] + 0.02 * r, hc[0] + ex + 0.085 * r, hc[1] + 0.20 * r], fill=LINE)
        d.arc([hc[0] - 0.40 * r, hc[1] + 0.20 * r, hc[0] + 0.40 * r, hc[1] + 0.66 * r], start=20, end=160, fill=LINE, width=int(OUTL))

    for _, part in parts:
        if part == 'legL': draw_leg(lhip, lkn, lan, sgnL, PANTS_D)
        elif part == 'legR': draw_leg(rhip, rkn, ran, -sgnL, PANTS)
        elif part == 'body': draw_body()
        elif part == 'armL': draw_arm(lsh, lel, lwr, sgnL)
        elif part == 'armR': draw_arm(rsh, rel, rwr, -sgnL)
    return img.resize((W // SS, H // SS), Image.LANCZOS)


# ------------------------------------------------------------ modele feminin
W_SKIN = (250, 192, 96); W_SKIN_D = (222, 160, 70); W_HAIR = (74, 44, 26)
DRESS = (222, 40, 44); DRESS_D = (168, 22, 32); HEEL = (150, 16, 28)


def render_woman(fv, scale_ref):
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    CH = H * 0.86; ground = H * 0.955; cx = W * 0.5
    u = CH / 100.0
    k = 100.0 / scale_ref
    feet_y = min(fv['LeftFoot'][1], fv['RightFoot'][1])
    def P(name):
        v = fv[name]
        return (cx + v[0] * k * u, ground - (v[1] - feet_y) * k * u)
    def Z(name): return fv[name][2]
    hips = P('Hips'); neck = P('Neck'); head = P('Head')
    lsh, lel, lwr = P('LeftArm'), P('LeftForeArm'), P('LeftHand')
    rsh, rel, rwr = P('RightArm'), P('RightForeArm'), P('RightHand')
    lhip, lkn, lan = P('LeftUpLeg'), P('LeftLeg'), P('LeftFoot')
    rhip, rkn, ran = P('RightUpLeg'), P('RightLeg'), P('RightFoot')
    sgnL = 1 if lsh[0] > rsh[0] else -1
    parts = [(-1e9 + Z('LeftLeg'), 'legL'), (-1e9 + Z('RightLeg'), 'legR'), (0.0, 'body'), (Z('LeftForeArm'), 'armL'), (Z('RightForeArm'), 'armR')]
    parts.sort(key=lambda t: t[0])

    def leg(hp, kn, an, sgn):
        an2 = (an[0], an[1] - 3.0 * u)
        limb(d, [hp, kn, an2], 6.2 * u, W_SKIN)
        # escarpin rouge a talon, horizontal vers l'exterieur
        L, hgt = 12.5 * u, 4.6 * u
        x0 = an[0] - (3.5 * u if sgn > 0 else L - 3.5 * u)
        d.rounded_rectangle([x0, an[1] - hgt, x0 + L, an[1]], radius=2.2 * u, fill=HEEL, outline=LINE, width=int(OUTL))
        hx = x0 + (1.5 * u if sgn > 0 else L - 3.5 * u)
        d.rectangle([hx, an[1] - 1.5 * u, hx + 2 * u, an[1] + 2.5 * u], fill=HEEL, outline=LINE)

    def arm(sh, el, wr, sgn):
        limb(d, [sh, el, wr], 4.6 * u, W_SKIN)
        hand(d, wr, math.atan2(wr[1] - el[1], wr[0] - el[0]), u, sgn)

    def body():
        # robe: buste (epaules->taille) + jupe evasee jusqu'aux genoux, qui suit les jambes
        sl = (min(lsh[0], rsh[0]) - 1.5 * u, (lsh[1] + rsh[1]) / 2 + 1.5 * u)
        sr = (max(lsh[0], rsh[0]) + 1.5 * u, sl[1])
        waist_l = (hips[0] - 7.5 * u, hips[1] - 4 * u); waist_r = (hips[0] + 7.5 * u, hips[1] - 4 * u)
        kl, kr = (min(lkn[0], rkn[0]), max(lkn[0], rkn[0]))
        hem_y = max(lkn[1], rkn[1]) + 2 * u
        flare = 12 * u + abs(kr - kl) * 0.35
        hem = [(kl - flare, hem_y), (kl - flare * 0.35, hem_y + 3 * u), ((kl + kr) / 2, hem_y + 1 * u),
               (kr + flare * 0.35, hem_y + 3 * u), (kr + flare, hem_y)]
        d.polygon([waist_l] + hem + [waist_r], fill=DRESS, outline=LINE)
        # volant
        d.line(hem, fill=DRESS_D, width=int(3 * u), joint='curve')
        d.polygon([sl, sr, waist_r, waist_l], fill=DRESS, outline=LINE)
        d.line([((sl[0] + sr[0]) / 2, sl[1]), (hips[0], hips[1] - 4 * u)], fill=DRESS_D, width=int(1.5 * u))
        # decollete
        d.polygon([(sl[0] + 3 * u, sl[1]), (sr[0] - 3 * u, sl[1]), ((sl[0] + sr[0]) / 2, sl[1] + 5 * u)], fill=W_SKIN, outline=LINE)
        # cou, tete, cheveux longs qui suivent l'inclinaison
        d.polygon([(neck[0] - 3.0 * u, neck[1] + 3 * u), (neck[0] + 3.0 * u, neck[1] + 3 * u), (head[0] + 2.5 * u, head[1] + 2 * u), (head[0] - 2.5 * u, head[1] + 2 * u)], fill=W_SKIN_D)
        r = 9.2 * u; hc = (head[0], head[1] - 3.5 * u)
        tilt = math.atan2(head[0] - neck[0], neck[1] - head[1])
        # cheveux derriere
        for sgn in (-1, 1):
            hx = hc[0] + sgn * r * 0.75 - math.sin(tilt) * 4 * u
            d.polygon([(hc[0] + sgn * r * 0.4, hc[1] - r * 0.9), (hx + sgn * 3 * u, hc[1] + r * 0.4), (hx + sgn * 5 * u, hc[1] + r * 2.4), (hx - sgn * 2 * u, hc[1] + r * 2.6), (hc[0] + sgn * r * 0.2, hc[1] + r * 0.6)], fill=W_HAIR, outline=LINE)
        d.ellipse([hc[0] - r, hc[1] - r, hc[0] + r, hc[1] + r], fill=W_SKIN, outline=LINE, width=int(OUTL * 0.6))
        td = math.degrees(tilt)
        d.pieslice([hc[0] - r * 1.04, hc[1] - r * 1.08, hc[0] + r * 1.04, hc[1] + r * 0.2], start=185 + td, end=355 + td, fill=W_HAIR)
        # fleur rouge
        fx, fy = hc[0] + r * 0.72, hc[1] - r * 0.55
        d.ellipse([fx - 3 * u, fy - 3 * u, fx + 3 * u, fy + 3 * u], fill=DRESS, outline=LINE)
        for ex in (-0.34 * r, 0.30 * r):
            d.ellipse([hc[0] + ex - 0.09 * r, hc[1] + 0.02 * r, hc[0] + ex + 0.09 * r, hc[1] + 0.22 * r], fill=LINE)
        d.arc([hc[0] - 0.36 * r, hc[1] + 0.22 * r, hc[0] + 0.36 * r, hc[1] + 0.64 * r], start=20, end=160, fill=(160, 30, 40), width=int(OUTL))

    for _, part in parts:
        if part == 'legL': leg(lhip, lkn, lan, sgnL)
        elif part == 'legR': leg(rhip, rkn, ran, -sgnL)
        elif part == 'body': body()
        elif part == 'armL': arm(lsh, lel, lwr, sgnL)
        elif part == 'armR': arm(rsh, rel, rwr, -sgnL)
    if HANKY and '_scarf' in fv:
        # foulard simule (corde de Verlet): ruban souple qui suit la chaine de points
        pr = lambda v: (cx + v[0] * k * u, ground - (v[1] - feet_y) * k * u)
        chain = [pr(v) for v in fv['_scarf']]
        nn = fv.get('_n', np.array([0, 40, 0])); tw = 2 * math.pi * 3 * nn[0] / max(1, nn[1])
        n = len(chain); left, right = [], []
        for j, c in enumerate(chain):
            a = chain[max(j - 1, 0)]; b = chain[min(j + 1, n - 1)]
            tx, ty = b[0] - a[0], b[1] - a[1]; nrm = math.hypot(tx, ty) or 1.0
            px, py = -ty / nrm, tx / nrm
            t = j / (n - 1)
            hw = 3.5 * u * (1 - 0.30 * t) * (0.80 + 0.20 * math.cos(2.4 * math.pi * t + tw))   # legere torsion de la soie
            if j == 0: hw = 1.2 * u
            left.append((c[0] + px * hw, c[1] + py * hw)); right.append((c[0] - px * hw, c[1] - py * hw))
        for j in range(n - 1):
            d.polygon([left[j], left[j + 1], right[j + 1], right[j]], fill=(250, 248, 240))
        d.line(chain, fill=(222, 216, 200), width=int(1.0 * u), joint='curve')      # pli central
        d.line(left, fill=(200, 30, 40), width=int(1.1 * u), joint='curve')          # bords rouges
        d.line(right, fill=(200, 30, 40), width=int(1.1 * u), joint='curve')
        wr0 = chain[0]
        d.ellipse([wr0[0] - 2.6 * u, wr0[1] - 2.6 * u, wr0[0] + 2.6 * u, wr0[1] + 2.6 * u], fill=(250, 248, 240), outline=LINE)
    elif HANKY:
        # foulard long: tenu dans la main la plus haute, il flotte a l'oppose du mouvement de la main
        left_hi = lwr[1] < rwr[1]
        wr = lwr if left_hi else rwr
        v = fv.get('_vL' if left_hi else '_vR', np.zeros(3)); nn = fv.get('_n', np.array([0, 40, 0]))
        vx, vy = v[0] * k * u, -v[1] * k * u                      # px par image source
        speed = math.hypot(vx, vy)
        wgt = min(3.0, speed / (0.30 * u))
        dx, dy = 0.0, 1.0                                           # gravite
        if speed > 1e-6: dx, dy = dx - wgt * vx / speed, dy - wgt * vy / speed
        nrm = math.hypot(dx, dy); dx, dy = dx / nrm, dy / nrm
        px, py = -dy, dx
        Lsc = 36 * u; phase = 2 * math.pi * 2 * nn[0] / max(1, nn[1])
        left, right = [], []
        for si in range(14):
            t = si / 13
            amp = 5.0 * u * t
            off = amp * math.sin(2 * math.pi * 1.3 * t - phase)
            cxp, cyp = wr[0] + dx * t * Lsc + px * off, wr[1] + dy * t * Lsc + py * off
            hw = 3.4 * u * (1 - 0.3 * t) if t > 0.05 else 1.2 * u
            left.append((cxp + px * hw, cyp + py * hw)); right.append((cxp - px * hw, cyp - py * hw))
        d.polygon(left + right[::-1], fill=(250, 248, 240), outline=LINE)
        d.line(left, fill=(200, 30, 40), width=int(1.6 * u))         # bordo rosso
        d.line(right, fill=(200, 30, 40), width=int(1.6 * u))
        d.ellipse([wr[0] - 2.6 * u, wr[1] - 2.6 * u, wr[0] + 2.6 * u, wr[1] + 2.6 * u], fill=(250, 248, 240), outline=LINE)
    return img.resize((W // SS, H // SS), Image.LANCZOS)


MODE = 'man'


UPPER = ['Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
         'LowerBack', 'Spine', 'Spine1', 'Neck1']


SRC_FPS = 120.0


def load_loop(path):
    global SRC_FPS
    root, joints, frames, ft = parse_bvh(path)
    fps = 1.0 / ft; SRC_FPS = fps
    fvs = [front_view(fk(root, joints, f)) for f in frames]
    start, L = find_loop(fvs, fps)
    seg = fvs[start:start + L + 1]
    print(f'   {Path(path).name}: boucle {start}..{start + L} ({L / fps:.2f}s) sur {len(frames)} images')
    return seg, L


def compose(seg_legs, seg_upper):
    """jambes/bassin du clip A, buste/bras du clip B (recale a la hauteur de A);
    la position de la tete de B suit le bassin de A (rebond des saltelli)"""
    hA = np.median([f['Head'][1] - min(f['LeftFoot'][1], f['RightFoot'][1]) for f in seg_legs])
    hB = np.median([f['Head'][1] - min(f['LeftFoot'][1], f['RightFoot'][1]) for f in seg_upper])
    k = hA / hB
    out = []
    n = min(len(seg_legs), len(seg_upper))
    for i in range(n):
        a, b = seg_legs[i], seg_upper[int(i * (len(seg_upper) - 1) / max(1, n - 1))]
        f = dict(a)
        for key in UPPER:
            if key in b:
                f[key] = b[key] * k
        out.append(f)
    return out


def simulate_scarf(seg, L, hand, height, n_pts=20, length_ratio=0.58, cycles=6):
    """Foulard = corde de n_pts points (Verlet): gravite, trainee de l'air, contraintes
    de longueur, flottement periodique. Le point 0 est cloue a la main. On simule
    plusieurs boucles de suite et on garde la derniere (regime periodique) -> boucle sans couture."""
    fps = SRC_FPS; sub = 2; h = 1.0 / (fps * sub)
    seglen = length_ratio * height / (n_pts - 1)
    g = 9.81 * height / 1.7 * 0.45          # soie legere: chute freinee par l'air
    damp = 0.972                             # trainee tangentielle: freine le ruban qui depasse la main au demi-tour
    drag_n = 0.55                            # trainee normale: le ruban resiste au deplacement perpendiculaire -> il file dans le sillage
    def anchor(i):
        f = seg[i % L]
        return f[hand] + f.get('_hipsW', np.zeros(3))
    a0 = anchor(0)
    pts = np.array([a0 - np.array([0.0, seglen * j, 0.0]) for j in range(n_pts)]); prev = pts.copy()
    out = [None] * L; prev_cycle = [None] * L; start_state = None
    for c in range(cycles):
        if c == cycles - 1: start_state = pts.copy()
        for i in range(L):
            for sidx in range(sub):
                t = i + (sidx + 1) / sub; i0 = int(t) % L; f = t - int(t)
                an = anchor(i0) * (1 - f) + anchor(i0 + 1) * f
                acc = np.zeros_like(pts); acc[:, 1] -= g
                phase = 2 * math.pi * 10 * (i * sub + sidx) / (L * sub)     # 10 battements par boucle
                for j in range(1, n_pts):
                    tang = pts[j] - pts[j - 1]; nrm = np.linalg.norm(tang)
                    if nrm < 1e-9: continue
                    perp = np.array([-tang[1], tang[0], 0.0]) / nrm
                    acc[j] += perp * g * 0.15 * math.sin(phase - j * 0.8) * (j / n_pts)
                vel = (pts - prev) * damp
                for j in range(1, n_pts):
                    tang = pts[j] - pts[j - 1]; nrm = np.linalg.norm(tang)
                    if nrm < 1e-9: continue
                    perp = np.array([-tang[1], tang[0], 0.0]) / nrm
                    vel[j] -= drag_n * np.dot(vel[j], perp) * perp
                prev = pts
                pts = pts + vel + acc * h * h
                pts[0] = an
                for _ in range(10):
                    for j in range(1, n_pts):
                        d = pts[j] - pts[j - 1]; dist = np.linalg.norm(d)
                        if dist < 1e-9: continue
                        corr = (dist - seglen) / dist * d
                        if j == 1: pts[j] -= corr
                        else: pts[j - 1] += corr * 0.5; pts[j] -= corr * 0.5
                    # legere raideur de flexion (la soie ne se plie pas en epingle)
                    for j in range(2, n_pts):
                        d = pts[j] - pts[j - 2]; dist = np.linalg.norm(d); tgt = 2 * seglen * 0.995
                        if dist < tgt and dist > 1e-9:
                            corr = (dist - tgt) / dist * d * 0.6
                            pts[j - 2] += corr * 0.5; pts[j] -= corr * 0.5
                    # anti-epingle: trois maillons ne se replient pas completement
                    for j in range(3, n_pts):
                        d = pts[j] - pts[j - 3]; dist = np.linalg.norm(d); tgt = 3 * seglen * 0.94
                        if dist < tgt and dist > 1e-9:
                            corr = (dist - tgt) / dist * d * 0.3
                            pts[j - 3] += corr * 0.5; pts[j] -= corr * 0.5
                    pts[0] = an
            if c == cycles - 1: out[i] = pts.copy()
            elif c == cycles - 2: prev_cycle[i] = pts.copy()
    seam = float(np.linalg.norm(pts - start_state)) / seglen
    # boucle sans couture: sur les derniers 40 % de la boucle on glisse vers le cycle precedent,
    # qui debouche naturellement sur l'image 0 du dernier cycle
    for i in range(L):
        w = min(1.0, max(0.0, (i / L - 0.6) / 0.4)); w = w * w * (3 - 2 * w)
        out[i] = out[i] * (1 - w) + prev_cycle[i] * w
    print(f'   foulard: {n_pts} points, longueur {length_ratio * height:.1f}, couture {seam:.3f} segment(s)')
    hipsW = [seg[i % L].get('_hipsW', np.zeros(3)) for i in range(L + 1)]
    for i in range(L + 1):
        seg[i]['_scarf'] = out[i % L] - hipsW[i]     # retour en coordonnees relatives au bassin
    return seg


def build(path, tag, start=None, upper=None):
    global HANKY
    seg, L = load_loop(path)
    if upper:
        seg_u, _ = load_loop(upper)
        seg = compose(seg, seg_u)
        L = len(seg) - 1
    # taille de reference = hauteur debout (pieds->tete) mediane
    hts = [f['Head'][1] - min(f['LeftFoot'][1], f['RightFoot'][1]) for f in seg]
    scale_ref = float(np.median(hts)) * 1.12
    if HANKY:
        # la main qui tient le foulard = la plus haute le plus souvent (une seule main sur toute la boucle)
        hi = sum(1 for f in seg if f['LeftHand'][1] > f['RightHand'][1])
        hand = 'LeftHand' if hi > len(seg) / 2 else 'RightHand'
        seg = simulate_scarf(seg, L, hand, float(np.median(hts)))
    out = BASE / f'mocap_{tag}'
    out.mkdir(exist_ok=True)
    for f in out.iterdir(): f.unlink()
    idx = np.linspace(0, L, N_OUT, endpoint=False)
    body_boxes = []
    for n, fi in enumerate(idx):
        a, b = int(math.floor(fi)), min(int(math.floor(fi)) + 1, L); t = fi - a
        fv = {k: seg[a][k] * (1 - t) + seg[b][k] * t for k in seg[a]}
        a2, b2 = max(a - 3, 0), min(a + 3, L)
        for hnd, key in (('LeftHand', '_vL'), ('RightHand', '_vR')):
            fv[key] = (seg[b2][hnd] - seg[a2][hnd]) / max(1, b2 - a2)
        fv['_n'] = np.array([n, N_OUT, 0.0])
        im = (render_woman if MODE == 'woman' else render)(fv, scale_ref); im.save(out / f'p{n:03d}.png')
        if HANKY:
            HANKY = False; bb = render_woman(fv, scale_ref).getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox(); HANKY = True
            body_boxes.append(bb)
    if body_boxes:
        import json
        ub = (min(b[0] for b in body_boxes), min(b[1] for b in body_boxes), max(b[2] for b in body_boxes), max(b[3] for b in body_boxes))
        json.dump(ub, open(BASE / f'mocap_{tag}_bodybbox.json', 'w'))
    ims = [Image.open(p).convert('RGBA') for p in sorted(out.glob('*.png'))]
    sel = [ims[i] for i in range(0, N_OUT, 5)]
    sheet = Image.new('RGBA', (170 * len(sel), 200), (40, 34, 48, 255))
    for i, im in enumerate(sel):
        tmb = im.copy(); tmb.thumbnail((200, 200)); sheet.paste(tmb, (i * 170, 0), tmb)
    sheet.save(BASE / f'mocap_{tag}_sheet.png')
    print(f'{tag}: {N_OUT} images rendues ({len(seg) - 1} images source)')


if __name__ == '__main__':
    args = sys.argv[1:]
    upper = None
    while args and args[0].startswith('--'):
        if args[0] == '--woman': MODE = 'woman'
        elif args[0] == '--hanky': HANKY = True
        elif args[0] == '--nout': N_OUT = int(args[1]); args = args[1:]
        elif args[0] == '--maxyaw': MAX_YAW = float(args[1]); args = args[1:]
        elif args[0] == '--upper': upper = args[1]; args = args[1:]
        args = args[1:]
    for arg in args:
        p, tag = arg.split('=') if '=' in arg else (arg, Path(arg).stem)
        build(p, tag, upper=upper)
