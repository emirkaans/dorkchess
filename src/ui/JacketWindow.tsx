import { useEffect, useRef, useState } from 'react';
import { JACKETS, jacketOpen, progress } from '../achievements/jackets.ts';
import { PATCHES } from '../achievements/patches.ts';
import type { MessageKey } from '../i18n/index.ts';
import type { ProfileResponse } from '../online/profile.ts';
import { BattleJacket, PatchMark, jacketSrc } from './BattleJacket.tsx';
import { useI18n } from './i18n.tsx';
import { Modal } from './Modal.tsx';

/** Narrow screens show fewer items per page so the window fits. */
function useNarrow(): boolean {
  const query = '(max-width: 760px)';
  const [narrow, setNarrow] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

/** "‹ 2 / 3 ›" under a paged list. */
function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  const { t } = useI18n();
  if (pages < 2) return null;
  return (
    <div className="pager">
      <button aria-label={t('pager.prev')} disabled={page === 0} onClick={() => onPage(page - 1)}>
        ‹
      </button>
      <span aria-live="polite">{t('pager.page', { page: String(page + 1), pages: String(pages) })}</span>
      <button aria-label={t('pager.next')} disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>
        ›
      </button>
    </div>
  );
}

interface Props {
  profile: ProfileResponse;
  /** The player is looking at their own profile (may pick a jacket). */
  mine: boolean;
  date: (ms: number) => string;
  onPick: (id: string) => Promise<void>;
  onShare: (svg: SVGSVGElement) => Promise<void>;
  onClose: () => void;
}

/**
 * The jacket big, with every patch (earned or locked) or, for its owner, the
 * jackets to pick from. Both lists come in pages so the window fits the screen.
 */
export function JacketWindow({ profile, mine, date, onPick, onShare, onClose }: Props) {
  const { t } = useI18n();
  const narrow = useNarrow();
  const svg = useRef<SVGSVGElement>(null);
  const [sharing, setSharing] = useState(false);
  const [tab, setTab] = useState<'patches' | 'jackets'>('patches');
  const [page, setPage] = useState(0);
  const per = tab === 'patches' ? (narrow ? 3 : 8) : narrow ? 4 : 6;
  const items = tab === 'patches' ? PATCHES.length : JACKETS.length;
  const pages = Math.ceil(items / per);
  const shown = Math.min(page, pages - 1);
  const show = (next: 'patches' | 'jackets') => {
    setTab(next);
    setPage(0);
  };

  return (
    <Modal label={t('jacket.title')} className="jacket-modal" onClose={onClose}>
      <div className="jacket-window">
        <div className="jacket-stage">
          <BattleJacket
            ref={svg}
            username={profile.username}
            jacket={profile.jacket}
            patches={profile.patches.map((p) => p.id)}
          />
          <div className="jacket-buttons">
            <button
              className="jacket-share"
              disabled={sharing}
              onClick={() => {
                if (!svg.current) return;
                setSharing(true);
                void onShare(svg.current).finally(() => setSharing(false));
              }}
            >
              {t('jacket.share')}
            </button>
            {mine && (
              <button
                className="jacket-share"
                aria-pressed={tab === 'jackets'}
                onClick={() => show(tab === 'jackets' ? 'patches' : 'jackets')}
              >
                {tab === 'jackets' ? t('jacket.showPatches') : t('jacket.pick')}
              </button>
            )}
          </div>
        </div>

        <div className="jacket-panel">
          {tab === 'patches' ? (
            <>
              <h2>
                {t('jacket.title')} · {profile.patches.length}/{PATCHES.length}
              </h2>
              <ul className="patch-list">
                {PATCHES.slice(shown * per, shown * per + per).map((patch) => {
                  const got = profile.patches.find((p) => p.id === patch.id);
                  return (
                    <li key={patch.id} className={got ? 'got' : 'locked'}>
                      <svg viewBox="-36 -36 72 72" aria-hidden="true">
                        <PatchMark patch={patch} label={t(`patch.${patch.id}` as MessageKey)} locked={!got} />
                      </svg>
                      <span>
                        <strong>{t(`patch.${patch.id}` as MessageKey)}</strong>
                        <small>{t(`patch.${patch.id}.how` as MessageKey)}</small>
                        {got && <small className="patch-date">{date(got.earnedAt)}</small>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <>
              <h2>{t('jacket.pickTitle')}</h2>
              <ul className="jacket-picker">
                {JACKETS.slice(shown * per, shown * per + per).map((j) => {
                  const open = jacketOpen(j, profile.stats);
                  const on = j.id === profile.jacket;
                  return (
                    <li key={j.id}>
                      <button
                        className={`jacket-option${on ? ' on' : ''}${open ? '' : ' locked'}`}
                        disabled={!open || on}
                        aria-pressed={on}
                        onClick={() => void onPick(j.id)}
                      >
                        <img src={jacketSrc(j.id, true)} alt="" loading="lazy" width="120" height="120" />
                        <strong>{t(`jacket.name.${j.id}` as MessageKey)}</strong>
                        {j.need && !open && (
                          <small>
                            🔒 {t(`jacket.need.${j.need.kind}`, { n: String(j.need.n) })} (
                            {Math.min(progress(j.need, profile.stats), j.need.n)}/{j.need.n})
                          </small>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <Pager page={shown} pages={pages} onPage={setPage} />
        </div>
      </div>
      <div className="modal-actions">
        <button className="primary" onClick={onClose} data-autofocus>
          {t('close')}
        </button>
      </div>
    </Modal>
  );
}
