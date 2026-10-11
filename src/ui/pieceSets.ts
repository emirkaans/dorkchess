import { useSyncExternalStore } from 'react';

/**
 * Drawn piece sets. 'glyph' is the font (the chess symbols); every other set
 * draws the six standard pieces as SVG in a 100×100 box. The drawings take
 * their colours from the piece theme through CSS (fill, stroke, --line, --accent),
 * so any set works with any piece theme.
 */
export const PIECE_SETS = [
  'glyph',
  'sablon',
  'mohawk',
  'zimbali',
  'damla',
  'rozet',
  'kirik',
  'kafatasi',
  'tup',
  'piksel',
  'firca',
] as const;
export type PieceSet = (typeof PIECE_SETS)[number];
type Drawn = Exclude<PieceSet, 'glyph'>;
type Kind = 'k' | 'q' | 'r' | 'b' | 'n' | 'p';

const LINE = 'style="fill: var(--line); stroke: none"';
const ACCENT = 'style="fill: var(--accent)"';
const FACET = 'style="fill: none; stroke: var(--line); stroke-width: 1.6; opacity: .55"';

const studs = (points: [number, number][]) =>
  points.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" ${LINE}/>`).join('');
const studBase = `<rect x="22" y="78" width="56" height="12" rx="3"/>${studs([
  [30, 84],
  [40, 84],
  [50, 84],
  [60, 84],
  [70, 84],
])}`;
const dripBase =
  '<path d="M22 72 H78 V82 Q78 86 75 86 Q72 86 72 82 V80 H62 V90 Q62 95 58 95 Q54 95 54 90 V80 H40 V86 Q40 89 37 89 Q34 89 34 86 V80 H28 V84 Q28 88 25 88 Q22 88 22 84 Z"/>';
const badge =
  '<circle cx="50" cy="52" r="42" style="fill: rgba(0,0,0,.35); stroke: none"/><circle cx="50" cy="50" r="42"/><circle cx="50" cy="50" r="35" style="fill: none; stroke: var(--accent); stroke-width: 3; stroke-dasharray: 6 4"/>';
/** A small silhouette drawn inside the badge in the line colour. */
const inBadge = (inner: string) =>
  `${badge}<g transform="translate(25 23) scale(.5)" style="fill: var(--line); stroke: none">${inner}</g>`;
const skull = `<rect x="26" y="80" width="48" height="10" rx="2"/><rect x="42" y="68" width="16" height="12"/><path d="M30 48 Q30 22 50 22 Q70 22 70 48 Q70 57 62 59 L62 70 L38 70 L38 59 Q30 57 30 48 Z"/><circle cx="42" cy="45" r="5.5" ${LINE}/><circle cx="58" cy="45" r="5.5" ${LINE}/><polygon points="50,51 46.5,58 53.5,58" ${LINE}/><path d="M44 63 V70 M50 63 V70 M56 63 V70" style="fill: none; stroke: var(--line); stroke-width: 1.6"/>`;
const hat = (shape: string) => skull + shape.replace('/>', ` ${ACCENT}/>`);

const DRAWINGS: Record<Drawn, Record<Kind, string>> = {
  // Cut like a spray stencil: the parts stand apart.
  sablon: {
    k: '<rect x="24" y="80" width="52" height="10"/><polygon points="32,76 36,42 64,42 68,76"/><rect x="30" y="32" width="40" height="6"/><polygon points="30,28 30,10 40,18 50,6 60,18 70,10 70,28"/>',
    q: '<rect x="24" y="80" width="52" height="10"/><polygon points="34,76 40,42 60,42 66,76"/><rect x="32" y="32" width="36" height="6"/><polygon points="30,28 24,12 40,20 50,6 60,20 76,12 70,28"/>',
    r: '<rect x="24" y="80" width="52" height="10"/><rect x="32" y="40" width="36" height="36"/><rect x="28" y="26" width="44" height="10"/><rect x="28" y="12" width="10" height="10"/><rect x="45" y="12" width="10" height="10"/><rect x="62" y="12" width="10" height="10"/>',
    b: '<rect x="24" y="80" width="52" height="10"/><polygon points="36,76 40,54 60,54 64,76"/><polygon points="38,48 40,30 47,18 47,40 53,40 53,18 60,30 62,48"/><circle cx="50" cy="10" r="4"/>',
    n: '<rect x="24" y="80" width="52" height="10"/><polygon points="30,76 34,58 26,50 30,38 44,22 50,22 52,76"/><polygon points="56,76 56,20 62,22 74,32 76,46 68,48 62,44 60,52 64,76"/>',
    p: '<rect x="28" y="80" width="44" height="10"/><polygon points="36,76 42,52 58,52 64,76"/><rect x="36" y="44" width="28" height="5"/><circle cx="50" cy="28" r="11"/>',
  },
  // Rounded bodies, each with a crest.
  mohawk: {
    k: `<polygon points="38,28 40,4 45,20 50,0 55,20 60,4 62,28" ${ACCENT}/><rect x="24" y="80" width="52" height="10" rx="4"/><rect x="34" y="42" width="32" height="38" rx="8"/><rect x="37" y="26" width="26" height="18" rx="7"/><rect x="34" y="54" width="32" height="6" ${ACCENT}/>`,
    q: `<polygon points="36,34 36,10 43,26 50,4 57,26 64,10 64,34" ${ACCENT}/><rect x="24" y="80" width="52" height="10" rx="4"/><path d="M34 80 L39 48 Q50 42 61 48 L66 80 Z"/><circle cx="50" cy="38" r="11"/>`,
    r: `<polygon points="32,38 33,16 39,32 44,12 50,32 56,12 61,32 67,16 68,38" ${ACCENT}/><rect x="24" y="80" width="52" height="10" rx="4"/><rect x="32" y="34" width="36" height="46" rx="6"/>`,
    b: `<polygon points="44,40 50,4 56,40" ${ACCENT}/><rect x="24" y="80" width="52" height="10" rx="4"/><path d="M38 80 L42 70 Q30 56 36 44 Q42 32 50 32 Q58 32 64 44 Q70 56 58 70 L62 80 Z"/>`,
    n: `<polygon points="46,30 40,12 50,22 52,6 58,22 66,10 66,28 72,22 70,36" ${ACCENT}/><rect x="24" y="80" width="52" height="10" rx="4"/><path d="M32 80 L34 60 Q24 52 30 40 Q38 26 54 24 Q70 26 76 44 L68 50 Q60 44 56 52 Q62 64 64 80 Z"/><circle cx="54" cy="38" r="3" ${LINE}/>`,
    p: `<polygon points="42,32 43,16 47,28 50,10 53,28 57,16 58,32" ${ACCENT}/><rect x="28" y="80" width="44" height="10" rx="4"/><path d="M36 80 Q36 58 50 54 Q64 58 64 80 Z"/><circle cx="50" cy="42" r="12"/>`,
  },
  // Chunky, with studs.
  zimbali: {
    k: `${studBase}<rect x="30" y="36" width="40" height="42" rx="2"/><rect x="32" y="18" width="36" height="18"/><circle cx="36" cy="13" r="4.5" ${ACCENT}/><circle cx="50" cy="9" r="4.5" ${ACCENT}/><circle cx="64" cy="13" r="4.5" ${ACCENT}/>${studs(
      [
        [40, 56],
        [50, 56],
        [60, 56],
      ],
    )}`,
    q: `${studBase}<polygon points="32,78 38,38 62,38 68,78"/><polygon points="30,38 26,16 40,28 50,12 60,28 74,16 70,38"/><circle cx="26" cy="14" r="4.5" ${ACCENT}/><circle cx="50" cy="10" r="4.5" ${ACCENT}/><circle cx="74" cy="14" r="4.5" ${ACCENT}/>`,
    r: `${studBase}<rect x="30" y="32" width="40" height="46"/><rect x="26" y="16" width="48" height="16"/>${studs([
      [34, 24],
      [50, 24],
      [66, 24],
    ])}`,
    b: `${studBase}<polygon points="34,78 40,40 50,14 60,40 66,78"/>${studs([
      [50, 40],
      [50, 52],
      [50, 64],
    ])}`,
    n: `${studBase}<polygon points="28,78 30,58 24,48 30,32 48,18 62,20 76,36 72,46 62,42 58,50 66,78"/>${studs([
      [40, 30],
      [34, 40],
      [32, 52],
    ])}<circle cx="58" cy="30" r="3" ${LINE}/>`,
    p: `${studBase}<polygon points="36,78 40,52 60,52 64,78"/><rect x="36" y="48" width="28" height="6"/><circle cx="50" cy="34" r="14"/>`,
  },
  // Paint running off the base and the crowns.
  damla: {
    k: `${dripBase}<path d="M36 72 L37 42 H63 L64 72 Z"/><path d="M32 42 L30 16 L40 26 L50 12 L60 26 L70 16 L68 42 Z"/><path d="M40 42 V48 Q40 51 42.5 51 Q45 51 45 48 V42 M56 42 V52 Q56 55 58.5 55 Q61 55 61 52 V42"/>`,
    q: `${dripBase}<path d="M36 72 L40 40 H60 L64 72 Z"/><path d="M36 14 Q43 26 43 31 Q43 37 36 37 Q29 37 29 31 Q29 26 36 14 Z"/><path d="M50 8 Q57 20 57 25 Q57 31 50 31 Q43 31 43 25 Q43 20 50 8 Z"/><path d="M64 14 Q71 26 71 31 Q71 37 64 37 Q57 37 57 31 Q57 26 64 14 Z"/>`,
    r: `${dripBase}<rect x="32" y="34" width="36" height="38"/><path d="M28 20 H72 V34 H62 V40 Q62 43 59.5 43 Q57 43 57 40 V34 H40 V38 Q40 41 37.5 41 Q35 41 35 38 V34 H28 Z"/><rect x="28" y="10" width="10" height="10"/><rect x="45" y="10" width="10" height="10"/><rect x="62" y="10" width="10" height="10"/>`,
    b: `${dripBase}<rect x="42" y="58" width="16" height="14"/><path d="M50 8 Q66 32 63 48 Q61 60 50 60 Q39 60 37 48 Q34 32 50 8 Z"/>`,
    n: `${dripBase}<path d="M30 72 L34 54 Q24 46 32 34 Q42 18 60 18 Q74 22 76 40 L70 46 Q62 40 58 48 L64 72 Z"/><path d="M66 44 V52 Q66 55 68.5 55 Q71 55 71 52 V42"/>`,
    p: `${dripBase}<path d="M38 72 L42 50 H58 L62 72 Z"/><circle cx="50" cy="36" r="13"/>`,
  },
  // Pin badges.
  rozet: {
    k: inBadge(
      '<rect x="24" y="80" width="52" height="10"/><rect x="32" y="40" width="36" height="36"/><polygon points="30,34 30,10 40,20 50,6 60,20 70,10 70,34"/>',
    ),
    q: inBadge(
      '<rect x="24" y="80" width="52" height="10"/><polygon points="34,76 40,40 60,40 66,76"/><polygon points="28,34 22,10 38,22 50,4 62,22 78,10 72,34"/>',
    ),
    r: inBadge(
      '<rect x="24" y="80" width="52" height="10"/><rect x="32" y="36" width="36" height="40"/><polygon points="26,32 26,10 38,10 38,20 45,20 45,10 55,10 55,20 62,20 62,10 74,10 74,32"/>',
    ),
    b: inBadge(
      '<rect x="24" y="80" width="52" height="10"/><polygon points="38,76 42,60 58,60 62,76"/><path d="M50 6 Q70 32 64 48 Q60 56 50 56 Q40 56 36 48 Q30 32 50 6 Z"/>',
    ),
    n: inBadge(
      '<rect x="24" y="80" width="52" height="10"/><polygon points="30,76 34,56 24,48 30,32 46,16 60,16 76,34 74,46 62,42 58,50 64,76"/>',
    ),
    p: inBadge(
      '<rect x="28" y="80" width="44" height="10"/><polygon points="36,76 42,48 58,48 64,76"/><circle cx="50" cy="30" r="14"/>',
    ),
  },
  // Angular shards with facet lines.
  kirik: {
    k: `<polygon points="28,90 34,78 36,40 28,32 34,10 50,22 66,10 72,32 64,40 66,78 72,90"/><path d="M34,10 42,32 50,22 58,32 66,10 M36,40 50,56 64,40 M50,56 40,90 M50,56 62,90" ${FACET}/>`,
    q: `<polygon points="26,90 32,78 38,40 22,14 42,30 50,6 58,30 78,14 62,40 68,78 74,90"/><path d="M42,30 50,48 58,30 M38,40 50,48 62,40 M50,48 44,90" ${FACET}/>`,
    r: `<polygon points="26,90 32,78 34,36 26,12 40,18 50,10 60,18 74,12 66,36 68,78 74,90"/><path d="M34,36 50,28 66,36 M50,28 46,60 58,90 M46,60 32,78" ${FACET}/>`,
    b: `<polygon points="28,90 36,76 42,56 34,34 50,6 66,34 58,56 64,76 72,90"/><path d="M50,6 46,34 58,56 M46,34 34,34 M42,56 50,64 58,56 M50,64 46,90" ${FACET}/>`,
    n: `<polygon points="26,90 32,78 36,56 24,44 36,24 58,10 78,32 70,44 58,40 54,52 62,78 70,90"/><path d="M58,10 52,30 70,44 M52,30 36,24 M52,30 44,48 54,52 M44,48 40,90" ${FACET}/><polygon points="58,26 64,28 60,32" ${LINE}/>`,
    p: `<polygon points="30,90 38,78 42,50 36,40 40,24 50,16 60,24 64,40 58,50 62,78 70,90"/><path d="M50,16 46,34 64,40 M46,34 36,40 M42,50 54,66 58,50 M54,66 48,90" ${FACET}/>`,
  },
  // Skulls; the headgear tells the pieces apart.
  kafatasi: {
    k: `${hat('<path d="M33 28 L32 6 L41 14 L50 4 L59 14 L68 6 L67 28 Z"/>')}<rect x="45" y="14" width="10" height="8" ${LINE}/>`,
    q: `${hat('<path d="M33 28 L28 12 L40 20 L50 8 L60 20 L72 12 L67 28 Z"/>')}<circle cx="28" cy="10" r="3.5" ${ACCENT}/><circle cx="50" cy="6" r="3.5" ${ACCENT}/><circle cx="72" cy="10" r="3.5" ${ACCENT}/>`,
    r: hat('<path d="M30 28 V10 H39 V17 H45 V10 H55 V17 H61 V10 H70 V28 Z"/>'),
    b: `${hat('<path d="M35 30 Q38 12 50 2 Q62 12 65 30 Z"/>')}<path d="M46 12 L54 22" style="fill: none; stroke: var(--line); stroke-width: 3"/>`,
    n: hat('<polygon points="38,28 38,10 43,20 47,4 50,18 53,4 57,20 62,10 62,28"/>'),
    p: skull,
  },
  // Neon tubes: lines only.
  tup: {
    k: '<path d="M28 88 H72 M37 88 V44 H63 V88 M35 44 L33 14 L43 24 L50 12 L57 24 L67 14 L65 44 M43 60 H57"/>',
    q: '<path d="M28 88 H72 M36 88 L40 44 H60 L64 88 M40 44 L28 16 L42 30 L50 10 L58 30 L72 16 L60 44"/><circle cx="28" cy="12" r="3"/><circle cx="50" cy="6" r="3"/><circle cx="72" cy="12" r="3"/>',
    r: '<path d="M28 88 H72 M36 88 V38 H64 V88 M32 38 V14 H41 V22 H46 V14 H54 V22 H59 V14 H68 V38"/>',
    b: '<path d="M30 88 H70 M40 88 L42 66 H58 L60 88 M42 66 Q30 50 40 34 Q46 24 50 18 Q54 24 60 34 Q70 50 58 66 M46 40 L56 30"/><circle cx="50" cy="11" r="4"/>',
    n: '<path d="M28 88 H72 M36 88 L38 64 Q26 56 32 40 Q40 22 58 18 Q74 22 76 42 L68 46 Q60 40 56 50 Q60 66 62 88"/><circle cx="56" cy="32" r="2.5"/>',
    p: '<path d="M32 88 H68 M40 88 Q42 62 50 56 Q58 62 60 88"/><circle cx="50" cy="40" r="13"/>',
  },
  // 8-bit pixels.
  piksel: {
    k: `<path d="M42 10h16v8h-16z M26 18h48v8h-48z M18 26h64v16h-64z M26 42h48v24h-48z M18 66h64v8h-64z M10 74h80v16h-80z"/><rect x="42" y="26" width="16" height="8" ${ACCENT}/>`,
    q: `<path d="M18 10h8v8h-8z M42 10h16v8h-16z M74 10h8v8h-8z M18 18h16v8h-16z M42 18h16v8h-16z M66 18h16v8h-16z M18 26h64v8h-64z M26 34h48v16h-48z M34 50h32v16h-32z M26 66h48v8h-48z M18 74h64v16h-64z"/><rect x="46" y="10" width="8" height="8" ${ACCENT}/>`,
    r: '<path d="M18 18h16v8h-16z M42 18h16v8h-16z M66 18h16v8h-16z M18 26h64v8h-64z M26 34h48v32h-48z M18 66h64v8h-64z M10 74h80v16h-80z"/>',
    b: '<path d="M42 10h16v8h-16z M34 18h32v8h-32z M26 26h48v8h-48z M26 34h24v8h-24z M58 34h16v8h-16z M26 42h48v8h-48z M34 50h32v8h-32z M42 58h16v8h-16z M26 66h48v8h-48z M18 74h64v16h-64z"/>',
    n: `<path d="M42 10h16v8h-16z M34 18h40v8h-40z M26 26h56v8h-56z M18 34h64v8h-64z M18 42h24v8h-24z M50 42h32v8h-32z M50 50h32v8h-32z M42 58h40v8h-40z M34 66h48v8h-48z M18 74h64v16h-64z"/><rect x="34" y="26" width="8" height="8" ${ACCENT}/>`,
    p: '<path d="M42 18h16v8h-16z M34 26h32v16h-32z M42 42h16v8h-16z M34 50h32v16h-32z M26 66h48v8h-48z M18 74h64v16h-64z"/>',
  },
  // Thick brush strokes (drawn twice: an outline, then the colour).
  firca: {
    k: '<path d="M30 86 H70 M40 78 V44 H60 V78 M36 34 L32 14 L44 24 L50 10 L56 24 L68 14 L64 34 Z"/>',
    q: '<path d="M30 86 H70 M40 76 L34 32 M60 76 L66 32 M34 32 Q50 46 66 32"/><circle cx="32" cy="20" r="3"/><circle cx="50" cy="14" r="3"/><circle cx="68" cy="20" r="3"/>',
    r: '<path d="M30 86 H70 M38 76 V40 M62 76 V40 M34 32 H66 M34 30 V16 M50 30 V16 M66 30 V16"/>',
    b: '<path d="M32 86 H68 M50 72 Q32 50 50 24 Q68 50 50 72 Z M50 12 V12"/>',
    n: '<path d="M30 86 H70 M40 76 Q38 58 30 50 Q38 26 62 22 Q74 32 70 44 Q60 40 56 50 Q60 64 62 76"/>',
    p: '<path d="M34 86 H66 M50 74 V58"/><circle cx="50" cy="40" r="11"/>',
  },
};

const KIND_OF_GLYPH: Record<string, Kind> = { '♚': 'k', '♛': 'q', '♜': 'r', '♝': 'b', '♞': 'n', '♟': 'p' };

/** The SVG of a standard piece in `set`, or null when the set (or the glyph) has no drawing. */
export function pieceSvg(set: PieceSet, glyph: string): string | null {
  if (set === 'glyph') return null;
  const kind = KIND_OF_GLYPH[glyph.charAt(0)];
  if (!kind) return null;
  const body = DRAWINGS[set][kind];
  const inner = set === 'firca' ? `<g class="o">${body}</g><g class="m">${body}</g>` : body;
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${inner}</svg>`;
}

// The chosen set, shared with every piece on the page (set from the prefs).
let current: PieceSet = 'glyph';
const listeners = new Set<() => void>();

export function setPieceSet(set: PieceSet): void {
  if (set === current) return;
  current = set;
  for (const l of listeners) l();
}

export function usePieceSet(): PieceSet {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}
