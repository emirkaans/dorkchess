import { useState } from 'react';
import {
  createGame,
  getVariant,
  isInCheck,
  listVariants,
  makeMove,
  setupStartPosition,
  toFen,
} from '../engine/index.ts';
import type { GameResult, GameState, Move, PieceType, VariantDefinition } from '../engine/index.ts';
import { Board } from './Board.tsx';
import { MoveList } from './MoveList.tsx';
import { PromotionDialog } from './PromotionDialog.tsx';
import { SetupDialog } from './SetupDialog.tsx';

const COLOR_NAME = { w: 'Beyaz', b: 'Siyah' } as const;

function resultText(r: GameResult): string {
  switch (r.reason) {
    case 'checkmate':
      return `Mat! ${COLOR_NAME[r.winner!]} kazandı.`;
    case 'stalemate':
      return 'Pat — berabere.';
    case 'fifty-move':
      return '50 hamle kuralı — berabere.';
    case 'threefold':
      return 'Üç kez tekrar — berabere.';
    case 'insufficient':
      return 'Yetersiz materyal — berabere.';
  }
}

interface Timeline {
  states: GameState[];
  cursor: number;
}

const newTimeline = (v: VariantDefinition, answers: Record<string, string> = {}): Timeline => ({
  states: [createGame(v, setupStartPosition(v, answers))],
  cursor: 0,
});

/** Pre-game setup in progress: answers so far. */
interface SetupState {
  answers: Record<string, string>;
  step: number;
}

export function App() {
  const [variantId, setVariantId] = useState(listVariants()[0].id);
  const variant = getVariant(variantId);
  const [timeline, setTimeline] = useState<Timeline>(() => newTimeline(variant));
  const [flipped, setFlipped] = useState(false);
  const [promotion, setPromotion] = useState<Move[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [showHighlight, setShowHighlight] = useState(true);

  const game = timeline.states[timeline.cursor];
  const lastPlayed = game.moves.at(-1)?.move ?? null;

  const startGame = (id: string) => {
    setVariantId(id);
    const v = getVariant(id);
    setTimeline(newTimeline(v));
    setPromotion(null);
    setSetup(v.setup?.questions.length ? { answers: {}, step: 0 } : null);
  };

  const onSetupPick = (optionId: string) => {
    if (!setup || !variant.setup) return;
    const question = variant.setup.questions[setup.step];
    const answers = { ...setup.answers, [question.id]: optionId };
    // Board previews the choices made so far.
    setTimeline(newTimeline(variant, answers));
    const step = setup.step + 1;
    setSetup(step < variant.setup.questions.length ? { answers, step } : null);
  };

  const play = (move: Move) => {
    setTimeline(({ states, cursor }) => {
      const next = makeMove(variant, states[cursor], move);
      return { states: [...states.slice(0, cursor + 1), next], cursor: cursor + 1 };
    });
  };

  const onMove = (candidates: Move[]) => {
    if (candidates.length > 1) setPromotion(candidates);
    else play(candidates[0]);
  };

  const onPromote = (type: PieceType) => {
    const move = promotion?.find((m) => m.promotion === type);
    setPromotion(null);
    if (move) play(move);
  };

  const fen = toFen(variant, game.position);
  const copyFen = async () => {
    try {
      await navigator.clipboard.writeText(fen);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Konum metni:', fen);
    }
  };

  const goTo = (cursor: number) => setTimeline((t) => ({ ...t, cursor: Math.max(0, Math.min(t.states.length - 1, cursor)) }));

  return (
    <div className="app">
      <header className="toolbar">
        <h1>dorkchess</h1>
        <label>
          Varyant{' '}
          <select value={variantId} onChange={(e) => startGame(e.target.value)}>
            {listVariants().map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => startGame(variantId)}>Yeni oyun</button>
      </header>

      <main className="layout">
        <section className="board-wrap">
          <Board
            variant={variant}
            position={game.position}
            lastMove={lastPlayed}
            flipped={flipped}
            highlight={showHighlight && variant.highlight ? variant.highlight.squares(game.position) : []}
            bandRanks={variant.highlight?.ranks ?? []}
            disabled={game.result !== null || promotion !== null || setup !== null}
            onMove={onMove}
          />
          {setup && variant.setup && (
            <SetupDialog
              variant={variant}
              question={variant.setup.questions[setup.step]}
              step={setup.step}
              total={variant.setup.questions.length}
              onPick={onSetupPick}
            />
          )}
          {promotion && (
            <PromotionDialog
              variant={variant}
              color={game.position.turn}
              options={promotion.map((m) => m.promotion!)}
              onPick={onPromote}
              onCancel={() => setPromotion(null)}
            />
          )}
          <div className="status">
            {game.result
              ? resultText(game.result)
              : `Sıra: ${COLOR_NAME[game.position.turn]}${isInCheck(variant, game.position) ? ' — Şah!' : ''}`}
          </div>
          <div className="controls">
            <button onClick={() => goTo(timeline.cursor - 1)} disabled={timeline.cursor === 0} title="Geri al">
              ◀ Geri
            </button>
            <button
              onClick={() => goTo(timeline.cursor + 1)}
              disabled={timeline.cursor === timeline.states.length - 1}
              title="İleri al"
            >
              İleri ▶
            </button>
            <button onClick={() => setFlipped((f) => !f)}>Tahtayı çevir</button>
            {variant.highlight && (
              <button onClick={() => setShowHighlight((h) => !h)} aria-pressed={showHighlight}>
                {variant.highlight.label}: {showHighlight ? 'açık' : 'kapalı'}
              </button>
            )}
            <button onClick={copyFen}>{copied ? 'Kopyalandı ✓' : 'Konumu kopyala'}</button>
          </div>
        </section>

        <aside className="side">
          <div className="panel">
            <h2>{variant.name}</h2>
            <ul className="rules">
              {variant.description.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div className="panel">
            <h2>Hamleler</h2>
            <MoveList game={timeline.states.at(-1)!} cursor={timeline.cursor} onSelect={goTo} />
          </div>
          <div className="panel">
            <h2>Konum</h2>
            <code className="fen">{fen}</code>
          </div>
        </aside>
      </main>
    </div>
  );
}
