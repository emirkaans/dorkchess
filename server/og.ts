// Link previews for game addresses (/<id>, /<id>/analysis): the page gets
// Open Graph / Twitter tags (title, text, image) and /og/<id>.png draws the
// game's position. Texts are Turkish, the site's main language.

import { getVariant } from '../src/engine/index.ts';
import { translateOr, translator } from '../src/i18n/index.ts';
import { playerText } from '../src/i18n/records.ts';
import { variantTexts } from '../src/i18n/variant.ts';
import { statesOfRecord } from '../src/online/record.ts';
import type { GameRecord } from '../src/online/record.ts';
import { FRAME, SPRITES } from './og-assets.ts';
import { OG_H, OG_W, composeBoard, encodePng, unpackAssets } from './og-image.ts';
import type { OgAssets } from './og-image.ts';

const t = translator('tr');

let assets: Promise<OgAssets> | null = null;
const loadAssets = () => (assets ??= unpackAssets(FRAME, SPRITES));

/** Changes whenever the picture would: number of moves and the result. */
export const previewVersion = (r: GameRecord) => `${r.moves.length}-${r.result.replace('/', '_')}`;

/** The picture of the game's current position (last move tinted). */
export async function renderPreview(r: GameRecord): Promise<Uint8Array> {
  const states = statesOfRecord(r);
  const last = states[states.length - 1];
  const move = last.moves.at(-1)?.move ?? null;
  return encodePng(composeBoard(await loadAssets(), last.position.board, move), OG_W, OG_H);
}

/** Title and description of a game's link preview. */
export function previewTexts(r: GameRecord): { title: string; description: string } {
  const variant = variantTexts(getVariant(r.variantId), 'tr').name;
  const white = playerText(r.white || 'human', t);
  const black = playerText(r.black || 'human', t);
  const moves = Math.ceil(r.moves.length / 2);
  const result =
    r.result === '*'
      ? 'Oyun devam ediyor'
      : r.result === '1/2-1/2'
        ? 'Berabere'
        : `${r.result === '1-0' ? 'Beyaz' : 'Siyah'} kazandı`;
  // A reason this server does not know (an older or newer record) is shown as it is.
  const end = r.termination ? ` (${translateOr(t, `termination.${r.termination}`, r.termination)})` : '';
  return {
    title: `${white} – ${black} · ${variant} · punkchess`,
    description: `${result}${r.result === '*' ? '' : end} · ${moves} hamle. Tahtada aç, analiz et.`,
  };
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Meta tags for a game page (the default tags of index.html are removed first). */
export function previewTags(r: GameRecord, pageUrl: string, imageUrl: string): string {
  const { title, description } = previewTexts(r);
  const tags: [string, string, string][] = [
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', 'punkchess'],
    ['property', 'og:title', title],
    ['property', 'og:description', description],
    ['property', 'og:url', pageUrl],
    ['property', 'og:image', imageUrl],
    ['property', 'og:image:width', String(OG_W)],
    ['property', 'og:image:height', String(OG_H)],
    ['name', 'twitter:card', 'summary_large_image'],
    ['name', 'twitter:title', title],
    ['name', 'twitter:description', description],
    ['name', 'twitter:image', imageUrl],
    ['name', 'description', description],
  ];
  return tags.map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escape(value)}">`).join('');
}
