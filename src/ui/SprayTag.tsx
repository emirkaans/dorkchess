import { useEffect, useMemo, useState } from 'react';
import { seeded, tagById } from '../achievements/tags.ts';
import type { TagStyle } from '../achievements/tags.ts';
import { playSound } from './sound.ts';

/** When the spray starts after the checkmate (the "MATE!" lands first). */
const SPRAY_DELAY_MS = 900;
/** Longest wait for the tag's font before spraying anyway (in a fallback font). */
const FONT_WAIT_MS = 1500;

const loaded = new Set<string>();

/** Loads a Google Fonts family for these letters only (once per family and text). */
async function loadFont(family: string, text: string): Promise<void> {
  const key = `${family}|${text}`;
  if (!loaded.has(key)) {
    loaded.add(key);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}&text=${encodeURIComponent(text)}&display=block`;
    document.head.appendChild(link);
  }
  if (!document.fonts?.load) return;
  await Promise.race([
    document.fonts.load(`80px "${family}"`, text).catch(() => undefined),
    new Promise((r) => setTimeout(r, FONT_WAIT_MS)),
  ]);
}

const W = 600;
const H = 260;

interface Drawing {
  readonly size: number;
  readonly dots: readonly { x: number; y: number; r: number; o: number }[];
  readonly drips: readonly { x: number; len: number }[];
}

/** Where the mist dots and the drips go: the same for the same name. */
function drawing(username: string): Drawing {
  const random = seeded(username);
  const size = Math.min(128, 900 / Math.max(username.length, 4));
  const dots = Array.from({ length: 70 }, () => {
    const a = random() * Math.PI * 2;
    const d = Math.sqrt(random());
    return {
      x: W / 2 + Math.cos(a) * d * 270,
      y: H / 2 + 10 + Math.sin(a) * d * 85,
      r: 1 + random() * 3,
      o: 0.35 + random() * 0.5,
    };
  });
  const drips = Array.from({ length: 4 }, () => ({ x: 170 + random() * 260, len: 18 + random() * 46 }));
  return { size, dots, drips };
}

function Deco({ style, d }: { style: TagStyle; d: Drawing }) {
  const c = style.color;
  switch (style.deco) {
    case 'underline':
      return <path d="M120 196 Q 300 214 486 188" stroke={c} strokeWidth="9" strokeLinecap="round" fill="none" />;
    case 'drips':
      return (
        <g className="spray-drips">
          {d.drips.map((drip, i) => (
            <g key={i}>
              <rect x={drip.x - 3} y={150} width={6} height={drip.len} rx={3} fill={c} />
              <circle cx={drip.x} cy={150 + drip.len} r={5} fill={c} />
            </g>
          ))}
        </g>
      );
    case 'halo':
      return (
        <ellipse
          cx={W / 2}
          cy={H / 2 + 6}
          rx={272}
          ry={96}
          stroke={c}
          strokeWidth="5"
          strokeDasharray="22 10"
          fill="none"
          opacity="0.85"
        />
      );
    case 'crown':
      return (
        <path
          d="M250 62 L262 22 L284 48 L300 14 L316 48 L338 22 L350 62 Z"
          fill={c}
          stroke={style.outline}
          strokeWidth="4"
        />
      );
    case 'star': {
      const star = (x: number, y: number, s: number) =>
        `M${x} ${y - s} L${x + s * 0.25} ${y - s * 0.25} L${x + s} ${y} L${x + s * 0.25} ${y + s * 0.25} L${x} ${y + s} L${x - s * 0.25} ${y + s * 0.25} L${x - s} ${y} L${x - s * 0.25} ${y - s * 0.25} Z`;
      return (
        <g fill={c}>
          <path d={star(92, 70, 26)} />
          <path d={star(512, 196, 20)} />
        </g>
      );
    }
    case 'arrow':
      return (
        <g stroke={c} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M110 206 Q 320 236 500 186" />
          <path d="M470 172 L502 186 L478 212" />
        </g>
      );
    default:
      return null;
  }
}

/**
 * A player's spray tag (src/achievements/tags.ts): their username in their
 * graffiti style. On the board (`still` off) it is sprayed over it after a
 * checkmate, left to right with a hiss, the drips running last, and then
 * stays on the final position; `still` draws it at once (the picker).
 */
export function SprayTag({
  username,
  styleId,
  still = false,
  sound = false,
}: {
  username: string;
  styleId: string | null | undefined;
  still?: boolean;
  sound?: boolean;
}) {
  const style = tagById(styleId);
  const d = useMemo(() => drawing(username), [username]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void loadFont(style.font, username).then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [style.font, username]);
  useEffect(() => {
    if (!ready || still || !sound) return;
    const timer = setTimeout(() => playSound('spray'), SPRAY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready, still, sound]);
  if (!ready) return still ? <div className="spray-tag still" /> : null;

  return (
    <div className={`spray-tag${still ? ' still' : ''}`} aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} className="spray-tag-art">
        <defs>
          <radialGradient id={`mist-${style.id}`}>
            <stop offset="0%" stopColor={style.color} stopOpacity="0.32" />
            <stop offset="100%" stopColor={style.color} stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx={W / 2} cy={H / 2 + 8} rx={300} ry={115} fill={`url(#mist-${style.id})`} />
        <g fill={style.color}>
          {d.dots.map((dot, i) => (
            <circle key={i} cx={dot.x} cy={dot.y} r={dot.r} opacity={dot.o} />
          ))}
        </g>
        <Deco style={style} d={d} />
        <text
          x={W / 2}
          y={H / 2 + d.size * 0.32}
          textAnchor="middle"
          fontFamily={`"${style.font}", var(--marker), cursive`}
          fontSize={d.size}
          fill={style.color}
          stroke={style.outline}
          strokeWidth={6}
          paintOrder="stroke"
          strokeLinejoin="round"
        >
          {username}
        </text>
      </svg>
    </div>
  );
}
