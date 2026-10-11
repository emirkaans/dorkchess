"""Reshapes two chess glyphs of the bundled font (Noto Sans Symbols 2 subset, OFL):

- king (U+265A): the cross on top becomes a small round knob, the cross cut
  into its body goes, and it is drawn 14% wider (it looked squeezed next to
  the queen);
- bishop (U+265D): the cross cut into its mitre goes.

Run once after replacing public/fonts/chess-glyphs.woff2 with a fresh subset
(the edit is not idempotent):
    python scripts/edit-chess-font.py
It rewrites public/fonts/chess-glyphs.woff2 and scripts/og-assets/chess-glyphs.ttf
(then run `npm run og-assets` so link previews match).
"""

from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import GlyphCoordinates
from fontTools.ttLib.tables.ttProgram import Program

SRC = 'public/fonts/chess-glyphs.woff2'


def contours(glyph, glyf):
    coords, ends, flags = glyph.getCoordinates(glyf)
    out, start = [], 0
    for end in ends:
        out.append([(tuple(coords[i]), flags[i] & 1) for i in range(start, end + 1)])
        start = end + 1
    return out


def store(glyph, glyf, cs):
    glyph.coordinates = GlyphCoordinates([p for c in cs for p, _ in c])
    glyph.flags = bytearray(on for c in cs for _, on in c)
    ends, n = [], 0
    for c in cs:
        n += len(c)
        ends.append(n - 1)
    glyph.endPtsOfContours = ends
    glyph.numberOfContours = len(cs)
    glyph.program = Program()
    glyph.program.fromBytecode(b'')
    glyph.recalcBounds(glyf)


font = TTFont(SRC)
cmap = font.getBestCmap()
glyf = font['glyf']

# --- king ---
king = glyf[cmap[0x265A]]
cs = contours(king, glyf)
outer = cs[0]
# Points 16..27 are the cross (stem with arms, x 442..558, y 636..753); a ball on a short neck replaces them.
knob = [
    ((490, 636), 1),
    ((490, 662), 1),
    ((468, 668), 0),
    ((468, 692), 1),
    ((468, 724), 0),
    ((500, 724), 1),
    ((532, 724), 0),
    ((532, 692), 1),
    ((532, 668), 0),
    ((510, 662), 1),
    ((510, 636), 1),
]
outer = outer[:16] + knob + outer[28:]
# Contours 1 and 2 are the cross cut into the body (x 472..528, y 422..611).
cs = [outer] + cs[3:]
# 14% wider around the glyph's centre line.
cs = [[((round(500 + (x - 500) * 1.14), y), on) for (x, y), on in c] for c in cs]
store(king, glyf, cs)

# --- bishop ---
bishop = glyf[cmap[0x265D]]
cs = contours(bishop, glyf)
# Contour 1 is the cross cut into the mitre (x 403..597, y 292..582).
store(bishop, glyf, [cs[0]] + cs[2:])

font['hmtx'].metrics[cmap[0x265A]] = (font['hmtx'].metrics[cmap[0x265A]][0], king.xMin)
font['hmtx'].metrics[cmap[0x265D]] = (font['hmtx'].metrics[cmap[0x265D]][0], bishop.xMin)

font.flavor = 'woff2'
font.save(SRC)
font.flavor = None
font.save('scripts/og-assets/chess-glyphs.ttf')
print('king bbox', king.xMin, king.yMin, king.xMax, king.yMax, '| bishop contours', bishop.numberOfContours)
