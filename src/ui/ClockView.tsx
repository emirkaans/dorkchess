import { useEffect, useState } from 'react';
import { LOW_TIME_MS, formatClock, remainingMs } from '../clock/clock.ts';
import type { ClockState } from '../clock/clock.ts';
import type { Color } from '../engine/index.ts';
import { useI18n } from './i18n.tsx';

interface Props {
  clock: ClockState;
  color: Color;
}

/** One side's clock: pink while running, tenths in the last 10 seconds. */
export function ClockView({ clock, color }: Props) {
  // Only this component re-renders while the clock runs.
  const { t } = useI18n();
  const [, setTick] = useState(0);
  const running = clock.running === color;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [running]);
  const ms = remainingMs(clock, color, Date.now());
  const classes = ['clock', running ? 'running' : '', ms < LOW_TIME_MS ? 'low' : ''].join(' ');
  return (
    <div className={classes} role="timer" aria-label={t('clock.label', { color: t(`color.${color}`) })}>
      <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="13" r="8" />
        <path d="M12 9v4l2 2M9 2h6" />
      </svg>
      <span className="clock-time">{formatClock(ms)}</span>
    </div>
  );
}
