import { useEffect, useState } from 'react';
import { LOW_TIME_MS, formatClock, remainingMs } from '../clock/clock.ts';
import type { ClockState } from '../clock/clock.ts';
import type { Color } from '../engine/index.ts';

const COLOR_NAME = { w: 'Beyaz', b: 'Siyah' } as const;

interface Props {
  clock: ClockState;
  color: Color;
  players: Readonly<Record<Color, { kind: string; level?: number }>>;
}

/** One side's clock: red with tenths in the last 10 seconds, highlighted while running. */
export function ClockView({ clock, color, players }: Props) {
  // Only this component re-renders while the clock runs.
  const [, setTick] = useState(0);
  const running = clock.running === color;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [running]);
  const ms = remainingMs(clock, color, Date.now());
  const p = players[color];
  const classes = ['clock', clock.running === color ? 'running' : '', ms < LOW_TIME_MS ? 'low' : ''].join(' ');
  return (
    <div className={classes} aria-label={`${COLOR_NAME[color]} saati`}>
      <span className="clock-name">
        {COLOR_NAME[color]}
        {p.kind === 'bot' ? ` · bot ${p.level}` : ''}
      </span>
      <span className="clock-time">{formatClock(ms)}</span>
    </div>
  );
}
