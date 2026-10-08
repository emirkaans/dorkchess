import type { Color } from '../types.ts';

/**
 * Helpers for SVG piece icons drawn in the language of the Unicode glyph
 * pieces: solid silhouettes, thin cut-out lines (fill-rule evenodd), stepped
 * slab base. Coordinates are font units (2048/em, baseline at y = 1872) so a
 * drawing lines up with a text glyph. The UI draws SVG icons at 84% of the
 * square while glyphs fill 80%, so the viewBox is padded by 84/80 to keep the
 * drawing the same size as a glyph.
 */

/** Stepped slab base shared by the custom pieces (pawn/rook proportions). */
export const SLAB_BASE =
  'M450 1833 H1598 V1732 A40 40 0 0 0 1558 1692 H490 A40 40 0 0 0 450 1732 V1833 Z M560 1652 L1488 1652 L1488 1552 L560 1552 Z';

/** Matches the glyph styling: white has a dark outline and soft shadow, black a faint highlight. */
const STYLE: Record<Color, { paint: string; shadow: string }> = {
  w: {
    paint: 'fill="#fafafa" stroke="#222" stroke-width="2" vector-effect="non-scaling-stroke" paint-order="stroke"',
    shadow: 'drop-shadow(0 2px 3px rgba(0,0,0,.35))',
  },
  b: { paint: 'fill="#222"', shadow: 'drop-shadow(0 1px 0 rgba(255,255,255,.35))' },
};

/** Builds a per-color SVG icon from evenodd path data. */
export const glyphStyleSvg = (paths: readonly string[]) => (c: Color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-51.2 -51.2 2150.4 2150.4" style="overflow:visible;filter:${STYLE[c].shadow}">` +
  paths.map((d) => `<path fill-rule="evenodd" ${STYLE[c].paint} d="${d}"/>`).join('') +
  '</svg>';
