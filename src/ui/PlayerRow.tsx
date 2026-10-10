import type { ClockState } from '../clock/clock.ts';
import type { Color, PieceType, Position, VariantDefinition } from '../engine/index.ts';
import { ClockView } from './ClockView.tsx';
import { botName } from './game/session.ts';
import type { Player } from './game/session.ts';
import { useI18n } from './i18n.tsx';
import { PieceView } from './PieceView.tsx';
import { Avatar } from './Punk.tsx';

/** Pieces of `color` missing from `now` compared with `start`, most valuable first. */
function lostPieces(v: VariantDefinition, start: Position, now: Position, color: Color): PieceType[] {
  const count = (p: Position) => {
    const c = new Map<PieceType, number>();
    for (const piece of p.board) if (piece?.color === color) c.set(piece.type, (c.get(piece.type) ?? 0) + 1);
    return c;
  };
  const before = count(start);
  const after = count(now);
  const lost: PieceType[] = [];
  for (const [type, n] of before) for (let i = 0; i < n - (after.get(type) ?? 0); i++) lost.push(type);
  return lost.sort((a, b) => v.pieceValues[b] - v.pieceValues[a]);
}

/** Material of `color` on the board, in pawns. */
const material = (v: VariantDefinition, p: Position, color: Color) =>
  p.board.reduce((sum, piece) => sum + (piece?.color === color ? v.pieceValues[piece.type] : 0), 0) / 100;

interface Props {
  variant: VariantDefinition;
  color: Color;
  player: Player;
  start: Position;
  position: Position;
  /** It is this side's move and the game is on. */
  active: boolean;
  /** Shown only in timed games. */
  clock: ClockState | null;
  /** Card above or below in the players column (the clock sits toward the middle). */
  place: 'top' | 'bottom';
  /** Shown under the colour instead of the player kind (e.g. an online player's name). */
  label?: string;
}

/** One player card left of the board: skull avatar, who plays, pieces taken, clock. */
export function PlayerRow({ variant, color, player, start, position, active, clock, place, label }: Props) {
  const { t } = useI18n();
  const taken = lostPieces(variant, start, position, color === 'w' ? 'b' : 'w');
  const lead = Math.round(material(variant, position, color) - material(variant, position, color === 'w' ? 'b' : 'w'));
  return (
    <div className={`player-row ${place}${active ? ' turn' : ''}`}>
      <span className="avatar">
        <Avatar bot={player.kind === 'bot'} />
      </span>
      <div className="player-info">
        <div className="player-head">
          <span className="player-name">{t(`color.${color}`)}</span>
          <span className="player-sub">{label ?? botName(player, t)}</span>
        </div>
        <div className="taken">
          {taken.map((type, i) => (
            <span key={i} className="taken-piece">
              <PieceView variant={variant} piece={{ type, color: color === 'w' ? 'b' : 'w' }} />
            </span>
          ))}
          {lead > 0 && <span className="lead">+{lead}</span>}
        </div>
      </div>
      {clock && <ClockView clock={clock} color={color} />}
    </div>
  );
}
