"""Turns a line of text in a variable font into one SVG path, so the SVGs need no fonts."""

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer


def text_path(fontfile, axes, text, size, tracking=0):
    font = instancer.instantiateVariableFont(TTFont(fontfile), axes)
    glyphs, cmap, hmtx = font.getGlyphSet(), font.getBestCmap(), font["hmtx"]
    scale = size / font["head"].unitsPerEm
    pen, bounds = SVGPathPen(glyphs), BoundsPen(glyphs)
    x = 0
    for ch in text:
        name = cmap[ord(ch)]
        for target in (pen, bounds):
            glyphs[name].draw(TransformPen(target, (scale, 0, 0, -scale, x, 0)))
        x += hmtx[name][0] * scale + tracking
    return pen.getCommands(), bounds.bounds, x
