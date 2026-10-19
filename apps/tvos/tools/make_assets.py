#!/usr/bin/env python3
"""Draws Tuner's Apple TV icons and Top Shelf images and writes the asset catalog.

Usage:  python3 tools/make_assets.py Tuner/Resources/Assets.xcassets
Needs Pillow. The mark (ring, dot, play triangle) is drawn from the brand colours used in docs/store/icon-512.png,
so every size is sharp. Outputs: App Icon & Top Shelf Image.brandassets (3-layer Home Screen icon 400x240 and
800x480, 3-layer App Store icon 1280x768, Top Shelf 1920x720/3840x1440 and Top Shelf Wide 2320x720/4640x1440,
all opaque where Apple requires it), plus the AccentColor and Brand* colour sets.
(No launch colour: tvOS ignores the iOS-only UILaunchScreen key, and Tuner has no launch storyboard.)
"""
import json
import math
import os
import sys

from PIL import Image, ImageDraw

INK = (20, 18, 36)          # #141224 background
GLOW = (58, 36, 104)        # top-right glow of docs/store/background-1920x1080.png
PURPLE = (124, 58, 237)     # #7C3AED ring
LILAC = (171, 115, 239)     # #AB73EF dot
WHITE = (255, 255, 255)
SS = 4                      # supersampling factor

INFO = {"author": "xcode", "version": 1}


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def background(w, h):
    """Opaque gradient: ink, brightening towards a purple glow at the top right."""
    small_w, small_h = max(1, w // 8), max(1, h // 8)
    im = Image.new("RGB", (small_w, small_h))
    px = im.load()
    for y in range(small_h):
        for x in range(small_w):
            dx, dy = (x / small_w) - 1.0, (y / small_h)
            t = max(0.0, 1.0 - math.hypot(dx * 0.9, dy * 1.3))
            t = t ** 1.6
            px[x, y] = tuple(int(INK[i] + (GLOW[i] - INK[i]) * t) for i in range(3))
    return im.resize((w, h), Image.BICUBIC)


def ring_layer(w, h, diameter):
    """Transparent layer: purple ring and lilac dot, centred."""
    im = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx, cy, r = w * SS / 2, h * SS / 2, diameter * SS / 2
    stroke = diameter * SS * 0.085
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=PURPLE + (255,), width=int(stroke))
    angle = math.radians(-50)
    mid = r - stroke / 2
    dx, dy = cx + mid * math.cos(angle), cy + mid * math.sin(angle)
    dr = stroke * 0.95
    d.ellipse([dx - dr, dy - dr, dx + dr, dy + dr], fill=LILAC + (255,))
    return im.resize((w, h), Image.LANCZOS)


def play_layer(w, h, diameter):
    """Transparent layer: white play triangle with rounded corners, optically centred."""
    im = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx, cy = w * SS / 2 + diameter * SS * 0.05, h * SS / 2
    s = diameter * SS * 0.42
    outer = [(cx - s * 0.45, cy - s * 0.55), (cx - s * 0.45, cy + s * 0.55), (cx + s * 0.6, cy)]
    gx, gy = sum(x for x, _ in outer) / 3, sum(y for _, y in outer) / 3
    rr = s * 0.09
    inner = [(gx + (x - gx) * 0.82, gy + (y - gy) * 0.82) for x, y in outer]
    d.polygon(inner, fill=WHITE + (255,))
    d.line(inner + [inner[0]], fill=WHITE + (255,), width=int(rr * 2), joint="curve")
    for x, y in inner:
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=WHITE + (255,))
    return im.resize((w, h), Image.LANCZOS)


def flat_mark(w, h, diameter):
    im = background(w, h).convert("RGBA")
    im.alpha_composite(ring_layer(w, h, diameter))
    im.alpha_composite(play_layer(w, h, diameter))
    return im.convert("RGB")


def image_stack(root, name, sizes, app_store=False):
    """sizes: [(scale, w, h)]. Layers Front (play), Middle (ring), Back (opaque gradient)."""
    stack = os.path.join(root, name + ".imagestack")
    layers = [("Front", play_layer), ("Middle", ring_layer), ("Back", None)]
    write_json(os.path.join(stack, "Contents.json"),
               {"info": INFO, "layers": [{"filename": n + ".imagestacklayer"} for n, _ in layers]})
    for layer_name, draw in layers:
        layer_dir = os.path.join(stack, layer_name + ".imagestacklayer")
        write_json(os.path.join(layer_dir, "Contents.json"), {"info": INFO})
        images = []
        for scale, w, h in sizes:
            diameter = h * 0.62
            fname = "%s-%dx%d.png" % (layer_name.lower(), w, h)
            img = background(w, h) if draw is None else draw(w, h, diameter)
            os.makedirs(os.path.join(layer_dir, "Content.imageset"), exist_ok=True)
            img.save(os.path.join(layer_dir, "Content.imageset", fname))
            entry = {"filename": fname, "idiom": "tv"}
            if not app_store:
                entry["scale"] = scale
            images.append(entry)
        write_json(os.path.join(layer_dir, "Content.imageset", "Contents.json"), {"images": images, "info": INFO})


def top_shelf(root, name, w1, h1):
    iset = os.path.join(root, name + ".imageset")
    os.makedirs(iset, exist_ok=True)
    images = []
    for scale, w, h in (("1x", w1, h1), ("2x", w1 * 2, h1 * 2)):
        fname = "%s-%dx%d.png" % (name.lower().replace(" ", "-"), w, h)
        flat_mark(w, h, h * 0.55).save(os.path.join(iset, fname))   # RGB: no alpha channel (ITMS-90497)
        images.append({"filename": fname, "idiom": "tv", "scale": scale})
    write_json(os.path.join(iset, "Contents.json"), {"images": images, "info": INFO})


def color_set(root, name, rgb):
    r, g, b = (c / 255 for c in rgb)
    write_json(os.path.join(root, name + ".colorset", "Contents.json"), {
        "colors": [{"idiom": "universal", "color": {"color-space": "srgb", "components": {
            "red": "%.3f" % r, "green": "%.3f" % g, "blue": "%.3f" % b, "alpha": "1.000"}}}],
        "info": INFO})


def main(catalog):
    write_json(os.path.join(catalog, "Contents.json"), {"info": INFO})
    brand = os.path.join(catalog, "App Icon & Top Shelf Image.brandassets")
    write_json(os.path.join(brand, "Contents.json"), {"assets": [
        {"filename": "App Icon - App Store.imagestack", "idiom": "tv", "role": "primary-app-icon", "size": "1280x768"},
        {"filename": "App Icon.imagestack", "idiom": "tv", "role": "primary-app-icon", "size": "400x240"},
        {"filename": "Top Shelf Image Wide.imageset", "idiom": "tv", "role": "top-shelf-image-wide", "size": "2320x720"},
        {"filename": "Top Shelf Image.imageset", "idiom": "tv", "role": "top-shelf-image", "size": "1920x720"},
    ], "info": INFO})
    image_stack(brand, "App Icon", [("1x", 400, 240), ("2x", 800, 480)])
    image_stack(brand, "App Icon - App Store", [("1x", 1280, 768)], app_store=True)
    top_shelf(brand, "Top Shelf Image", 1920, 720)
    top_shelf(brand, "Top Shelf Image Wide", 2320, 720)
    color_set(catalog, "AccentColor", (139, 92, 246))       # #8B5CF6, a little lighter than the ring for focus
    color_set(catalog, "BrandInk", INK)
    color_set(catalog, "BrandPurple", PURPLE)
    color_set(catalog, "BrandLilac", LILAC)
    color_set(catalog, "BrandText", (248, 245, 238))       # #F8F5EE


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
