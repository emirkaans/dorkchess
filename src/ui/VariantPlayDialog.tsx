import { useState } from 'react';
import { getVariant } from '../engine/index.ts';
import type { VariantDefinition } from '../engine/index.ts';
import { useI18n } from './i18n.tsx';
import { Modal } from './Modal.tsx';
import { FriendGame, SeekList } from './online/LobbyPage.tsx';
import type { Lobby } from './online/LobbyPage.tsx';
import type { Mode } from './settings.ts';

/**
 * Play one variant (a variant card on the home page): online first, an open
 * game in the lobby or a game for a friend, then the ways to play on this device.
 */
export function VariantPlayDialog({
  variant,
  lobby,
  onOpenGame,
  onPlayOffline,
  onClose,
}: {
  variant: VariantDefinition;
  lobby: Lobby;
  onOpenGame: (id: string) => void;
  /** Plays on this device: the mode and the variant picked in the dialog. */
  onPlayOffline: (mode: Mode, variantId: string) => void;
  onClose: () => void;
}) {
  const { t, vt } = useI18n();
  const [tab, setTab] = useState<'seeks' | 'friend'>('seeks');
  // The variant can be changed in the forms; the heading follows it.
  const [variantId, setVariantId] = useState(variant.id);
  const texts = vt(getVariant(variantId));
  const mine = lobby.seeks.find((s) => s.id === lobby.mySeek) ?? null;
  return (
    <Modal label={texts.name} onClose={onClose} className="variant-play">
      <h2>{texts.name}</h2>
      <p className="muted variant-play-summary">{texts.rules.summary}</p>
      <div className="online-card lobby-card">
        <div className="lobby-tabs" role="tablist">
          {(['seeks', 'friend'] as const).map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? 'on' : ''}
              onClick={() => setTab(id)}
            >
              {t(id === 'seeks' ? 'lobby.findOpponent' : 'lobby.tab.friend')}
            </button>
          ))}
        </div>
        {lobby.error && <p className="error">{t(`lobby.error.${lobby.error}`)}</p>}
        {tab === 'seeks' && (
          <SeekList mine={mine} lobby={lobby} defaultVariantId={variantId} startPosting onVariant={setVariantId} />
        )}
        {tab === 'friend' && (
          <FriendGame onOpenGame={onOpenGame} defaultVariantId={variantId} onVariant={setVariantId} />
        )}
      </div>
      <section className="offline-play">
        <h3>{t('lobby.offline')}</h3>
        <div className="offline-buttons">
          {(['bot', 'botvbot', 'hotseat'] as const).map((mode) => (
            <button key={mode} onClick={() => onPlayOffline(mode, variantId)} title={t(`mode.${mode}`)}>
              {t(`mode.${mode}Short`)}
            </button>
          ))}
        </div>
      </section>
    </Modal>
  );
}
