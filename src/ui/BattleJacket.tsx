import { forwardRef } from 'react';
import { patchById } from '../achievements/patches.ts';
import type { PatchDef, PatchShape } from '../achievements/patches.ts';
import type { MessageKey } from '../i18n/index.ts';
import { useI18n } from './i18n.tsx';

const SIZE = 64;

/** The outline of a patch, centred on 0,0. */
function shapePath(shape: PatchShape, r = SIZE / 2): string {
  switch (shape) {
    case 'circle':
      return `M${-r} 0 A${r} ${r} 0 1 0 ${r} 0 A${r} ${r} 0 1 0 ${-r} 0 Z`;
    case 'shield':
      return `M${-r} ${-r * 0.85} H${r} V${r * 0.1} Q${r} ${r * 0.75} 0 ${r} Q${-r} ${r * 0.75} ${-r} ${r * 0.1} Z`;
    case 'diamond':
      return `M0 ${-r} L${r} 0 L0 ${r} L${-r} 0 Z`;
    case 'rect':
      return `M${-r} ${-r * 0.7} H${r} V${r * 0.7} H${-r} Z`;
    case 'star': {
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const a = (Math.PI / 5) * i - Math.PI / 2;
        const rr = i % 2 ? r * 0.55 : r;
        pts.push(`${(Math.cos(a) * rr).toFixed(1)} ${(Math.sin(a) * rr).toFixed(1)}`);
      }
      return `M${pts.join(' L')} Z`;
    }
  }
}

/** A patch's short name, on up to two lines. */
function lines(text: string): string[] {
  const words = text.toUpperCase().split(' ');
  if (words.length < 2) return words;
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
}

/** One patch drawn at 0,0 (inside an <svg>). Locked ones are only a dashed outline. */
export function PatchMark({ patch, label, locked = false }: { patch: PatchDef; label: string; locked?: boolean }) {
  const text = lines(label);
  const small = patch.shape === 'star' || patch.shape === 'diamond';
  return (
    <g className={locked ? 'patch locked' : 'patch'}>
      {!locked && <path d={shapePath(patch.shape)} transform="translate(2 3)" fill="rgba(0,0,0,0.45)" />}
      <path
        d={shapePath(patch.shape)}
        fill={locked ? 'none' : patch.fill}
        stroke={locked ? '#55515c' : '#0a0a0b'}
        strokeWidth="2.5"
      />
      <path
        d={shapePath(patch.shape, SIZE / 2 - 4)}
        fill="none"
        stroke={locked ? '#55515c' : patch.ink}
        strokeWidth="1.2"
        strokeDasharray="3 2"
        opacity={locked ? 0.6 : 0.55}
      />
      {text.map((line, i) => (
        <text
          key={i}
          x="0"
          y={(i - (text.length - 1) / 2) * 10.5 + 3.5}
          textAnchor="middle"
          fontSize={small ? 8 : 9.5}
          fontFamily="'Bebas Neue', 'Oswald', 'Arial Narrow', sans-serif"
          letterSpacing="0.3"
          fill={locked ? '#6f6a78' : patch.ink}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

/**
 * Where earned patches go on a jacket picture (1000×1000, the jacket seen from
 * the front and centred), in order, with a slight tilt each: chest, belly,
 * sleeves, collar, hem.
 */
const SLOTS: readonly [number, number, number][] = [
  [375, 330, -6],
  [625, 330, 6],
  [385, 500, 4],
  [615, 500, -4],
  [190, 420, -10],
  [810, 420, 10],
  [380, 670, -5],
  [620, 670, 5],
  [165, 590, -6],
  [835, 590, 6],
  [500, 410, 0],
  [500, 590, 3],
  [150, 750, -4],
  [850, 750, 4],
  [330, 200, -12],
  [670, 200, 12],
  [270, 840, -8],
  [730, 840, 8],
];
/** Patches are drawn at SIZE and scaled up to the picture. */
const PATCH_SCALE = 1.6;

export const jacketSrc = (id: string, thumb = false) =>
  `${import.meta.env.BASE_URL}jackets/${id}${thumb ? '-thumb' : ''}.webp`;

interface JacketProps {
  username: string;
  /** The jacket picture (src/achievements/jackets.ts). */
  jacket: string;
  /** Earned patch ids, oldest first. */
  patches: readonly string[];
}

/** A player's jacket with the earned patches sewn on. */
export const BattleJacket = forwardRef<SVGSVGElement, JacketProps>(function BattleJacket(
  { username, jacket, patches },
  ref,
) {
  const { t } = useI18n();
  const earned = patches.map((id) => patchById(id)).filter((p): p is PatchDef => !!p);
  return (
    <svg
      ref={ref}
      className="jacket"
      viewBox="0 0 1000 1000"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={t('jacket.label', { name: username, n: String(earned.length) })}
    >
      <image className="jacket-picture" href={jacketSrc(jacket)} x="0" y="0" width="1000" height="1000" />
      {earned.map((p, i) => {
        const [x, y, rot] = SLOTS[i % SLOTS.length];
        return (
          <g key={p.id} transform={`translate(${x} ${y}) rotate(${rot}) scale(${PATCH_SCALE})`}>
            <PatchMark patch={p} label={t(`patch.${p.id}` as MessageKey)} />
          </g>
        );
      })}
    </svg>
  );
});
