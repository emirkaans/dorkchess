import { listVariants } from '../engine/index.ts';
import { useI18n } from './i18n.tsx';

/** Under the analysis of standard chess: which engine it is, its license and where its source is. */
export function EngineCredit({ variantId }: { variantId: string }) {
  const { t } = useI18n();
  if (variantId !== listVariants()[0].id) return null;
  return (
    <p className="muted engine-credit">
      {t('analysis.engineCredit')} ·{' '}
      <a href="/licenses" target="_blank" rel="noopener">
        {t('legal.licenses')}
      </a>
    </p>
  );
}
