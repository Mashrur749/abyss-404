#!/usr/bin/env python3
"""Preprocess the vision-encounter render into src/assets/vision-apparition.png.

Run:  python3 scripts/prepare-vision-asset.py <source-image>

The vision plane is drawn with THREE.AdditiveBlending (see src/scene/vision.js), which imposes two
requirements this script exists to satisfy:

  1. THE VOID MUST BE EXACTLY BLACK. Additive blending adds the source color to whatever is behind
     it, so a background at luminance ~5 (which is what the generator's grain/JPEG noise floor
     actually measures) would render as a faintly-lifted rectangle floating in the abyss — the same
     "I can still see the box" failure v2.15 chased on the old TV asset. FLOOR crushes anything at
     or below that noise floor to (0,0,0), which adds literally nothing.

  2. THE CANVAS EDGES MUST NOT CUT THE SUBJECT. The couch runs off the source render's left and
     bottom edges (verified: left-edge max luminance 184), so without a feather the plane would end
     in a hard photographic cut. FEATHER ramps alpha to 0 over the outer edge of each side.

NOT done here, deliberately: any subject/background alpha key. The man's body and the surrounding
void share the same median luminance (5 vs 5) in this render, so no threshold separates them — a
luminance key would punch holes in the figure, which is exactly the v2.8 invisible-silhouette bug.
Under additive blending none is needed.
"""

import sys
from PIL import Image

DST = 'src/assets/vision-apparition.png'
FLOOR = 9.0                 # luminance at or below this is noise floor / true void -> pure black, alpha 0
GAIN = 255.0 / (255.0 - FLOOR)
FEATHER = 0.045             # fraction of width/height faded out at each canvas edge
# Crop of the 1280x720 source, in source pixels. The dead void right of the TV and above the scene
# costs real world-space plane size for nothing: the plane's width is fixed by how big the "404"
# glyphs need to be on screen, so every pixel of empty margin makes the plane physically LARGER for
# the same text, which in turn forces VISION_ENCOUNTER.axisOffset further out (the plane's
# half-width has to clear the travel axis or the camera flies through the picture) — and pushing the
# encounter further away is exactly what shrinks the text at closest pass. Cropping is the only
# lever that breaks that loop; scaling cannot, since it grows glyph and half-width in lockstep.
CROP = (100, 80, 1160, 720)  # left, top, right, bottom -> 1060x640


def ramp(v):
    v = max(0.0, min(1.0, v))
    return v * v * (3 - 2 * v)   # smoothstep


def main(src):
    im = Image.open(src).convert('RGB').crop(CROP)
    w, h = im.size
    px = im.load()
    out = Image.new('RGBA', (w, h))
    op = out.load()

    fx, fy = w * FEATHER, h * FEATHER
    for y in range(h):
        ey = min(ramp(y / fy), ramp((h - 1 - y) / fy))
        for x in range(w):
            r, g, b = px[x, y]
            lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
            e = min(ramp(x / fx), ramp((w - 1 - x) / fx), ey)
            if lum <= FLOOR or e <= 0:
                op[x, y] = (0, 0, 0, 0)
                continue
            # Subtract the noise floor from RGB and restore the range. The feather lives in ALPHA
            # only — applying it to RGB as well would darken twice, since both blend modes multiply
            # source color by source alpha.
            k = ((lum - FLOOR) * GAIN) / lum
            op[x, y] = (int(min(255, r * k)), int(min(255, g * k)), int(min(255, b * k)), int(e * 255))

    out.save(DST, optimize=True)
    print(f'wrote {DST} {out.size}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
