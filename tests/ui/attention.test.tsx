// @vitest-environment happy-dom
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAttention } from '../../src/ui/attention.ts';

function Probe({ message }: { message: string | null }) {
  useAttention(message);
  return null;
}

const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('sekme başlığında uyarı', () => {
  afterEach(() => {
    setHidden(false);
    vi.useRealTimers();
  });

  it('sekme gizliyken başlık yanıp söner, sekme görününce eski hâline döner', () => {
    vi.useFakeTimers();
    document.title = 'punkchess';
    setHidden(true);
    render(<Probe message="♟ Sıra sende!" />);
    expect(document.title).toBe('♟ Sıra sende!');
    act(() => vi.advanceTimersByTime(1000));
    expect(document.title).toBe('punkchess');
    act(() => vi.advanceTimersByTime(1000));
    expect(document.title).toBe('♟ Sıra sende!');
    act(() => setHidden(false));
    expect(document.title).toBe('punkchess');
  });

  it('sekme görünürken başlık değişmez', () => {
    document.title = 'punkchess';
    setHidden(false);
    render(<Probe message="♟ Sıra sende!" />);
    expect(document.title).toBe('punkchess');
  });
});
