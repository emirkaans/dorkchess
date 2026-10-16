import { useEffect, useRef, useState } from 'react';
import { CARD_FIT, Hiss, SPRAY_MS, Spray } from './spray/engine.ts';
import type { Fit } from './spray/engine.ts';
import { GAME_OVER_MS } from './GameOverOverlay.tsx';

/** How long a tag stays on the board once sprayed, before it fades (the board is wanted for analysis). */
const HOLD_MS = 2000;
/** The fade at the end (the CSS transition takes as long). */
const FADE_MS = 600;

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Sprays a tag on a canvas: after `delay`, in about SPRAY_MS, with the hiss when
 * `sound`. Starts again whenever `playKey` changes. Calls `onDone` once sprayed.
 */
function useSpray(
  canvas: React.RefObject<HTMLCanvasElement | null>,
  username: string,
  styleId: string,
  opts: { delay: number; sound: boolean; playKey?: number; onDone?: () => void },
) {
  const { delay, sound, playKey, onDone } = opts;
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const spray = new Spray(el);
    const hiss = new Hiss();
    let frame = 0;
    let timer = 0;
    const begin = () => {
      spray.setup(username, styleId);
      if (reducedMotion()) {
        spray.finish();
        done.current?.();
        return;
      }
      if (sound) hiss.start();
      const speed = spray.speedFor(SPRAY_MS);
      let last = performance.now();
      const tick = (now: number) => {
        const ms = Math.min(120, now - last);
        last = now;
        const over = spray.advance(ms, speed);
        if (sound) hiss.set(spray.penDown && !spray.done);
        if (over) {
          hiss.stop();
          done.current?.();
        } else frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    timer = window.setTimeout(begin, delay);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      hiss.stop();
    };
  }, [canvas, username, styleId, delay, sound, playKey]);
}

/**
 * The winner's tag over the board after a checkmate: sprayed as soon as the
 * "MATE!" is gone, kept for a moment, then faded out so the board can be
 * studied. Clicks pass through.
 */
export function SprayTag({
  username,
  styleId,
  sound,
}: {
  username: string;
  styleId: string | null | undefined;
  sound: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<'on' | 'fading' | 'gone'>('on');
  useSpray(ref, username, styleId ?? 'signature', {
    delay: GAME_OVER_MS,
    sound,
    onDone: () => setPhase('on'),
  });
  // From the start: delay, spraying, holding; then the fade and away.
  useEffect(() => {
    const fade = setTimeout(() => setPhase('fading'), GAME_OVER_MS + SPRAY_MS + 400 + HOLD_MS);
    const away = setTimeout(() => setPhase('gone'), GAME_OVER_MS + SPRAY_MS + 400 + HOLD_MS + FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(away);
    };
  }, [username, styleId]);
  if (phase === 'gone') return null;
  return <canvas ref={ref} className={`spray-tag${phase === 'fading' ? ' fading' : ''}`} aria-hidden="true" />;
}

/** A tag drawn at once (a profile, a style card). */
export function SprayStill({
  username,
  styleId,
  fit = CARD_FIT,
  className = '',
}: {
  username: string;
  styleId: string;
  fit?: Fit;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const draw = () => {
      const spray = new Spray(el);
      spray.setup(username, styleId, fit);
      spray.finish();
    };
    draw();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(draw) : null;
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [username, styleId, fit]);
  return <canvas ref={ref} className={`spray-still ${className}`} aria-hidden="true" />;
}

/** A tag sprayed on demand (the style picker's try-out board): again each time `playKey` changes. */
export function SprayPlayer({
  username,
  styleId,
  playKey,
  sound,
}: {
  username: string;
  styleId: string;
  playKey: number;
  sound: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useSpray(ref, username, styleId, { delay: 80, sound, playKey });
  return <canvas ref={ref} className="spray-player" aria-hidden="true" />;
}
