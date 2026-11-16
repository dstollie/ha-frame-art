# ruff: noqa: E501 -- SVG markup reads better on one line per element
"""Writes every Frame Art SVG in ../svg from one set of shapes.

cd docs/brand/tools && uv run --with fonttools python gen.py
"""

import sys
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE.parent / "svg"
OUT.mkdir(exist_ok=True)

C = dict(
    ink="#15171F",
    graphite="#2A2F3D",
    gilt="#E3B341",
    cream="#F6F0E6",
    prussian="#142C78",
    cobalt="#3159D8",
    vermilion="#F2542D",
    saffron="#FFB627",
    viridian="#12A486",
    snow="#FFFFFF",
)

FONTS = Path("/tmp/fa-fonts")
FONT = str(FONTS / "Fraunces.ttf")
if not (FONTS / "Fraunces.ttf").exists() or not (FONTS / "Inter.ttf").exists():
    sys.exit("Put Fraunces.ttf and Inter.ttf (the variable fonts from github.com/google/fonts, ofl/) in /tmp/fa-fonts")
from wordmark_paths import text_path  # noqa: E402


def svg(w, h, body, defs=""):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">'
        f"<defs>{defs}</defs>{body}</svg>\n"
    )


def sky(id_):
    return f'<linearGradient id="{id_}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{C["prussian"]}"/><stop offset="1" stop-color="{C["cobalt"]}"/></linearGradient>'


def mountain_a(cx, base, h):
    """The A-shaped mountain: apex at (cx, base-h), legs on base. Scales from the 256 icon (h=130)."""
    s = h / 130

    def p(x, y):
        return f"{cx + x * s:.2f} {base + y * s:.2f}"

    body = (
        f"M{p(-68, 0)} L{p(0, -130)} L{p(68, 0)} H{p(32, 0).split()[0]} L{p(22, -22)} H{p(-22, -22).split()[0]} L{p(-32, 0)} Z "
        f"M{p(-13, -44)} H{p(13, -44).split()[0]} L{p(0, -72)} Z"
    )
    snow = f"M{p(0, -130)} L{p(-17, -98)} L{p(-7, -104)} L{p(0, -96)} L{p(7, -104)} L{p(17, -98)} Z"
    return f'<path fill-rule="evenodd" fill="{C["vermilion"]}" d="{body}"/><path fill="{C["snow"]}" d="{snow}"/>'


def mark(bezel, uid="m"):
    defs = sky(f"{uid}s") + f'<clipPath id="{uid}w"><rect x="54" y="54" width="148" height="148" rx="5"/></clipPath>'
    body = (
        f'<rect x="8" y="8" width="240" height="240" rx="36" fill="{bezel}"/>'
        f'<rect x="25" y="25" width="206" height="206" rx="22" fill="{C["gilt"]}"/>'
        f'<rect x="31" y="31" width="194" height="194" rx="18" fill="{C["cream"]}"/>'
        f'<g clip-path="url(#{uid}w)"><rect x="54" y="54" width="148" height="148" fill="url(#{uid}s)"/>'
        f'<circle cx="170" cy="90" r="17" fill="{C["saffron"]}"/>{mountain_a(128, 202, 130)}'
        f'<rect x="54" y="191" width="148" height="11" fill="{C["viridian"]}"/></g>'
    )
    return defs, body


def mark_mono():
    # one colour (currentColor): frame ring, window, A-mountain cut out, sun
    d = (
        "M44 8H212A36 36 0 0 1 248 44V212A36 36 0 0 1 212 248H44A36 36 0 0 1 8 212V44A36 36 0 0 1 44 8Z "
        "M54 54V202H202V54Z"
    )
    return (
        f'<path fill="currentColor" fill-rule="evenodd" d="{d}"/>'
        f'<circle cx="170" cy="90" r="17" fill="currentColor"/>'
        f'<path fill="currentColor" fill-rule="evenodd" d="M60 202 L128 72 L196 202 H160 L150 180 H106 L96 202 Z M115 158 H141 L128 130 Z"/>'
    )


WM = text_path(FONT, {"wght": 720, "opsz": 96, "SOFT": 30, "WONK": 0}, "Frame Art", 100, -2)


def wordmark(fill, x=0, y=0, size=100):
    d, (x0, y0, x1, y1), _ = WM
    s = size / 100
    return (
        f'<path fill="{fill}" transform="translate({x - x0 * s:.2f} {y - y0 * s:.2f}) scale({s})" d="{d}"/>',
        (x1 - x0) * s,
        (y1 - y0) * s,
    )


def write(name, content):
    (OUT / name).write_text(content)


# marks
for name, bezel in (("mark", C["ink"]), ("mark-dark", C["graphite"])):
    defs, body = mark(bezel)
    write(f"{name}.svg", svg(256, 256, body, defs))
write("mark-mono.svg", svg(256, 256, mark_mono()))

# wordmarks and lockups
# "-any": readable on light and dark (the add-on store has no dark variant)
for suffix, fill, bezel in (
    ("", C["ink"], C["ink"]),
    ("-dark", C["cream"], C["graphite"]),
    ("-any", C["cobalt"], C["ink"]),
):
    path, w, h = wordmark(fill)
    write(f"wordmark{suffix}.svg", svg(round(w), round(h), path))
    defs, body = mark(bezel)
    _, w, h = wordmark(fill, size=150)
    path, w, h = wordmark(fill, x=256 + 56, y=(256 - h) / 2, size=150)
    write(f"lockup{suffix}.svg", svg(round(256 + 56 + w), 256, body + path, defs))


# the scene on a 16:9 Frame, reused by banners and the social preview
def tv_scene(x, y, w, uid, bezel=C["ink"]):
    h = w * 9 / 16
    bez = w * 0.022
    mat = w * 0.07
    ix, iy, iw, ih = x + bez + mat, y + bez + mat, w - 2 * (bez + mat), h - 2 * (bez + mat)
    base = iy + ih
    mh = ih * 0.74
    sun_r = ih * 0.11
    defs = (
        sky(f"{uid}s")
        + f'<clipPath id="{uid}c"><rect x="{ix:.1f}" y="{iy:.1f}" width="{iw:.1f}" height="{ih:.1f}"/></clipPath>'
    )
    hills = (
        f'<path fill="{C["prussian"]}" opacity=".55" d="M{ix:.1f} {base - ih * 0.30:.1f} Q{ix + iw * 0.18:.1f} {base - ih * 0.46:.1f} {ix + iw * 0.36:.1f} {base - ih * 0.22:.1f} L{ix + iw * 0.36:.1f} {base:.1f} H{ix:.1f}Z"/>'
        f'<path fill="{C["prussian"]}" opacity=".55" d="M{ix + iw * 0.62:.1f} {base - ih * 0.22:.1f} Q{ix + iw * 0.84:.1f} {base - ih * 0.52:.1f} {ix + iw:.1f} {base - ih * 0.34:.1f} L{ix + iw:.1f} {base:.1f} H{ix + iw * 0.62:.1f}Z"/>'
    )
    defs += f'<filter id="{uid}b" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur stdDeviation="{w * 0.018:.1f}"/></filter>'
    body = (
        f'<rect x="{x + w * 0.01:.1f}" y="{y + h * 0.05:.1f}" width="{w:.1f}" height="{h:.1f}" fill="#000" opacity=".45" filter="url(#{uid}b)"/>'
        f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{w * 0.004:.1f}" fill="{bezel}"/>'
        f'<rect x="{x + bez:.1f}" y="{y + bez:.1f}" width="{w - 2 * bez:.1f}" height="{h - 2 * bez:.1f}" fill="{C["cream"]}"/>'
        f'<g clip-path="url(#{uid}c)"><rect x="{ix:.1f}" y="{iy:.1f}" width="{iw:.1f}" height="{ih:.1f}" fill="url(#{uid}s)"/>'
        f'<circle cx="{ix + iw * 0.70:.1f}" cy="{iy + ih * 0.27:.1f}" r="{sun_r:.1f}" fill="{C["saffron"]}"/>{hills}'
        f"{mountain_a(ix + iw / 2, base, mh)}"
        f'<rect x="{ix:.1f}" y="{base - ih * 0.075:.1f}" width="{iw:.1f}" height="{ih * 0.075 + 1:.1f}" fill="{C["viridian"]}"/></g>'
    )
    return defs, body


def tagline_path(text, fill, x, y, size, wght=500):
    d, (x0, y0, x1, y1), _ = text_path(str(FONTS / "Inter.ttf"), {"wght": wght, "opsz": 14}, text, size, 0)
    return f'<path fill="{fill}" transform="translate({x - x0:.2f} {y:.2f})" d="{d}"/>', x1 - x0


def banner(
    W,
    H,
    theme,
    name,
    lines=("Open museum art for your Samsung Frame,", "right from Home Assistant."),
    chips=("Add-on", "Integration", "MCP", "Open art"),
    kicker=None,
):
    bg, fg, muted = (C["cream"], C["ink"], "#5B5F6B") if theme == "light" else ("#101219", C["cream"], "#A9ADB8")
    wall = f'<rect width="{W}" height="{H}" fill="{bg}"/><rect width="{W}" height="{H}" fill="url(#glow)"/>'
    glow = f'<radialGradient id="glow" cx="0.72" cy="0.45" r="0.6"><stop offset="0" stop-color="{C["saffron"]}" stop-opacity="{0.16 if theme == "light" else 0.10}"/><stop offset="1" stop-color="{C["saffron"]}" stop-opacity="0"/></radialGradient>'
    tw = W * 0.43
    tx = W - tw - W * 0.06
    ty = (H - tw * 9 / 16) / 2 - H * 0.02
    d2, b2 = tv_scene(tx, ty, tw, "t", C["ink"] if theme == "light" else "#3A4052")
    left = W * 0.065
    wm, ww, wh = wordmark(fg, x=left, y=H * 0.30, size=W * 0.075)
    parts = [wall, b2, wm]
    if kicker:
        k, _ = tagline_path(kicker, C["vermilion"], left + W * 0.003, H * 0.30 - H * 0.045, W * 0.016, 700)
        parts.append(k)
    p, _ = tagline_path(lines[0], muted, left, H * 0.30 + wh + H * 0.12, W * 0.0205)
    p2, _ = tagline_path(lines[1], muted, left, H * 0.30 + wh + H * 0.12 + W * 0.031, W * 0.0205)
    parts += [p, p2]
    if chips:
        cx = left
        cy = H * 0.30 + wh + H * 0.12 + W * 0.031 + H * 0.12
        for i, t in enumerate(chips):
            col = [C["vermilion"], C["cobalt"], C["viridian"], C["saffron"]][i]
            p, tw2 = tagline_path(t, fg, 0, 0, W * 0.0135, 600)
            padx = W * 0.012
            hh = W * 0.0135 * 2.1
            parts.append(
                f'<g transform="translate({cx:.1f} {cy:.1f})"><rect width="{tw2 + 2 * padx + hh * 0.75:.1f}" height="{hh:.1f}" rx="{hh / 2:.1f}" fill="{fg}" opacity=".07"/>'
                f'<circle cx="{padx + hh * 0.18:.1f}" cy="{hh / 2:.1f}" r="{hh * 0.16:.1f}" fill="{col}"/>'
                + p.replace("translate(", f"translate({padx + hh * 0.62:.1f} {hh * 0.70:.1f}) translate(", 1).replace(
                    f"translate({-0:.2f}", "translate(0", 1
                )
                + "</g>"
            )
            cx += tw2 + 2 * padx + hh * 0.75 + W * 0.008
    write(name, svg(W, H, "".join(parts), glow + d2))


banner(1280, 640, "dark", "social-preview.svg")
COLL = dict(
    lines=("Free, openly licensed art for your Frame.", "Curated by the community. Add yours."),
    chips=("Public domain", "CC0 / CC BY", "4K", "JSON"),
    kicker="COLLECTIONS",
)
banner(1280, 640, "dark", "collections-social-preview.svg", **COLL)
banner(1600, 560, "light", "collections-banner-light.svg", **COLL)
banner(1600, 560, "dark", "collections-banner-dark.svg", **COLL)
banner(1600, 560, "light", "banner-light.svg")
banner(1600, 560, "dark", "banner-dark.svg")

# favicon: mark without the gilt fillet detail at tiny sizes
defs, body = mark(C["ink"], "f")
write("favicon.svg", svg(256, 256, body, defs))
print("ok", sorted(p.name for p in OUT.iterdir()))
