import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseSquare as sq } from '../src/engine/board.ts';
import { parseFen } from '../src/engine/notation.ts';
import { getVariant } from '../src/engine/variants/index.ts';
import { Board } from '../src/ui/Board.tsx';
import { RuleCardModal } from '../src/ui/RuleCardModal.tsx';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;');

/** Class list of each square in the server-rendered board, keyed by square index. */
function squareClasses(html: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const m of html.matchAll(/class="(square[^"]*)" data-square="(\d+)"/g)) out.set(Number(m[2]), m[1]);
  return out;
}

describe('Board bileşeni', () => {
  const v = getVariant('diplomat');
  const render = (fen: string, flipped = false) => {
    const position = parseFen(v, fen);
    return squareClasses(
      renderToStaticMarkup(
        <Board
          variant={v}
          position={position}
          lastMove={null}
          flipped={flipped}
          highlight={v.highlight!.squares(position)}
          bandRanks={v.highlight!.ranks ?? []}
          disabled={false}
          onMove={() => {}}
        />,
      ),
    );
  };

  it('aura karelerini boyar, aura içindeki şahın karesini boyamaz', () => {
    const classes = render('7k/8/8/8/3DK3/8/8/8 w - - 0 1');
    expect(classes.get(sq('c4'))).toContain('zone');
    expect(classes.get(sq('e5'))).toContain('zone');
    expect(classes.get(sq('e4'))).not.toContain('zone');
    expect(classes.get(sq('d4'))).not.toContain('zone');
  });

  it('4. ve 5. yatayın dış kenarlarını işaretler (tahta çevrilince de)', () => {
    const normal = render(v.startPosition);
    expect(normal.get(sq('a5'))).toContain('band-top');
    expect(normal.get(sq('a4'))).toContain('band-bottom');
    expect(normal.get(sq('a3'))).not.toContain('band');
    const flipped = render(v.startPosition, true);
    expect(flipped.get(sq('a4'))).toContain('band-top');
    expect(flipped.get(sq('a5'))).toContain('band-bottom');
  });
});

describe('Kural kartı bileşeni', () => {
  it.each(['burokrat', 'jester', 'diplomat'])('%s: başlık, maddeler ve ilk örnek diyagramı', (id) => {
    const v = getVariant(id);
    const html = renderToStaticMarkup(<RuleCardModal variant={v} onClose={() => {}} />);
    const ex = v.rules.examples[0];
    expect(html).toContain(v.rules.title);
    for (const b of v.rules.bullets) expect(html).toContain(escapeHtml(b));
    expect(html).toContain(escapeHtml(ex.caption));
    expect(html).toContain(`Örnek 1/${v.rules.examples.length}`);
    expect(html.match(/class="square /g)).toHaveLength(64);
    expect(html.match(/class="arrow-line /g) ?? []).toHaveLength(ex.arrows.length);
    expect(html).toContain('Bu varyant için bir daha gösterme');
  });

  it('standart: örnek yoksa diyagram da yok', () => {
    const html = renderToStaticMarkup(<RuleCardModal variant={getVariant('standard')} onClose={() => {}} />);
    expect(html).not.toContain('class="diagram"');
  });
});
