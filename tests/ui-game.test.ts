import { describe, expect, it } from 'vitest';
import { parseSquare as sq } from '../src/engine/board.ts';
import { findMove } from '../src/engine/game.ts';
import { remainingMs } from '../src/clock/clock.ts';
import { gameReducer } from '../src/ui/game/reducer.ts';
import type { GameAction } from '../src/ui/game/reducer.ts';
import { newSession, viewOf } from '../src/ui/game/session.ts';
import type { GameSession } from '../src/ui/game/session.ts';
import { DEFAULT_SETTINGS } from '../src/ui/settings.ts';
import type { GameSettings } from '../src/ui/settings.ts';

const settings = (patch: Partial<GameSettings>): GameSettings => ({ ...DEFAULT_SETTINGS, ...patch });
/** Deterministic "random" for newSession. */
const fixed = (x: number) => () => x;

const reduce = (s: GameSession, ...actions: GameAction[]) => actions.reduce(gameReducer, s);

/** Move action by squares (and optional promotion), for the shown position of `s`. */
function mv(s: GameSession, from: string, to: string, now = 0, promotion?: string): GameAction {
  const v = viewOf(s);
  const move = findMove(v.variant, v.game, sq(from), sq(to), promotion);
  if (!move) throw new Error(`illegal ${from}-${to}`);
  return { type: 'move', move, key: s.key, now };
}

/** Plays a sequence of moves given as "e2e4" strings. */
function playAll(s: GameSession, ...uci: string[]): GameSession {
  for (const u of uci) s = gameReducer(s, mv(s, u.slice(0, 2), u.slice(2, 4)));
  return s;
}

describe('oyun durumu (reducer)', () => {
  it('yeni oyun: oyuncular, rastgele renk, saat', () => {
    const s = newSession(
      settings({ mode: 'bot', humanColor: 'random', botLevel: 3, timeControl: '3+2' }),
      7,
      fixed(0.9),
    );
    expect(s.key).toBe(7);
    expect(s.players).toEqual({ w: { kind: 'bot', level: 3 }, b: { kind: 'human' } });
    expect(viewOf(s).humanColor).toBe('b');
    expect(viewOf(s).timed).toBe(true);
    expect(s.premove).toBeNull();
  });

  it('hamle oynanır; eski oyunun anahtarıyla gelen hamle yok sayılır', () => {
    let s = newSession(settings({ mode: 'hotseat' }), 1);
    const stale = { ...mv(s, 'e2', 'e4'), key: 99 };
    expect(gameReducer(s, stale)).toBe(s);
    s = gameReducer(s, mv(s, 'e2', 'e4'));
    expect(s.timeline.states).toHaveLength(2);
    expect(viewOf(s).turn).toBe('b');
  });

  it('geçmişte bir konumdan hamle yapılınca sonraki hamleler atılır', () => {
    let s = playAll(newSession(settings({ mode: 'hotseat' }), 1), 'e2e4', 'e7e5', 'g1f3');
    s = gameReducer(s, { type: 'goTo', cursor: 1 });
    expect(viewOf(s).atEnd).toBe(false);
    s = gameReducer(s, mv(s, 'c7', 'c5'));
    expect(s.timeline.states).toHaveLength(3);
    expect(viewOf(s).game.moves.map((m) => m.san)).toEqual(['e4', 'c5']);
  });

  it('bota karşı geri al: son kendi hamlen ve botun cevabı birlikte', () => {
    let s = newSession(settings({ mode: 'bot', humanColor: 'w' }), 1);
    s = playAll(s, 'e2e4', 'e7e5', 'g1f3', 'b8c6'); // insan, bot, insan, bot
    s = gameReducer(s, { type: 'undoPair' });
    expect(viewOf(s).game.moves.map((m) => m.san)).toEqual(['e4', 'e5']);
    expect(viewOf(s).turn).toBe('w');
    // Bot düşünürken (sıra botta) geri al: yalnızca kendi son hamlen geri alınır.
    s = gameReducer(s, mv(s, 'g1', 'f3'));
    s = gameReducer(s, { type: 'undoPair' });
    expect(viewOf(s).game.moves.map((m) => m.san)).toEqual(['e4', 'e5']);
  });

  it('premove: bot hamlesinden sonra yasalsa aynı adımda oynanır', () => {
    let s = newSession(settings({ mode: 'bot', humanColor: 'w' }), 1);
    s = gameReducer(s, mv(s, 'e2', 'e4')); // sıra botta
    s = gameReducer(s, { type: 'premove', premove: { from: sq('g1'), to: sq('f3') } });
    s = gameReducer(s, mv(s, 'e7', 'e5')); // botun hamlesi
    expect(viewOf(s).game.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3']);
    expect(s.premove).toBeNull();
    expect(viewOf(s).turn).toBe('b');
  });

  it('premove: yasal değilse sessizce iptal edilir', () => {
    let s = newSession(settings({ mode: 'bot', humanColor: 'w' }), 1);
    s = gameReducer(s, mv(s, 'e2', 'e4'));
    // e4 piyonu ileri gitmek istiyor ama bot e5 ile önünü kapatacak.
    s = gameReducer(s, { type: 'premove', premove: { from: sq('e4'), to: sq('e5') } });
    s = gameReducer(s, mv(s, 'e7', 'e5'));
    expect(viewOf(s).game.moves.map((m) => m.san)).toEqual(['e4', 'e5']);
    expect(s.premove).toBeNull();
    expect(viewOf(s).turn).toBe('w');
  });

  it('premove geri al, geçmişte gezinme ve oyun sonu ile iptal olur', () => {
    let s = newSession(settings({ mode: 'bot', humanColor: 'w' }), 1);
    s = gameReducer(s, mv(s, 'e2', 'e4'));
    const queued = gameReducer(s, { type: 'premove', premove: { from: sq('d2'), to: sq('d4') } });
    expect(gameReducer(queued, { type: 'undoPair' }).premove).toBeNull();
    expect(gameReducer(queued, { type: 'goTo', cursor: 0 }).premove).toBeNull();
    const resigned = gameReducer(queued, {
      type: 'end',
      outcome: { reason: 'resign', winner: 'b' },
      key: 1,
      now: 0,
    });
    expect(resigned.premove).toBeNull();
    expect(viewOf(resigned).outcome).toEqual({ reason: 'resign', winner: 'b' });
  });

  it('saat: ilk hamle süreden düşmez, artış eklenir, süre bitince kaybeden belirlenir', () => {
    let s = newSession(settings({ mode: 'hotseat', timeControl: '1+0' }), 1);
    s = gameReducer(s, mv(s, 'e2', 'e4', 0));
    s = gameReducer(s, mv(s, 'e7', 'e5', 5_000)); // siyah 5 sn kullandı
    expect(remainingMs(s.clock, 'b', 5_000)).toBe(55_000);
    expect(gameReducer(s, { type: 'tick', now: 64_000 }).outcome).toBeNull();
    s = gameReducer(s, { type: 'tick', now: 66_000 }); // beyazın 60 sn'si doldu
    expect(s.outcome).toEqual({ reason: 'timeout', winner: 'b' });
    // Oyun bittikten sonra gelen hamle yok sayılır.
    expect(gameReducer(s, mv(s, 'g1', 'f3', 70_000))).toBe(s);
  });

  it('bot vs bot: "adım" tek hamleden sonra duraklatır', () => {
    let s = newSession(settings({ mode: 'botvbot' }), 1);
    s = reduce(s, { type: 'run', run: 'pause' }, { type: 'run', run: 'step' });
    s = gameReducer(s, mv(s, 'e2', 'e4'));
    expect(s.run).toBe('pause');
  });

  it('kurulum soruları sırayla cevaplanır ve tahta önizlenir', () => {
    let s = newSession(settings({ mode: 'hotseat', variantId: 'jester' }), 1);
    expect(s.setup?.questions).toHaveLength(2);
    s = gameReducer(s, { type: 'setupAnswer', optionId: 'd' }); // beyaz: vezir
    expect(viewOf(s).game.position.board[sq('d1')]).toEqual({ type: 'j', color: 'w' });
    s = gameReducer(s, { type: 'setupAnswer', optionId: 'g' });
    expect(s.setup).toBeNull();
  });

  it('bota karşı oyunda botun kurulum sorusunu bot cevaplar, insana yalnızca kendi sorusu sorulur', () => {
    const s = newSession(settings({ mode: 'bot', variantId: 'jester', humanColor: 'w' }), 1, fixed(0));
    expect(s.setup?.questions.map((q) => q.color)).toEqual(['w']);
  });
});
