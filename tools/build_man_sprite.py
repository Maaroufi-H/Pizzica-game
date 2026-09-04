from pathlib import Path
from PIL import Image
BASE = Path(__file__).resolve().parent
SRC = BASE / 'man_frames'
DST = BASE / 'man_norm'
DST.mkdir(exist_ok=True)
for f in DST.iterdir():
    f.unlink()
CANVAS, CONTENT_H = 160, 156

def solid_bbox(im, thr=8):
    return im.getchannel('A').point(lambda a: 255 if a > thr else 0).getbbox()

ims = [Image.open(p).convert('RGBA') for p in sorted(SRC.glob('m*.png'))]
boxes = [solid_bbox(i) for i in ims]
l = min(b[0] for b in boxes); t = min(b[1] for b in boxes)
r = max(b[2] for b in boxes); btm = max(b[3] for b in boxes)
import json
bb_file = BASE / (SRC.name + '_bodybbox.json')
if bb_file.exists():
    # foulard: normaliser sur le CORPS seul (meme taille que les autres sprites); marge laterale pour le foulard
    bl, bt, br, bb = json.load(open(bb_file)); W0, H0 = ims[0].size
    ext = int(0.28 * (br - bl))
    l, t, r, btm = max(0, bl - ext), bt, min(W0, br + ext), bb
    print('bbox corps (json) + marge laterale')
print('bbox union:', (r - l, btm - t))
scale = CONTENT_H / (btm - t)
nw = max(1, round((r - l) * scale))
for i, im in enumerate(ims):
    crop = im.crop((l, t, r, btm)).resize((nw, CONTENT_H), Image.LANCZOS)
    out = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
    out.paste(crop, ((CANVAS - nw) // 2, CANVAS - CONTENT_H), crop)
    out.save(DST / ('n%03d.png' % i))
print('normalisees:', len(list(DST.iterdir())), '| largeur contenu:', nw)
