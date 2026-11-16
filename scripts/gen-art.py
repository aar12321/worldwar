#!/usr/bin/env python3
"""Procedural art pack generator. Run once: `python3 scripts/gen-art.py` -> public/art/*.webp.
Deterministic (seeded). Needs numpy + Pillow. Frames are 128px unless noted; every atlas is a power of two."""
import math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'art')
os.makedirs(OUT, exist_ok=True)
F = 128
rng = np.random.default_rng(7)

# palette (index.css neon tokens)
CYAN = (10, 132, 255); MAG = (191, 90, 242); AMB = (255, 159, 10); RED = (255, 69, 58); GRN = (48, 209, 88)


def save(img, name, q=80):
    p = os.path.join(OUT, name)
    img.save(p, 'WEBP', quality=q, alpha_quality=90, method=6)
    print(name, img.size, os.path.getsize(p))


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a + 1e-9), 0, 1)
    return t * t * (3 - 2 * t)


def fbm(n, seed, oct=4, base=4):
    r = np.random.default_rng(seed)
    out = np.zeros((n, n)); amp = 1; tot = 0
    for o in range(oct):
        g = base * 2 ** o
        a = r.random((g, g)).astype(np.float32)
        im = Image.fromarray((a * 255).astype(np.uint8)).resize((n, n), Image.BICUBIC)
        out += np.asarray(im, dtype=np.float32) / 255 * amp; tot += amp; amp *= 0.5
    return out / tot


def grid(n):
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    return (x - n / 2) / (n / 2), (y - n / 2) / (n / 2)


def ramp(t, stops):
    t = np.clip(t, 0, 1)
    xs = [s[0] for s in stops]
    out = np.zeros(t.shape + (3,), np.float32)
    for c in range(3):
        out[..., c] = np.interp(t, xs, [s[1][c] for s in stops])
    return out


FIRE = [(0, (20, 0, 0)), (.25, (170, 30, 8)), (.5, (255, 120, 15)), (.75, (255, 205, 80)), (1, (255, 255, 235))]
FIRE_C = [(0, (0, 10, 40)), (.25, (10, 80, 200)), (.5, (255, 130, 20)), (.75, (255, 210, 120)), (1, (240, 250, 255))]
FIRE_M = [(0, (30, 0, 20)), (.25, (160, 30, 90)), (.5, (255, 90, 70)), (.75, (255, 200, 120)), (1, (255, 250, 240))]
SMOKE = [(0, (10, 10, 12)), (1, (110, 112, 120))]


def rgba(rgb, a):
    return np.dstack([np.clip(rgb, 0, 255), np.clip(a, 0, 1) * 255]).astype(np.uint8)


def sheet(frames, cols, rows, cell=F):
    im = Image.new('RGBA', (cols * cell, rows * cell), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        im.paste(Image.fromarray(f, 'RGBA'), ((i % cols) * cell, (i // cols) * cell))
    return im


def blast(p, seed, pal=FIRE, kind='round', n=F):
    x, y = grid(n); nz = fbm(n, seed, 4, 3)
    d = np.sqrt(x * x + y * y)
    if kind == 'tactical':  # angular diamond
        d = (np.abs(x) + np.abs(y)) * 0.85
    d = d + (nz - .5) * (0.55 - .2 * p)
    r = 0.2 + 0.7 * (1 - (1 - p) ** 2)
    core = smooth(r, r * .25, d)
    life = (1 - p) ** 1.1
    I = core * life * 1.25 + smooth(.12, 0, d) * (1 - p) ** 3
    a = np.clip(I * 1.6, 0, 1) * smooth(1, .8, d)
    img = ramp(I * 1.1, pal)
    if kind == 'ring':  # ballistic: ground shock ring
        ring = np.exp(-((d - r * 1.05) / .06) ** 2) * (1 - p)
        img = img + ring[..., None] * np.array([255, 220, 150]); a = np.maximum(a, ring * .8)
    if kind == 'star':  # cruise: 4-point flare
        s = np.exp(-(np.minimum(np.abs(x), np.abs(y)) / .035) ** 2) * np.exp(-(d / (.35 + .6 * p)) ** 2) * (1 - p)
        img = img + s[..., None] * np.array([190, 230, 255]); a = np.maximum(a, s)
    if kind == 'tactical':  # radial sparks
        ang = np.arctan2(y, x); sp = np.maximum(0, np.cos(ang * 8)) ** 24 * smooth(r * 1.15, r * .4, d) * (1 - p) * smooth(.1, .3, d)
        img = img + sp[..., None] * np.array([255, 200, 90]); a = np.maximum(a, sp)
    return rgba(img, a)


def nuke_fireball(p, n=F):
    x, y = grid(n); nz = fbm(n, 11 + int(p * 40), 5, 3)
    d = np.sqrt(x * x + y * y) + (nz - .5) * .5
    r = .15 + .75 * (1 - (1 - p) ** 2.2)
    I = smooth(r, r * .2, d) * (1.05 - p * .45)
    a = np.clip(I * 1.8, 0, 1) * smooth(1, .75, d)
    return rgba(ramp(I * 1.15 + smooth(.25, 0, d) * (1 - p), FIRE), a)


def nuke_mushroom(p, n=F, fade=0.0):
    x, y = grid(n); nz = fbm(n, 30 + int(p * 50), 5, 3); nz2 = fbm(n, 90 + int(p * 50), 3, 6)
    cy = .3 - .6 * p          # cap centre climbs
    rx = .5 + .3 * p; ry = .3 + .14 * p
    capd = np.sqrt(((x + (nz2 - .5) * .1) / rx) ** 2 + ((y - cy) / ry) ** 2)
    cap = smooth(1.0 + (nz - .5) * .5, .55, capd)                       # lobed cap
    skirt = smooth(1.05, .75, np.sqrt(((x) / (rx * 1.25)) ** 2 + ((y - cy - ry * .75) / (ry * .35)) ** 2)) * .9
    sw = .1 + .08 * (y > .5) * (y - .5) + .03 * p                       # stem flares toward ground
    stem = smooth(sw + .06, sw * .5, np.abs(x + (nz2 - .5) * .12)) * smooth(cy, cy + .25, y) * smooth(1.0, .9, y)
    base = np.exp(-(((x / .55) ** 2) + ((y - .82) / .14) ** 2)) * (1 - p * .5)  # ground fireball
    I = np.clip(np.maximum.reduce([cap, skirt, stem * .95, base]), 0, 1)
    a = np.clip(I * 1.6, 0, 1) * (1 - .75 * fade)
    heat = np.clip((cap * (1 - capd * .5)) * (1.15 - p * .55 - fade * .6) + base * .8 + stem * .35 * (1 - p), 0, 1)
    fire = ramp(heat, FIRE)
    smoke = ramp(.35 + .65 * nz, [(0, (20, 8, 8)), (1, (150, 125, 120))])
    hot = np.clip(heat * 2.0 - .1, 0, 1)[..., None]
    return rgba(fire * hot + smoke * (1 - hot), a)


def nuke_ring(p, n=F):
    x, y = grid(n); nz = fbm(n, 50 + int(p * 30), 3, 4)
    d = np.sqrt(x * x + (y * 1.7) ** 2) + (nz - .5) * .05
    r = .12 + .85 * p
    w = .05 + .03 * p
    I = np.exp(-((d - r) / w) ** 2) * (1 - p) ** .8
    inner = smooth(r, r - .25, d) * .12 * (1 - p)
    img = ramp(I * .9 + .1, [(0, (60, 140, 255)), (.5, (200, 230, 255)), (1, (255, 255, 255))])
    return rgba(img, I + inner)


def make_blasts():
    frames = []
    for kind, pal, seed in [('round', FIRE, 1), ('ring', FIRE, 2), ('star', FIRE_C, 3), ('tactical', FIRE_M, 4)]:
        for i in range(8):
            frames.append(blast((i + .5) / 8, seed * 10 + i, pal, kind))
    save(sheet(frames, 8, 4), 'fx_blasts.webp')


def make_nuke():
    fr = [nuke_fireball(i / 7) for i in range(8)]
    fr += [nuke_mushroom(i / 7) for i in range(8)]
    fr += [nuke_ring(i / 7) for i in range(8)]
    fr += [nuke_mushroom(.9 + i * .014, fade=i / 7) for i in range(8)]
    save(sheet(fr, 8, 4), 'fx_nuke.webp')


def puff(seed, col, n=F, soft=.7, a_max=.85):
    x, y = grid(n); nz = fbm(n, seed, 5, 3)
    d = np.sqrt(x * x + y * y) + (nz - .5) * .7
    a = smooth(.85, .2, d) * a_max
    lum = .65 + .35 * nz
    img = np.dstack([lum * c for c in col])
    return rgba(img, a)


def make_particles():
    fr = []
    for i in range(4): fr.append(puff(100 + i, (110, 112, 122)))  # smoke
    for i in range(4): fr.append(puff(120 + i, (190, 165, 120), a_max=.6))  # dust
    for i in range(4):  # embers
        im = Image.new('RGBA', (F * 4, F * 4), (0, 0, 0, 0)); dr = ImageDraw.Draw(im)
        r = np.random.default_rng(140 + i)
        for _ in range(7 + i * 2):
            px, py = r.random(2) * F * 4 * .8 + F * 4 * .1; s = r.random() * 9 + 4
            col = (255, int(150 + r.random() * 90), int(20 + r.random() * 60), 255)
            dr.ellipse([px - s, py - s, px + s, py + s], fill=col)
        g = im.filter(ImageFilter.GaussianBlur(10)); im = Image.alpha_composite(g, im)
        fr.append(np.asarray(im.resize((F, F), Image.LANCZOS)))
    for i in range(4):  # debris shards, amber hot edge
        im = Image.new('RGBA', (F * 4, F * 4), (0, 0, 0, 0)); dr = ImageDraw.Draw(im)
        r = np.random.default_rng(160 + i)
        for _ in range(6):
            cx, cy = r.random(2) * F * 3 + F * .5; a0 = r.random() * 6.28; s = r.random() * 34 + 22
            pts = [(cx + math.cos(a0 + k * 2.1 + r.random() * .6) * s * (.4 + r.random() * .6), cy + math.sin(a0 + k * 2.1) * s * (.4 + r.random() * .6)) for k in range(3)]
            dr.polygon(pts, fill=(44, 40, 38, 255), outline=(255, 150, 40, 255))
        fr.append(np.asarray(im.resize((F, F), Image.LANCZOS)))
    save(sheet(fr, 4, 4), 'fx_particles.webp')


def make_decals():
    fr = []
    for i in range(2):  # scorch
        x, y = grid(F); nz = fbm(F, 200 + i, 5, 3); d = np.sqrt(x * x + y * y) + (nz - .5) * .6
        a = smooth(.9, .1, d) * .85
        fr.append(rgba(np.dstack([np.full_like(d, 12)] * 3) + nz[..., None] * 18, a))
    for i in range(2):  # crater: dark pit, brighter raised rim
        x, y = grid(F); nz = fbm(F, 210 + i, 4, 4); d = np.sqrt(x * x + y * y) + (nz - .5) * .25
        pit = smooth(.7, .3, d); rim = np.exp(-((d - .72) / .08) ** 2)
        a = np.clip(pit * .9 + rim * .7, 0, 1) * smooth(1, .85, d)
        fr.append(rgba(np.dstack([30 + rim * 60 + nz * 20] * 3), a))
    for col in [(255, 120, 20), CYAN, MAG, AMB]:  # glows
        x, y = grid(F); d = np.sqrt(x * x + y * y)
        I = np.exp(-(d / .38) ** 2) + .35 * np.exp(-(d / .8) ** 2)
        fr.append(rgba(np.dstack([np.full_like(d, c) for c in col]) * 1 + I[..., None] * 0, np.clip(I, 0, 1) * smooth(1, .6, d)))
    save(sheet(fr, 4, 2), 'fx_decals.webp')


def trail_row(kind, w=256, h=32):
    xs = np.arange(w)[None, :] / w; ys = (np.arange(h)[:, None] - h / 2) / (h / 2)
    per = lambda k, ph=0: np.sin(2 * math.pi * (xs * k + ph))
    if kind == 'ballistic':  # long thick fire streak, hot white core
        wid = .8 + .12 * per(3); core = np.exp(-(ys / (wid * .3)) ** 2); body = np.exp(-(ys / wid) ** 2)
        I = np.clip(body * (1.0 + .3 * per(2)) * (xs * .6 + .5) + core, 0, 1)
        img = ramp(core * .95 + body * .55, FIRE); a = I
    elif kind == 'cruise':  # thin steady cyan line with fine ripple
        core = np.exp(-(ys / .22) ** 2); a = core * (.85 + .15 * per(8)) + np.exp(-(ys / .6) ** 2) * .25
        img = ramp(core * .85 + .1, [(0, (10, 70, 200)), (.6, (80, 190, 255)), (1, (235, 250, 255))])
    elif kind == 'tactical':  # amber dashed
        dash = (np.sin(2 * math.pi * xs * 8) > -.2).astype(np.float32); core = np.exp(-(ys / .4) ** 2)
        a = core * (.25 + .75 * dash); img = ramp(core, [(0, (200, 90, 0)), (1, (255, 230, 150))])
    elif kind == 'nuke':  # wide braided magenta/red/white
        b1 = np.exp(-((ys - .35 * per(2)) / .22) ** 2); b2 = np.exp(-((ys + .35 * per(2)) / .22) ** 2)
        c = np.exp(-(ys / .18) ** 2); a = np.clip(b1 + b2 + c, 0, 1)
        img = ramp(c * .9 + (b1 + b2) * .35, FIRE_M)
    elif kind == 'interceptor':  # green-cyan zigzag
        zz = np.exp(-((ys - .5 * np.abs(((xs * 6) % 1) * 2 - 1) + .25) / .16) ** 2); a = zz
        img = ramp(zz, [(0, (10, 120, 80)), (.6, (70, 240, 150)), (1, (230, 255, 240))])
    elif kind == 'flare':  # sparkle dots
        d = np.zeros((h, w))
        for k in range(9):
            cx = (k / 9 + .03 * math.sin(k * 7)) % 1; cy = .5 * math.sin(k * 2.3)
            dx = np.minimum(np.abs(xs - cx), 1 - np.abs(xs - cx)) * w / 8
            d += np.exp(-(dx ** 2 + (ys - cy) ** 2 * 4))
        a = np.clip(d, 0, 1); img = ramp(a, [(0, (255, 180, 60)), (1, (255, 255, 255))])
    elif kind == 'contrail':  # soft white wide
        a = np.exp(-(ys / .8) ** 2) * (.4 + .12 * per(3) + .08 * per(7, .2)); img = np.full((h, w, 3), 235, np.float32)
    else:  # wake: foam dashes with V edges
        e = np.exp(-((np.abs(ys) - .55) / .13) ** 2) * (.5 + .5 * per(5)); c = np.exp(-(ys / .2) ** 2) * .55
        a = np.clip(e + c, 0, 1); img = ramp(a, [(0, (120, 190, 230)), (1, (255, 255, 255))])
    return rgba(np.broadcast_to(img, (h, w, 3)), np.broadcast_to(a, (h, w)))


def make_trails():
    kinds = ['ballistic', 'cruise', 'tactical', 'nuke', 'interceptor', 'flare', 'contrail', 'wake']
    im = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
    for i, k in enumerate(kinds): im.paste(Image.fromarray(trail_row(k), 'RGBA'), (0, i * 32))
    save(im, 'fx_trails.webp')


def star(n, rays=4, sharp=.04, size=.9):
    x, y = grid(n); d = np.sqrt(x * x + y * y)
    s = 0
    for k in range(rays):
        a = math.pi * k / rays; u = x * math.cos(a) + y * math.sin(a); v = -x * math.sin(a) + y * math.cos(a)
        s = s + np.exp(-(v / sharp) ** 2) * np.exp(-(np.abs(u) / (size * .5)) ** 2)
    return np.clip(s + np.exp(-(d / .15) ** 2), 0, 1), d


def make_missile_fx():
    fr = []
    for i in range(4):  # launch flash
        s, d = star(F, 6, .05 + .02 * i, .9 - .12 * i); s *= (1 - i * .22)
        fr.append(rgba(ramp(s, FIRE), s))
    for i in range(4):  # launch plume: expanding cone-ish smoke+fire puff upward
        x, y = grid(F); nz = fbm(F, 300 + i, 4, 3); p = i / 3
        d = np.sqrt((x / (.35 + .2 * p)) ** 2 + ((y + .3 - .25 * p) / (.55 + .25 * p)) ** 2) + (nz - .5) * .5
        I = smooth(1, .2, d) * (1 - p * .6); fr.append(rgba(ramp(I * 1.2 * (1 - p * .5), FIRE), np.clip(I * 1.4, 0, 1)))
    for i in range(4):  # interception burst: ring + 8 spikes (green/cyan)
        x, y = grid(F); d = np.sqrt(x * x + y * y); p = i / 3; ang = np.arctan2(y, x)
        ring = np.exp(-((d - (.25 + .6 * p)) / .06) ** 2) * (1 - p * .6)
        spk = np.maximum(0, np.cos(ang * 8)) ** 30 * smooth(.3 + .6 * p, .1, d) * (1 - p * .5)
        core = np.exp(-(d / (.2 - .1 * p)) ** 2); I = np.clip(ring + spk + core, 0, 1)
        fr.append(rgba(ramp(I, [(0, (10, 120, 80)), (.6, (70, 240, 150)), (1, (240, 255, 245))]), I))
    for i in range(2):  # flare sparkle (4-point vs 6-point shape differs)
        s, d = star(F, 4 if i == 0 else 6, .03); fr.append(rgba(np.dstack([np.full_like(s, 255), np.full_like(s, 235), np.full_like(s, 200)]), s))
    x, y = grid(F); d = np.sqrt(x * x + y * y)  # radar ping ring
    ring = np.exp(-((d - .7) / .05) ** 2) + .25 * np.exp(-((d - .45) / .04) ** 2)
    fr.append(rgba(np.dstack([np.full_like(d, c) for c in (80, 240, 170)]), np.clip(ring, 0, 1)))
    ang = np.arctan2(y, x)  # radar sweep wedge: fading trail behind a bright leading edge
    t = np.mod(-ang, 2 * math.pi) / (2 * math.pi)
    sweep = np.where(t < .22, (1 - t / .22) ** 2, 0) * smooth(1, .9, d)
    fr.append(rgba(np.dstack([np.full_like(d, c) for c in (80, 240, 170)]), sweep * .8))
    fr += [np.zeros((F, F, 4), np.uint8)] * 2
    save(sheet(fr, 4, 4), 'fx_missile.webp')


# ---------- icons ----------
S = 512  # draw at 4x then downsample


def new():
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); return im, ImageDraw.Draw(im)


def P(pts): return [(x * S / 100, y * S / 100) for x, y in pts]


W = 255


def g_infantry(d, c):
    d.pieslice(P([(34, 6), (66, 38)]), 180, 360, fill=c); d.rectangle(P([(32, 22), (68, 28)]), fill=c)  # helmet + brim
    d.ellipse(P([(40, 28), (60, 44)]), fill=c)
    d.rounded_rectangle(P([(24, 46), (76, 94)]), radius=int(S * .1), fill=c)
    d.line(P([(14, 92), (90, 24)]), fill=(0, 0, 0, 255), width=int(S * .075)); d.line(P([(14, 92), (90, 24)]), fill=c, width=int(S * .035))


def g_armor(d, c):
    d.rounded_rectangle(P([(14, 56), (86, 82)]), radius=int(S * .06), fill=c)
    d.rounded_rectangle(P([(28, 36), (66, 58)]), radius=int(S * .05), fill=c)
    d.rectangle(P([(64, 42), (96, 49)]), fill=c)


def g_artillery(d, c):
    d.ellipse(P([(18, 56), (50, 88)]), fill=c)
    d.line(P([(36, 66), (92, 24)]), fill=c, width=int(S * .08))
    d.rectangle(P([(10, 84), (70, 92)]), fill=c)


def g_jet(d, c):
    d.polygon(P([(50, 6), (58, 38), (92, 66), (92, 76), (58, 66), (56, 88), (66, 94), (66, 98), (50, 94), (34, 98), (34, 94), (44, 88), (42, 66), (8, 76), (8, 66), (42, 38)]), fill=c)


def g_bomber(d, c):
    d.polygon(P([(50, 6), (57, 30), (97, 56), (97, 68), (57, 60), (55, 86), (66, 94), (34, 94), (45, 86), (43, 60), (3, 68), (3, 56), (43, 30)]), fill=c)


def g_stealth(d, c):
    d.polygon(P([(50, 10), (96, 80), (74, 72), (50, 90), (26, 72), (4, 80)]), fill=c)


def g_drone(d, c):
    d.ellipse(P([(38, 38), (62, 62)]), fill=c)
    for cx, cy in [(22, 22), (78, 22), (22, 78), (78, 78)]:
        d.line(P([(50, 50), (cx, cy)]), fill=c, width=int(S * .035)); d.ellipse(P([(cx - 11, cy - 11), (cx + 11, cy + 11)]), outline=c, width=int(S * .03))


def g_awacs(d, c):
    d.polygon(P([(50, 6), (56, 26), (96, 52), (96, 62), (56, 56), (55, 84), (66, 94), (34, 94), (45, 84), (44, 56), (4, 62), (4, 52), (44, 26)]), fill=c)
    d.ellipse(P([(34, 40), (66, 72)]), outline=(0, 0, 0, 255), width=int(S * .03), fill=c)


def g_robot(d, c):
    d.rounded_rectangle(P([(28, 24), (72, 56)]), radius=int(S * .05), fill=c)
    d.rectangle(P([(24, 60), (76, 90)]), fill=c)
    d.line(P([(50, 24), (50, 8)]), fill=c, width=int(S * .035)); d.ellipse(P([(45, 3), (55, 13)]), fill=c)
    for ex in (38, 56): d.rectangle(P([(ex, 34), (ex + 8, 42)]), fill=(0, 0, 0, 255))


def g_launcher(d, c):
    d.rectangle(P([(8, 66), (92, 84)]), fill=c)
    d.ellipse(P([(18, 78), (34, 94)]), fill=c); d.ellipse(P([(66, 78), (82, 94)]), fill=c)
    d.polygon(P([(26, 62), (30, 54), (76, 18), (86, 22), (88, 30), (40, 66)]), fill=c)
    d.polygon(P([(76, 18), (96, 8), (88, 30)]), fill=c)


def g_garrison(d, c):
    d.rectangle(P([(16, 40), (84, 90)]), fill=c)
    for x in (16, 36, 56, 76): d.rectangle(P([(x, 22), (x + 12, 40)]), fill=c)
    d.rectangle(P([(42, 62), (58, 90)]), fill=(0, 0, 0, 255))


def g_patrol(d, c):
    d.arc(P([(14, 14), (86, 86)]), 30, 330, fill=c, width=int(S * .07))
    d.polygon(P([(78, 12), (96, 38), (66, 40)]), fill=c)
    d.ellipse(P([(40, 40), (60, 60)]), fill=c)


def g_radar(d, c):
    d.pieslice(P([(10, 30), (90, 110)]), 180, 360, fill=c)
    d.line(P([(50, 70), (50, 90)]), fill=c, width=int(S * .06)); d.rectangle(P([(30, 88), (70, 94)]), fill=c)
    for r in (22, 36): d.arc(P([(50 - r, 22 - r), (50 + r, 22 + r)]), 220, 320, fill=c, width=int(S * .04))
    d.ellipse(P([(45, 17), (55, 27)]), fill=c)


def g_patrolboat(d, c):
    d.polygon(P([(50, 4), (66, 30), (68, 80), (60, 94), (40, 94), (32, 80), (34, 30)]), fill=c)
    d.rectangle(P([(42, 46), (58, 64)]), fill=(0, 0, 0, 255))


def g_destroyer(d, c):
    d.polygon(P([(50, 2), (62, 22), (66, 76), (60, 98), (40, 98), (34, 76), (38, 22)]), fill=c)
    d.rectangle(P([(42, 30), (58, 44)]), fill=(0, 0, 0, 255)); d.rectangle(P([(40, 56), (60, 70)]), fill=(0, 0, 0, 255))


def g_sub(d, c):
    d.rounded_rectangle(P([(40, 4), (60, 96)]), radius=int(S * .1), fill=c)
    d.rectangle(P([(44, 36), (56, 50)]), fill=(0, 0, 0, 255))
    d.polygon(P([(40, 6), (4, 60), (12, 66), (40, 40)]), fill=None, outline=c, width=int(S * .03))
    d.polygon(P([(60, 6), (96, 60), (88, 66), (60, 40)]), fill=None, outline=c, width=int(S * .03))


UNITS = [('infantry', g_infantry, 'sq', GRN), ('armor', g_armor, 'sq', GRN), ('artillery', g_artillery, 'sq', GRN),
         ('fighter', g_jet, 'tri', CYAN), ('drone', g_drone, 'tri', CYAN), ('robot', g_robot, 'hex', MAG),
         ('launcher', g_launcher, 'dia', RED), ('garrison', g_garrison, 'oct', AMB), ('patrol', g_patrol, 'circ', AMB), ('radar', g_radar, 'circ', CYAN)]


def badge(shape, d, col, width):
    pts = {'sq': [(8, 8), (92, 8), (92, 92), (8, 92)], 'tri': [(50, 4), (96, 90), (4, 90)], 'hex': [(26, 6), (74, 6), (98, 50), (74, 94), (26, 94), (2, 50)],
           'dia': [(50, 2), (98, 50), (50, 98), (2, 50)], 'oct': [(30, 4), (70, 4), (96, 30), (96, 70), (70, 96), (30, 96), (4, 70), (4, 30)]}
    if shape == 'circ': d.ellipse(P([(4, 4), (96, 96)]), outline=col, width=width)
    else: d.polygon(P(pts[shape]), outline=col, width=width)


def icon(glyph, shape, col, mono):
    base, bd = new(); gl, gd = new()
    glyph_scale = .56
    glyph(gd, (255, 255, 255, 255) if mono else col + (255,))
    gl = gl.resize((int(S * glyph_scale), int(S * glyph_scale)), Image.LANCZOS)
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    layer.paste(gl, ((S - gl.width) // 2, (S - gl.height) // 2 + int(S * .02)), gl)
    wcol = (255, 255, 255, 255) if mono else col + (255,)
    badge(shape, bd, wcol, int(S * .05))
    if not mono:  # dark plate + glow
        plate = Image.new('RGBA', (S, S), (0, 0, 0, 0)); pd = ImageDraw.Draw(plate)
        badge(shape, pd, (0, 0, 0, 0), 0)
        glow = base.filter(ImageFilter.GaussianBlur(S * .03)); layer = Image.alpha_composite(glow, Image.alpha_composite(base, layer))
    else:
        layer = Image.alpha_composite(base, layer)
    return layer.resize((F, F), Image.LANCZOS)


def make_icons():
    for mono in (False, True):
        im = Image.new('RGBA', (4 * F, 4 * F), (0, 0, 0, 0))
        for i, (n, g, sh, col) in enumerate(UNITS): im.paste(icon(g, sh, col, mono), ((i % 4) * F, (i // 4) * F))
        save(im, 'icons_mono.webp' if mono else 'icons_units.webp')
    sil = [g_jet, g_bomber, g_stealth, g_drone, g_awacs, g_patrolboat, g_destroyer, g_sub]
    im = Image.new('RGBA', (4 * F, 2 * F), (0, 0, 0, 0))
    for i, g in enumerate(sil):
        b, d = new(); g(d, (255, 255, 255, 255))
        im.paste(b.resize((F, F), Image.LANCZOS), ((i % 4) * F, (i // 4) * F))
    save(im, 'silhouettes.webp')


def make_army():
    cell = 64; fr = []
    for i in range(8):  # squad marching top-down: 3 soldiers alternating step
        im = Image.new('RGBA', (cell * 4, cell * 4), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
        for k, (cx, cy) in enumerate([(60, 60), (175, 60), (118, 128), (60, 200), (175, 200)]):
            ph = math.sin(i / 8 * 2 * math.pi + k * 1.3) * 12
            d.ellipse([cx - 20, cy - 24 + ph * .2, cx + 20, cy + 14 + ph * .2], fill=(60, 220, 120, 255))  # shoulders
            d.ellipse([cx - 11, cy - 13, cx + 11, cy + 9], fill=(230, 255, 240, 255))  # helmet
            d.line([cx + 24, cy - 30 + ph, cx + 24, cy + 30 + ph], fill=(200, 210, 220, 255), width=8)  # rifle
        fr.append(im.resize((cell, cell), Image.LANCZOS))
    for i in range(8):  # dust trail drifting back
        p = i / 7; x, y = grid(cell); nz = fbm(cell, 400 + i, 4, 3)
        d = np.sqrt(((x - .3 + .6 * p) / (.5 + .2 * p)) ** 2 + (y / (.35 + .15 * p)) ** 2) + (nz - .5) * .6
        fr.append(Image.fromarray(rgba(np.dstack([np.full_like(d, c) for c in (190, 165, 120)]), smooth(1, .2, d) * .6 * (1 - p * .8)), 'RGBA'))
    for i in range(8):  # banner waving
        im = Image.new('RGBA', (cell * 4, cell * 4), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
        d.rectangle([40, 20, 50, 240], fill=(210, 215, 225, 255))
        top = []; bot = []
        for k in range(0, 17):
            xx = 50 + k * 11; yy = math.sin(i / 8 * 2 * math.pi + k * .5) * (4 + k * .8)
            top.append((xx, 32 + yy)); bot.append((xx, 112 + yy))
        d.polygon(top + bot[::-1], fill=(255, 159, 10, 255), outline=(255, 235, 190, 255))
        d.polygon([(70, 72), (100, 52), (130, 72), (100, 92)], fill=(20, 20, 24, 255))  # diamond emblem (shape-coded)
        fr.append(im.resize((cell, cell), Image.LANCZOS))
    for i in range(8):  # muzzle flash
        s, d = star(cell, 5, .09, .95 - .08 * i); s = s * (1 - i * .11)
        fr.append(Image.fromarray(rgba(ramp(s, FIRE), s), 'RGBA'))
    for i in range(8):  # clash sparks: burst of streaks
        im = Image.new('RGBA', (cell * 4, cell * 4), (0, 0, 0, 0)); d = ImageDraw.Draw(im); r = np.random.default_rng(500)
        p = i / 7
        for _ in range(16):
            a = r.random() * 6.283; r0 = 20 + 90 * p * (.5 + r.random()); r1 = r0 + 30 * (1 - p)
            col = (255, int(190 + r.random() * 60), int(80 + r.random() * 100), int(255 * (1 - p * .8)))
            d.line([128 + math.cos(a) * r0, 128 + math.sin(a) * r0, 128 + math.cos(a) * r1, 128 + math.sin(a) * r1], fill=col, width=6)
        im = Image.alpha_composite(im.filter(ImageFilter.GaussianBlur(5)), im)
        fr.append(im.resize((cell, cell), Image.LANCZOS))
    sh = Image.new('RGBA', (cell * 8, cell * 8), (0, 0, 0, 0))
    for i, f in enumerate(fr): sh.paste(f, ((i % 8) * cell, (i // 8) * cell))
    save(sh.crop((0, 0, cell * 8, cell * 5)).resize((cell * 8, cell * 5)) if False else sh, 'fx_army.webp')


def make_ui():
    # warning chevrons, tile 128, tileable diagonally
    n = 128; y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    t = np.mod((x + y) / n * 2, 1.0); band = (t < .5).astype(np.float32)
    save(Image.fromarray(rgba(np.dstack([np.full((n, n), c) for c in AMB]), band * .9), 'RGBA'), 'ui_chevrons.webp')
    # hex grid + scanlines overlay tile 256 (low alpha; tileable: hex pitch divides tile)
    n = 256; im = Image.new('RGBA', (n * 2, n * 2), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    hw = 64 * 2; hh = int(hw * math.sqrt(3) / 2 * 2) // 2
    r = 64
    for row in range(-1, 6):
        for col in range(-1, 6):
            cx = col * 1.5 * r * 2 / 2 * 1.0; cx = col * 3 * r / 2 * 2 / 2
            # use flat-top hexes: horizontal step 1.5r*2 (=192/..): keep simple, pitch tuned to tile
            pass
    # simple tileable: square hexagon-ish lattice via lines at 60 degree repeats on 256 tile
    px = np.mgrid[0:n, 0:n].astype(np.float32); yy, xx = px
    def lines(ang, pitch):
        u = (xx * math.cos(ang) + yy * math.sin(ang)) / pitch
        return np.exp(-((np.abs(u - np.round(u))) * pitch / 1.1) ** 2)
    # 0deg, +/-63.43deg (atan2(2,1)) lattice with integer periodicity on 256 tile
    L = np.maximum(lines(math.atan2(0, 1), 32), np.maximum(lines(math.atan2(1, 2) + math.pi / 2 - 0, 128 / math.sqrt(5)), lines(-math.atan2(1, 2) - math.pi / 2, 128 / math.sqrt(5))))
    scan = (np.mod(yy, 4) < 1).astype(np.float32) * .5
    a = np.clip(L * .35 + scan * .35, 0, 1)
    save(Image.fromarray(rgba(np.dstack([np.full((n, n), c) for c in CYAN]), a), 'RGBA'), 'ui_hexscan.webp')
    # glow rings 4x1 128: thin, double, dashed, pulse halo (shapes differ)
    fr = []
    x, yv = grid(F); d = np.sqrt(x * x + yv * yv); ang = np.arctan2(yv, x)
    fr.append(np.exp(-((d - .8) / .035) ** 2) + .25 * np.exp(-((d - .8) / .12) ** 2))
    fr.append(np.exp(-((d - .85) / .03) ** 2) + np.exp(-((d - .68) / .03) ** 2))
    fr.append((np.exp(-((d - .8) / .045) ** 2)) * (np.sin(ang * 16) > 0) + .2 * np.exp(-((d - .8) / .12) ** 2))
    fr.append(smooth(1, .5, d) * .7 * (d < 1) + np.exp(-((d - .5) / .04) ** 2))
    fr = [rgba(np.dstack([np.full_like(f, c) for c in (255, 255, 255)]), np.clip(f, 0, 1)) for f in fr]
    save(sheet(fr, 4, 1), 'ui_rings.webp')


if __name__ == '__main__':
    for fn in [make_blasts, make_nuke, make_particles, make_decals, make_trails, make_missile_fx, make_icons, make_army, make_ui]:
        if len(sys.argv) < 2 or fn.__name__ in sys.argv[1:]: fn()
