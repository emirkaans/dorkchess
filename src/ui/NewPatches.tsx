import type { MessageKey } from '../i18n/index.ts';
import { useAccount } from './account.ts';
import { useI18n } from './i18n.tsx';
import { ProfileLink } from './ProfileLink.tsx';

/** "New patch!" after a result that earned some, with a link to the jacket. */
export function NewPatches({ ids }: { ids: readonly string[] }) {
  const { t } = useI18n();
  const account = useAccount();
  if (!ids.length) return null;
  return (
    <div className="new-patches" role="status">
      <strong>{t('jacket.newPatch')}</strong>
      <span>{ids.map((id) => t(`patch.${id}` as MessageKey)).join(' · ')}</span>
      {account.user && <ProfileLink username={account.user.username}>{t('jacket.see')}</ProfileLink>}
    </div>
  );
}
