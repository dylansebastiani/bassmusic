"""Renders the Subduction hero loop (and its stills) from one reference image of the machine.

Usage: python3 -I scripts/hero/render.py REFERENCE.jpg OUT_DIR
Writes OUT_DIR/hero-src.mp4 (1080x1080, 30fps, 150 frames, loops) and raw PNG stills.
Everything is a pure function of the frame number, so reruns give the same video.
"""
import math, subprocess, sys
import numpy as np
from PIL import Image

FPS, N = 30, 150


class Scene:
    def __init__(self, ref, W, H, objh, drip_reach):
        self.W, self.H = W, H
        img = Image.open(ref).convert("RGB").crop((100, 270, 1010, 1760))
        a = np.asarray(img).astype(np.float32)
        a = np.clip((a - 16) * 1.1, 0, 255)             # crush the reference's near-black so the crop vanishes
        ramp = lambda n, m: np.clip(np.minimum(np.arange(n), np.arange(n)[::-1]) / m, 0, 1) ** 1.5
        a *= (ramp(a.shape[0], 90)[:, None] * ramp(a.shape[1], 90)[None, :])[:, :, None]
        img = Image.fromarray(a.astype(np.uint8))
        self.objh = objh
        self.base = img.resize((int(img.width * objh / img.height), objh), Image.LANCZOS)
        self.cx, self.cy = W // 2, int(H * 0.47)
        self.drip_reach = drip_reach
        self.trail = np.zeros((H, W, 3), np.float32)
        rng = np.random.default_rng(7)
        # drip slots: fixed columns, channel rotating R,G,B so bands never overlap (no pink)
        n = 24
        span = self.base.width * 0.9
        self.drips = []
        for i in range(n):
            x = self.cx + (i - (n - 1) / 2) * span / n
            self.drips.append(dict(x=int(x), w=int(rng.integers(3, 9)), ch=i % 3, cyc=int(rng.integers(1, 3)),
                                   off=float(rng.random()), reach=float(rng.uniform(.45, 1.0)),
                                   steps=rng.random(48)))

    def level_for(self, f):
        if f < 3 or f >= N - 3:
            return 0
        r = np.random.default_rng(5000 + f // 3).random()
        r2 = np.random.default_rng(9000 + f).random()
        base = 0 if r < .22 else (1 if r < .6 else 2)
        return min(2, base + (1 if r2 > .93 else 0)) if base else (1 if r2 > .85 else 0)

    def frame(self, f, level=None, split=None):
        W, H = self.W, self.H
        rng = np.random.default_rng(1000 + f)
        phase = f / N
        lv = self.level_for(f) if level is None else level
        clean = lv < 0
        lv = max(lv, 0)
        push = 1 + .14 * (.5 - .5 * math.cos(2 * math.pi * phase))
        breathe = 1 + .03 * math.sin(2 * math.pi * phase * 2)
        dx = (2 + 2 * math.sin(2 * math.pi * phase * 3)) if lv == 0 else (rng.uniform(6, 16) if lv == 1 else rng.uniform(18, 46))
        if split is not None:
            dx = split
        dy = 0 if lv < 2 else rng.uniform(-6, 6)
        amp = 0 if clean else 2 + lv * 4
        chans = []
        for k, c in enumerate((0, 1, 2)):          # R,G,B each drawn with its own scale and offset
            s = push * breathe * (1 + (k - 1) * (0 if clean else .006 + .004 * lv))
            w, h = int(self.base.width * s), int(self.base.height * s)
            ch = np.asarray(self.base.resize((w, h), Image.BILINEAR))[:, :, c].astype(np.float32)
            rows = np.arange(h)
            shift = (amp * np.sin(rows * .03 + phase * 2 * math.pi * 3 + k * .4)).astype(int)
            cols = (np.arange(w)[None, :] - shift[:, None]) % w
            ch = np.take_along_axis(ch, cols, axis=1)
            layer = np.zeros((H, W), np.float32)
            ox = int(self.cx - w / 2 + (k - 1) * dx)
            oy = int(self.cy - h / 2 + (k - 1) * dy)
            x0, y0 = max(ox, 0), max(oy, 0)
            x1, y1 = min(ox + w, W), min(oy + h, H)
            if x1 > x0 and y1 > y0:
                layer[y0:y1, x0:x1] = ch[y0 - oy:y1 - oy, x0 - ox:x1 - ox]
            chans.append(layer)
        fr = np.stack(chans, -1)
        top, bot = int(self.cy - self.objh * push * .55), int(self.cy + self.objh * push * .55)
        # hard horizontal slices, each channel jumps by a different amount
        if lv:
            for _ in range(int(rng.integers(2, 5)) * lv + 1):
                y = int(rng.integers(top, bot)); h = int(rng.integers(5, 28 if lv == 1 else 60))
                s = int(rng.choice([-1, 1]) * rng.uniform(20, 70 if lv == 1 else 140))
                if rng.random() < .5:
                    for c in range(3):
                        fr[y:y + h, :, c] = np.roll(fr[y:y + h, :, c], s + int(rng.integers(-18, 18)) * c, axis=1)
                else:
                    fr[y:y + h] = np.roll(fr[y:y + h], s, axis=1)
            # blocks that jump sideways
            for _ in range(lv):
                bw, bh = int(rng.integers(30, 110)), int(rng.integers(24, 90))
                x = int(rng.integers(self.cx - 160, self.cx + 100)); y = int(rng.integers(top, bot - bh))
                s = int(rng.choice([-1, 1]) * rng.uniform(30, 120))
                blk = fr[y:y + bh, x:x + bw].copy()
                fr[y:y + bh, x + s:x + s + bw] = np.maximum(fr[y:y + bh, x + s:x + s + bw] * .3, blk)
        # datamosh smear: drag one pixel row/column across a region
        if lv and rng.random() < .45:
            if rng.random() < .5:
                y = int(rng.integers(top, bot - 60)); h = int(rng.integers(14, 60)); x = int(rng.integers(self.cx - 140, self.cx + 40)); L = int(rng.integers(60, 220))
                fr[y:y + h, x:x + L] = fr[y:y + h, x:x + 1]
            else:
                x = int(rng.integers(self.cx - 150, self.cx + 90)); w = int(rng.integers(20, 90)); y = int(rng.integers(top, bot - 120)); L = int(rng.integers(60, 200))
                fr[y:y + L, x:x + w] = fr[y:y + 1, x:x + w]
        # scanline jitter
        if lv == 2:
            band = fr[top:bot].copy()
            band[::2] = np.roll(band[::2], int(rng.integers(-5, 6)), axis=1)
            band[1::4] *= .55
            fr[top:bot] = band
        # signal dropout: flickers out and back
        if lv and f > 3 and rng.random() < (.06 if lv == 1 else .14):
            fr *= rng.choice([0., 0., .12])
        # pixel-sort drips: stretched, quantised colour bands that fall and fade out
        ys = int(self.cy + self.objh * push * .36)
        reach = self.drip_reach
        for d in self.drips:
            p = (phase * d["cyc"] + d["off"]) % 1
            head = ys + int(p * reach * d["reach"]); length = int(10 + (reach * .45) * math.sin(math.pi * p) * d["reach"])
            if length < 4 or head >= H - 6:
                continue
            a = math.sin(math.pi * p) ** .7
            t = np.linspace(0, 1, length)
            steps = d["steps"][(np.floor(t * 12).astype(int) + int(p * 20)) % 48]
            v = (np.floor((1 - t) ** 1.2 * steps * 7) / 7).astype(np.float32) * a
            yy0 = head - length
            x0 = d["x"] - d["w"] // 2
            seg = fr[yy0:head, x0:x0 + d["w"], d["ch"]]
            fr[yy0:head, x0:x0 + d["w"], d["ch"]] = np.maximum(seg, v[:, None] * 255 * (.7 + .3 * lv / 2))
        # ghost trails: previous frames smear and decay, R and B drift apart
        if clean:
            self.trail = fr
            return np.clip(fr, 0, 255).astype(np.uint8)
        tr = self.trail * .66
        tr[:, :, 0] = np.roll(tr[:, :, 0], 7, axis=1)
        tr[:, :, 2] = np.roll(tr[:, :, 2], -7, axis=1)
        out = np.maximum(fr, tr * (.5 if lv == 0 else 1))
        self.trail = out
        return np.clip(out, 0, 255).astype(np.uint8)


def main(ref, out):
    sc = Scene(ref, 1080, 1080, 480, 520)
    for f in range(N - 30, N):          # pre-roll so trails at frame 0 match the end of the loop
        sc.frame(f)
    ff = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "1080x1080", "-r", str(FPS), "-i", "-",
                           "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", f"{out}/hero-src.mp4"], stdin=subprocess.PIPE)
    keep = {}
    prev = None
    for f in range(N):
        fr = sc.frame(f)
        if f > 3 and np.random.default_rng(77 + f).random() < .06 and prev is not None:
            fr = prev                   # frame stutter: hold the last picture
        prev = fr
        ff.stdin.write(fr.tobytes())
        if f in (0, 60, 100):
            keep[f] = fr
    ff.stdin.close(); ff.wait()
    cs = Scene(ref, 1080, 1080, 480, 520)
    cs.frame(75, level=-1, split=1.5)
    Image.fromarray(cs.frame(75, level=-1, split=1.5)).save(f"{out}/raw-clean.png")
    for f, fr in keep.items():
        Image.fromarray(fr).save(f"{out}/raw-{f:03d}.png")
    # wide email header: same machine, wider stage
    hs = Scene(ref, 1200, 400, 360, 40)
    hs.cy = 178
    for f in range(40, 60):
        hs.frame(f, level=-1, split=2.5)
    hs.trail *= 0
    fr = hs.frame(60, level=-1, split=2.5)
    Image.fromarray(fr).save(f"{out}/raw-header.png")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
