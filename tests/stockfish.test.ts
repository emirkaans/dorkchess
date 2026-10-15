import { describe, expect, it } from 'vitest';
import { createGame, listVariants, playSan } from '../src/engine/index.ts';
import { MATE } from '../src/ai/evaluate.ts';
import { parseInfo, uciPosition, uciScore, uciToLine } from '../src/ai/stockfish.ts';

describe('stockfish bağlantısı', () => {
  it('UCI puanları bizim biçime çevrilir: santipiyon ve mat', () => {
    expect(uciScore('cp', 34)).toBe(34);
    expect(uciScore('mate', 1)).toBe(MATE - 1);
    expect(uciScore('mate', 3)).toBe(MATE - 5);
    expect(uciScore('mate', -2)).toBe(-(MATE - 4));
  });

  it('info satırı okunur; sınır puanları ve ikinci çizgiler atlanır', () => {
    const i = parseInfo('info depth 18 seldepth 24 multipv 1 score cp 974 nodes 120000 nps 900000 pv g2g4 f6g4 h3g4');
    expect(i).toEqual({ depth: 18, score: 974, nodes: 120000, pv: ['g2g4', 'f6g4', 'h3g4'] });
    expect(parseInfo('info depth 18 multipv 2 score cp 10 pv a2a3')).toBeNull();
    expect(parseInfo('info depth 18 score cp 10 lowerbound pv a2a3')).toBeNull();
    expect(parseInfo('info string NNUE evaluation enabled')).toBeNull();
  });

  it('UCI hamlesi kare numaralarına çevrilir', () => {
    expect(uciToLine('e2e4')).toEqual({ from: 12, to: 28 });
    expect(uciToLine('e7e8q')).toEqual({ from: 52, to: 60, promotion: 'q' });
  });

  it('pozisyon oyunun başından hamlelerle gönderilir (tekrarlar sayılsın)', () => {
    const v = listVariants()[0];
    const s = playSan(v, createGame(v), 'e4', 'e5', 'Nf3');
    expect(uciPosition(s)).toBe(
      'position fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1 moves e2e4 e7e5 g1f3',
    );
  });
});

/**
 * A stand-in for the Stockfish worker: answers the UCI handshake after a
 * while, searches take `searchMs`, "stop" ends a running search at once.
 */
class FakeEngine {
  static loadMs = 30;
  static searchMs = 40;
  static crashes = 0;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  private search: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private loaded = new Promise<void>((r) => setTimeout(r, FakeEngine.loadMs));
  private out(line: string) {
    this.onmessage?.({ data: line });
  }
  private finish(move: string) {
    if (!this.search) return;
    clearTimeout(this.search);
    this.search = null;
    this.out(`bestmove ${move}`);
  }
  postMessage(cmd: string) {
    // Commands are handled in order, after the engine has loaded.
    this.queue = this.queue
      .then(() => this.loaded)
      .then(() => {
        if (cmd === 'uci') this.out('uciok');
        else if (cmd === 'isready') this.out('readyok');
        else if (cmd === 'stop') this.finish('a2a3');
        // Like the real single-threaded build: a new position during a search crashes it.
        else if (cmd.startsWith('position') && this.search) {
          FakeEngine.crashes++;
          this.onerror?.();
        } else if (cmd.startsWith('go')) {
          this.out('info depth 1 score cp 20 nodes 10 pv e2e4');
          this.search = setTimeout(() => {
            this.out('info depth 2 score cp 30 nodes 99 pv e2e4 e7e5');
            this.finish('e2e4');
          }, FakeEngine.searchMs);
        }
      });
  }
  terminate() {
    if (this.search) clearTimeout(this.search);
  }
}

describe('stockfish istemcisi', () => {
  const v = listVariants()[0];
  const start = createGame(v);

  it('motor yüklenirken pozisyon değişse de son istek cevap alır', async () => {
    const { StockfishClient } = await import('../src/ai/stockfish.ts');
    (globalThis as { Worker?: unknown }).Worker = FakeEngine;
    const c = new StockfishClient();
    const first = c.think({ variantId: v.id, state: start, level: 4, timeLimitMs: 100 });
    first.catch(() => {});
    // Before the engine is ready: the first request is replaced.
    const infos: number[] = [];
    const second = await c.think({
      variantId: v.id,
      state: playSan(v, start, 'Nf3', 'Nf6'),
      level: 4,
      timeLimitMs: 100,
      onInfo: (i) => infos.push(i.depth),
    });
    await expect(first).rejects.toThrow();
    expect(infos).toEqual([1, 2]);
    expect(second.depth).toBe(2);
    c.dispose();
  });

  it('çalışan arama durdurulunca eski cevap yeni isteğe karışmaz', async () => {
    const { StockfishClient } = await import('../src/ai/stockfish.ts');
    (globalThis as { Worker?: unknown }).Worker = FakeEngine;
    const c = new StockfishClient();
    await c.think({ variantId: v.id, state: start, level: 4, timeLimitMs: 100 });
    const running = c.think({ variantId: v.id, state: start, level: 4, timeLimitMs: 100 });
    running.catch(() => {});
    await new Promise((r) => setTimeout(r, 10));
    // Stopped mid-search: its "bestmove a2a3" must not answer the next request.
    const next = await c.think({ variantId: v.id, state: playSan(v, start, 'd4', 'd5'), level: 4, timeLimitMs: 100 });
    expect(next.move.from).not.toBe(8);
    expect(next.depth).toBe(2);
    expect(FakeEngine.crashes).toBe(0);
    c.dispose();
  });
});
