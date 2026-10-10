// @vitest-environment happy-dom
// Interaction tests of the whole app: moves by click and drag, promotion,
// bot turns (fake bot client), premoves, undo against the bot, the clock
// (fake timers) and right-click arrows.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThinkOptions } from '../../src/ai/client.ts';
import type { Move } from '../../src/engine/types.ts';

// --- fake bot: each think() waits until the test answers it ---
const bot = vi.hoisted(() => ({
  pending: [] as {
    opts: ThinkOptions;
    resolve: (m: { move: Move; score: number; depth: number; nodes: number }) => void;
  }[],
}));
vi.mock('../../src/ai/client.ts', () => {
  class BotCancelled extends Error {}
  class BotClient {
    think(opts: ThinkOptions) {
      return new Promise((resolve) => bot.pending.push({ opts, resolve }));
    }
    stop() {}
    dispose() {}
  }
  return { BotClient, BotCancelled };
});

const { App } = await import('../../src/ui/App.tsx');
const { findMove } = await import('../../src/engine/game.ts');
const { getVariant } = await import('../../src/engine/variants/index.ts');
const { parseSquare } = await import('../../src/engine/board.ts');
const { encodeGame, encodePosition } = await import('../../src/storage/share.ts');

const BOARD = 400;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('dorkchess:hideRules:standard', 'true');
  // Tests read Turkish texts unless they switch the language themselves.
  localStorage.setItem('dorkchess:prefs', JSON.stringify({ locale: 'tr' }));
  bot.pending.length = 0;
  // happy-dom has no layout: give the board a size so pointer positions map to squares.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const size = this.classList.contains('board') ? BOARD : 0;
    return {
      left: 0,
      top: 0,
      x: 0,
      y: 0,
      width: size,
      height: size,
      right: size,
      bottom: size,
      toJSON() {},
    } as DOMRect;
  });
  Element.prototype.setPointerCapture ??= () => {};
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function startGame(settings: Record<string, unknown>) {
  localStorage.setItem(
    'dorkchess:settings',
    JSON.stringify({ variantId: 'standard', timeControl: 'none', humanColor: 'w', ...settings }),
  );
  render(<App />);
  // The app opens on the home page: Play now opens the new game dialog.
  fireEvent.click(screen.getByRole('button', { name: 'Hemen oyna' }));
  fireEvent.click(screen.getByRole('button', { name: 'Oyuna başla' }));
}

const board = () => document.querySelector('.board-area .board') as HTMLElement;
/** Centre of a square in client coordinates (White at the bottom). */
const at = (sq: string) => {
  const f = sq.charCodeAt(0) - 97;
  const r = sq.charCodeAt(1) - 49;
  return { clientX: (f + 0.5) * (BOARD / 8), clientY: (7 - r + 0.5) * (BOARD / 8) };
};
const pointer = (type: 'pointerDown' | 'pointerMove' | 'pointerUp', sq: string, button = 0) =>
  fireEvent[type](board(), { ...at(sq), button, pointerId: 1 });
const click = (sq: string) => {
  pointer('pointerDown', sq);
  pointer('pointerUp', sq);
};
const move = (from: string, to: string) => {
  click(from);
  click(to);
};
const moves = () => [...document.querySelectorAll('.moves .mv')].map((b) => b.textContent);
const status = () => document.querySelector('.status')!.textContent;

/** Answers the oldest pending bot request with the move from-to. */
async function botPlays(from: string, to: string) {
  const req = bot.pending.shift();
  if (!req) throw new Error('bot was not asked to move');
  const v = getVariant(req.opts.variantId);
  const m = findMove(v, req.opts.state, parseSquare(from), parseSquare(to));
  if (!m) throw new Error(`bot move ${from}-${to} is illegal`);
  await act(async () => req.resolve({ move: m, score: 0, depth: 1, nodes: 1 }));
}

describe('uygulama: iki kişi', () => {
  it('tıkla-tıkla ve sürükle-bırak ile hamle', () => {
    startGame({ mode: 'hotseat' });
    move('e2', 'e4');
    expect(moves()).toEqual(['e4']);
    expect(status()).toBe('Sıra: Siyah');
    pointer('pointerDown', 'e7');
    pointer('pointerMove', 'e6');
    pointer('pointerMove', 'e5');
    pointer('pointerUp', 'e5');
    expect(moves()).toEqual(['e4', 'e5']);
  });

  it('terfi penceresi açılır ve seçilen taşa terfi edilir', () => {
    startGame({ mode: 'hotseat' });
    for (const [f, t] of [
      ['h2', 'h4'],
      ['g7', 'g5'],
      ['h4', 'g5'],
      ['g8', 'f6'],
      ['g5', 'g6'],
      ['h8', 'g8'],
      ['g6', 'h7'],
      ['f8', 'g7'],
    ])
      move(f, t);
    move('h7', 'h8');
    const dialog = screen.getByRole('dialog', { name: 'Terfi seçimi' });
    fireEvent.click(dialog.querySelector('button[title="At"]')!);
    expect(moves().at(-1)).toBe('h8=N');
  });

  it('sağ tıkla sürükleyince ok, aynı karede halka; sol tık temizler', () => {
    startGame({ mode: 'hotseat' });
    pointer('pointerDown', 'd2', 2);
    pointer('pointerMove', 'd4');
    pointer('pointerUp', 'd4', 2);
    expect(document.querySelector('svg.arrows line')?.getAttribute('class')).toContain('green');
    pointer('pointerDown', 'e5', 2);
    pointer('pointerUp', 'e5', 2);
    expect(document.querySelectorAll('svg.arrows circle')).toHaveLength(1);
    click('a3');
    expect(document.querySelector('svg.arrows')).toBeNull();
  });
});

describe('uygulama: bilgisayara karşı', () => {
  it('bot sırası: "düşünüyor" gösterilir, bot hamlesi oynanır', async () => {
    startGame({ mode: 'bot', botLevel: 3 });
    move('e2', 'e4');
    expect(status()).toContain('bot (Kulüp (3)) düşünüyor');
    expect(bot.pending).toHaveLength(1);
    await botPlays('e7', 'e5');
    expect(moves()).toEqual(['e4', 'e5']);
    expect(status()).toBe('Sıra: Beyaz');
  });

  it('premove: bot oynayınca hemen oynanır ve bot yeniden düşünür', async () => {
    startGame({ mode: 'bot', botLevel: 3 });
    move('e2', 'e4');
    move('g1', 'f3'); // sıra botta: premove
    expect(document.querySelectorAll('.square.premove')).toHaveLength(2);
    await botPlays('e7', 'e5');
    expect(moves()).toEqual(['e4', 'e5', 'Nf3']);
    expect(bot.pending).toHaveLength(1);
  });

  it('premove yasal değilse iptal edilir; sağ tık da iptal eder', async () => {
    startGame({ mode: 'bot', botLevel: 3 });
    move('e2', 'e4');
    move('e4', 'e5'); // bot e5 oynarsa geçersiz kalacak
    await botPlays('e7', 'e5');
    expect(moves()).toEqual(['e4', 'e5']);
    expect(document.querySelectorAll('.square.premove')).toHaveLength(0);
    move('g1', 'f3');
    move('b1', 'c3'); // premove
    expect(document.querySelectorAll('.square.premove')).toHaveLength(2);
    pointer('pointerDown', 'a1', 2);
    expect(document.querySelectorAll('.square.premove')).toHaveLength(0);
  });

  it('geri al: son kendi hamlen ve botun cevabı birlikte', async () => {
    startGame({ mode: 'bot', botLevel: 3 });
    move('e2', 'e4');
    await botPlays('e7', 'e5');
    move('g1', 'f3');
    await botPlays('b8', 'c6');
    fireEvent.click(screen.getByRole('button', { name: '↶ Geri al' }));
    expect(moves()).toEqual(['e4', 'e5']);
    expect(status()).toBe('Sıra: Beyaz');
  });
});

describe('uygulama: saat', () => {
  it('ilk hamleyle başlar, süre bitince doğru taraf kaybeder', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    startGame({ mode: 'hotseat', timeControl: '1+0' });
    const clocks = () => [...document.querySelectorAll('.clock-time')].map((c) => c.textContent);
    expect(clocks()).toEqual(['1:00', '1:00']);
    await act(async () => vi.advanceTimersByTime(5_000)); // ilk hamleden önce saat işlemez
    expect(clocks()).toEqual(['1:00', '1:00']);
    move('e2', 'e4'); // siyahın saati başlar
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(clocks()[0]).toBe('0:30'); // üstte siyah
    await act(async () => vi.advanceTimersByTime(31_000));
    expect(status()).toBe('Süre bitti. Beyaz kazandı.');
  });
});

describe('uygulama: paylaşım linki', () => {
  afterEach(() => history.replaceState(null, '', '/'));

  it('oyun linki izleyicide açılır ve adres temizlenir', () => {
    const v = getVariant('standard');
    location.hash = encodeGame({ variantId: 'standard', startFen: v.startPosition, moves: ['e4', 'e5', 'Nf3'] });
    render(<App />);
    const dialog = screen.getByRole('dialog', { name: 'Paylaşılan oyun' });
    expect([...dialog.querySelectorAll('.moves .mv')].map((b) => b.textContent)).toEqual(['e4', 'e5', 'Nf3']);
    expect(location.hash).toBe('');
  });

  it('konum linki o konumdan iki kişilik oyun başlatır', () => {
    location.hash = encodePosition('diplomat', '4k3/8/8/8/3D4/8/8/R3K3 b Q - 0 1');
    render(<App />);
    expect(screen.queryByRole('button', { name: 'Oyuna başla' })).toBeNull();
    expect(document.querySelector('.game-label')?.textContent).toContain('Diplomat');
    expect(status()).toBe('Sıra: Siyah');
  });

  it('bozuk link anlaşılır bir mesajla bildirilir', () => {
    location.hash = '#g=@@@';
    render(<App />);
    expect(document.querySelector('.notice')?.textContent).toContain('Link açılamadı');
  });
});

describe('uygulama: erişilebilirlik', () => {
  const square = (name: string) => document.querySelector(`[data-square="${parseSquare(name)}"]`) as HTMLElement;

  it('klavyeyle oynama: ok tuşları, Enter ile seç ve oyna', () => {
    startGame({ mode: 'hotseat' });
    expect(square('e2').tabIndex).toBe(0); // tek odaklanabilir kare
    expect(square('e3').tabIndex).toBe(-1);
    square('e2').focus();
    fireEvent.keyDown(board(), { key: 'Enter' });
    expect(square('e2').getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(board(), { key: 'ArrowUp' });
    fireEvent.keyDown(board(), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(square('e4'));
    fireEvent.keyDown(board(), { key: 'Enter' });
    expect(moves()).toEqual(['e4']);
  });

  it('kareler ekran okuyucu için etiketli; hamleler duyurulur', () => {
    startGame({ mode: 'hotseat' });
    expect(square('e2').getAttribute('aria-label')).toBe('e2, beyaz piyon');
    expect(square('e4').getAttribute('aria-label')).toBe('e4, boş');
    move('e2', 'e4');
    expect(square('e4').getAttribute('aria-label')).toBe('e4, beyaz piyon, son hamle');
    expect(document.querySelector('[aria-live]')?.textContent).toBe('Beyaz: e4');
  });

  it('pencere: açılınca içine odaklanır, Esc kapatır, odak açan düğmeye döner', () => {
    startGame({ mode: 'hotseat' });
    const rulesButton = screen.getByRole('button', { name: 'Kurallar' });
    rulesButton.focus();
    fireEvent.click(rulesButton);
    const dialog = screen.getByRole('dialog', { name: /kuralları/ });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.textContent).toBe('Tamam');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /kuralları/ })).toBeNull();
    expect(document.activeElement).toBe(rulesButton);
  });
});

describe('uygulama: dil', () => {
  it('İngilizceye geçince arayüz, varyant metinleri ve ekran okuyucu etiketleri İngilizce olur', () => {
    startGame({ mode: 'hotseat' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Dil' }), { target: { value: 'en' } });
    expect(screen.getByRole('button', { name: 'New game' })).toBeTruthy();
    expect(status()).toBe('White to move');
    expect(document.documentElement.lang).toBe('en');
    expect(document.querySelector('.side h2')?.textContent).toBe('Standard');
    const e2 = document.querySelector(`[data-square="${parseSquare('e2')}"]`)!;
    expect(e2.getAttribute('aria-label')).toBe('e2, white pawn');
    move('e2', 'e4');
    expect(document.querySelector('[aria-live]')?.textContent).toBe('White: e4');
    // The choice is remembered.
    expect(JSON.parse(localStorage.getItem('dorkchess:prefs')!).locale).toBe('en');
  });

  it('kayıtlı dil yoksa tarayıcı dili seçilir (Türkçe değilse İngilizce)', () => {
    localStorage.removeItem('dorkchess:prefs');
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
    render(<App />);
    expect(screen.getByRole('button', { name: 'Play now' })).toBeTruthy();
  });

  it('Jester kurulum sorusu İngilizce sorulur', () => {
    localStorage.setItem('dorkchess:prefs', JSON.stringify({ locale: 'en' }));
    localStorage.setItem('dorkchess:hideRules:jester', 'true');
    localStorage.setItem('dorkchess:settings', JSON.stringify({ mode: 'hotseat', variantId: 'jester' }));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Play now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    expect(screen.getByRole('dialog', { name: 'White: which piece becomes the Jester?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Right knight \(g1\)/ })).toBeTruthy();
  });
});
