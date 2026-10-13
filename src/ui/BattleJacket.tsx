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

/** Where earned patches go on the back of the jacket, in order (a slight tilt each). */
const SLOTS: readonly [number, number, number][] = [
  [140, 168, -8],
  [200, 160, 4],
  [262, 170, 9],
  [146, 228, 6],
  [205, 222, -5],
  [258, 232, -10],
  [138, 290, -3],
  [200, 284, 8],
  [264, 294, 3],
  [150, 350, 10],
  [208, 346, -7],
  [262, 354, 5],
  [55, 200, -14],
  [345, 200, 14],
  [200, 400, 0],
  [52, 140, -12],
  [348, 140, 12],
  [200, 96, -4],
];

interface JacketProps {
  username: string;
  /** Earned patch ids, oldest first. */
  patches: readonly string[];
}

/** The back of a denim jacket with the earned patches sewn on. */
export const BattleJacket = forwardRef<SVGSVGElement, JacketProps>(function BattleJacket({ username, patches }, ref) {
  const { t } = useI18n();
  const earned = patches.map((id) => patchById(id)).filter((p): p is PatchDef => !!p);
  return (
    <svg
      ref={ref}
      className="jacket"
      viewBox="0 0 400 440"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={t('jacket.label', { name: username, n: String(earned.length) })}
    >
      <defs>
        <pattern id="denim" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <rect width="6" height="6" fill="#2c4a73" />
          <rect width="3" height="6" fill="#31527f" />
        </pattern>
      </defs>
      {/* Sleeves, body, collar */}
      <path
        d="M120 62 L162 40 Q200 56 238 40 L280 62 L348 92 L392 262 L344 274 L320 168 L320 418 Q200 434 80 418 L80 168 L56 274 L8 262 L52 92 Z"
        fill="url(#denim)"
        stroke="#0a0a0b"
        strokeWidth="3"
      />
      <path d="M162 40 Q200 74 238 40 Q200 54 162 40 Z" fill="#203a5c" stroke="#0a0a0b" strokeWidth="2" />
      {/* Seams in orange thread */}
      <g fill="none" stroke="#e8a33a" strokeWidth="1.6" strokeDasharray="4 3" opacity="0.85">
        <path d="M82 122 Q200 146 318 122" />
        <path d="M82 396 Q200 410 318 396" />
        <path d="M120 64 L82 168" />
        <path d="M280 64 L318 168" />
        <path d="M200 146 V396" opacity="0.35" />
      </g>
      {/* A safety pin by the collar */}
      <g transform="translate(250 92) rotate(28)" fill="none" stroke="#c9c9cf" strokeWidth="2.2" strokeLinecap="round">
        <path d="M0 0 H30 Q36 0 36 5 Q36 10 30 10 H4" />
        <circle cx="-3" cy="5" r="4" />
      </g>
      {earned.map((p, i) => {
        const [x, y, rot] = SLOTS[i % SLOTS.length];
        return (
          <g key={p.id} transform={`translate(${x} ${y}) rotate(${rot})`}>
            <PatchMark patch={p} label={t(`patch.${p.id}` as MessageKey)} />
          </g>
        );
      })}
      {earned.length === 0 && (
        <text x="200" y="270" textAnchor="middle" fontSize="15" fill="#c9d3e6" fontFamily="'Space Mono', monospace">
          {t('jacket.empty')}
        </text>
      )}
    </svg>
  );
});
