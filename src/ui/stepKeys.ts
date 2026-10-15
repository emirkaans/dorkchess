import { useEffect, useRef } from 'react';

export type Step = 'back' | 'forward' | 'start' | 'end';

const STEPS: Record<string, Step> = {
  ArrowLeft: 'back',
  ArrowRight: 'forward',
  ArrowUp: 'start',
  Home: 'start',
  ArrowDown: 'end',
  End: 'end',
};

/**
 * Whether a key pressed on `el` is not for stepping through moves: typing in a
 * field, or moving around the board from the keyboard (Board marks itself
 * data-keyboard then). A square focused by a click leaves the arrow keys to the move list.
 */
export function keysTaken(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false; // window or document: no field, no board
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
  return el.closest('.board[data-keyboard]') !== null;
}

/** The step a key asks for, or null. */
export const stepOf = (key: string): Step | null => STEPS[key] ?? null;

/** Left / right step one move back / forward, up or Home to the start, down or End to the end. */
export function useStepKeys(onStep: ((step: Step) => void) | null) {
  const ref = useRef(onStep);
  useEffect(() => {
    ref.current = onStep;
  });
  const on = onStep !== null;
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const step = stepOf(e.key);
      if (!step || keysTaken(e.target) || !ref.current) return;
      e.preventDefault();
      ref.current(step);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [on]);
}
