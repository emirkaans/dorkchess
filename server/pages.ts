// Link previews of the site's pages (a profile, the daily puzzle, puzzles,
// Puzzle Rush, the leaderboard): the app page with its own title,
// description and preview tags, so a shared link shows what it is. Also the
// sitemap for search engines.

import { dailyDay, dailyNumber } from '../src/online/daily.ts';
import type { AuthEnv } from './auth.ts';
import { metaTags } from './og.ts';

interface Preview {
  readonly title: string;
  readonly description: string;
}

const STATIC: Readonly<Record<string, Preview>> = {
  '/puzzles': {
    title: 'Bulmacalar · punkchess',
    description: 'Seviyene göre satranç bulmacaları: mat, çatal, açmaz, kurban. Bulmaca puanını yükselt.',
  },
  '/rush': {
    title: 'Puzzle Rush · punkchess',
    description: '3 dakikada olabildiğince çok bulmaca çöz; gittikçe zorlaşır, 3 yanlışta biter.',
  },
  '/leaderboard': {
    title: 'Liderler · punkchess',
    description: 'Her kategorinin en iyileri: bullet, blitz, rapid, klasik, varyantlar ve bulmacalar.',
  },
  '/analysis': {
    title: 'Analiz tahtası · punkchess',
    description: 'Konum kur, oyna, Stockfish ile analiz et. Varyantlar da dahil.',
  },
};

const CATEGORY_NAMES: Readonly<Record<string, string>> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  classical: 'Klasik',
  puzzle: 'Bulmaca',
};

async function profilePreview(env: AuthEnv, username: string): Promise<Preview | null> {
  if (!env.DB) return null;
  const user = await env.DB.prepare('SELECT id, username FROM users WHERE username = ?1')
    .bind(username)
    .first<{ id: string; username: string }>();
  if (!user) return null;
  const [ratings, patches] = await env.DB.batch([
    env.DB.prepare(
      'SELECT category, rating FROM ratings WHERE user_id = ?1 AND games > 0 ORDER BY games DESC LIMIT 3',
    ).bind(user.id),
    env.DB.prepare('SELECT count(*) AS n FROM user_patches WHERE user_id = ?1').bind(user.id),
  ]);
  const parts = (ratings.results as { category: string; rating: number }[]).map(
    (r) => `${CATEGORY_NAMES[r.category] ?? r.category.replace('variant:', '')} ${Math.round(r.rating)}`,
  );
  const n = (patches.results[0] as { n: number } | undefined)?.n ?? 0;
  if (n) parts.push(`${n} yama`);
  return {
    title: `${user.username} · punkchess`,
    description: parts.length ? `${parts.join(' · ')}. Ceketine ve oyunlarına bak.` : 'punkchess oyuncusu.',
  };
}

/** The preview of a page address, or null when it has none of its own. */
async function previewOf(env: AuthEnv, path: string): Promise<Preview | null> {
  if (STATIC[path]) return STATIC[path];
  if (path === '/daily') {
    const n = dailyNumber(dailyDay(Date.now()));
    return {
      title: `Günün sabotajı #${n} · punkchess`,
      description: 'Herkese aynı bulmaca, her gece yarısı yenisi. Çöz, karelerini paylaş, serini koru.',
    };
  }
  const profile = /^\/@\/([A-Za-z][A-Za-z0-9_-]{2,19})$/.exec(path);
  if (profile) return profilePreview(env, profile[1]).catch(() => null);
  return null;
}

/** The app page with this address's preview tags, or null when the address has none. */
export async function pagePreview(
  env: AuthEnv & { ASSETS: Fetcher },
  request: Request,
  url: URL,
): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const path = decodeURIComponent(url.pathname).replace(/\/+$/, '') || '/';
  const preview = await previewOf(env, path);
  if (!preview) return null;
  const page = await env.ASSETS.fetch(new Request(new URL('/', url), request));
  if (!page.headers.get('content-type')?.includes('text/html')) return page;
  const tags = metaTags({
    title: preview.title,
    description: preview.description,
    pageUrl: `${url.origin}${url.pathname}`,
    imageUrl: `${url.origin}/og.png`,
  });
  return new HTMLRewriter()
    .on('meta[property^="og:"], meta[name^="twitter:"], meta[name="description"]', {
      element: (el) => {
        el.remove();
      },
    })
    .on('title', {
      element: (el) => {
        el.setInnerContent(preview.title);
      },
    })
    .on('head', {
      element: (el) => {
        el.append(tags, { html: true });
      },
    })
    .transform(page);
}

/** Pages listed for search engines: the fixed ones and the profiles of players who have played. */
export async function sitemap(env: AuthEnv, url: URL): Promise<Response> {
  const pages = ['/', '/puzzles', '/daily', '/rush', '/leaderboard', '/analysis', '/privacy', '/terms', '/licenses'];
  if (env.DB) {
    const rows = await env.DB.prepare(
      `SELECT DISTINCT u.username FROM users u JOIN ratings r ON r.user_id = u.id WHERE r.games > 0
       ORDER BY u.username LIMIT 1000`,
    )
      .all<{ username: string }>()
      .catch(() => ({ results: [] as { username: string }[] }));
    for (const r of rows.results) pages.push(`/@/${r.username}`);
  }
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    pages.map((p) => `  <url><loc>${url.origin}${encodeURI(p)}</loc></url>`).join('\n') +
    '\n</urlset>\n';
  return new Response(body, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
}
