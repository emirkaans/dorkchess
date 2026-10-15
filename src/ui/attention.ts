// Getting the player back to a hidden tab, as lichess does: the tab title
// flashes a short message until the tab is seen again. (Sounds play anyway.)

import { useEffect } from 'react';

/** While `message` is set and the tab is hidden, the title alternates with it once a second. */
export function useAttention(message: string | null): void {
  useEffect(() => {
    if (!message || typeof document === 'undefined') return;
    const original = document.title;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
      document.title = original;
    };
    const update = () => {
      if (!document.hidden) return stop();
      if (timer) return;
      let on = true;
      timer = setInterval(() => {
        on = !on;
        document.title = on ? message : original;
      }, 1000);
      document.title = message;
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      stop();
    };
  }, [message]);
}
