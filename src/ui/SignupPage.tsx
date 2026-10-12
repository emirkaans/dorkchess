import { useEffect, useState } from 'react';
import { USERNAME_MAX, usernameProblem } from '../online/account.ts';
import type { UsernameProblem } from '../online/account.ts';
import { checkUsername, chooseUsername, useAccount } from './account.ts';
import { useI18n } from './i18n.tsx';

/**
 * /signup: after the first sign-in with Google, the player picks the username
 * everyone will see (it cannot be changed later).
 */
export function SignupPage({ onDone }: { onDone: (returnTo: string) => void }) {
  const { t } = useI18n();
  const account = useAccount();
  const [name, setName] = useState<string | null>(null);
  const value = name ?? account.signup?.suggested ?? '';
  const [problem, setProblem] = useState<UsernameProblem | 'network' | null>(null);
  const [busy, setBusy] = useState(false);
  const returnTo = new URLSearchParams(location.search).get('return') || '/';

  // Already has an account (or signed in meanwhile): nothing to pick.
  useEffect(() => {
    if (account.user) onDone(returnTo);
  }, [account.user, onDone, returnTo]);

  // Checks the name shortly after typing stops.
  useEffect(() => {
    const local = usernameProblem(value);
    if (local || !value) {
      setProblem(value ? local : null);
      return;
    }
    let live = true;
    const id = setTimeout(() => {
      void checkUsername(value).then((p) => live && setProblem(p));
    }, 350);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [value]);

  if (account.loading) {
    return (
      <main className="online-lobby">
        <div className="online-card">
          <p className="muted">{t('online.connecting')}</p>
        </div>
      </main>
    );
  }

  if (!account.signup) {
    return (
      <main className="online-lobby">
        <div className="online-card">
          <h1 className="signup-title">{t('signup.title')}</h1>
          <p className="muted">{t('signup.expired')}</p>
        </div>
      </main>
    );
  }

  const submit = async () => {
    setBusy(true);
    const p = await chooseUsername(value.trim());
    setBusy(false);
    if (p) setProblem(p);
  };

  return (
    <main className="online-lobby">
      <form
        className="online-card signup-card"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h1 className="signup-title">{t('signup.title')}</h1>
        <p className="muted online-lede">{t('signup.lede')}</p>
        <label className="analysis-field">
          <span>{t('signup.username')}</span>
          <input
            value={value}
            maxLength={USERNAME_MAX}
            onChange={(e) => setName(e.target.value)}
            autoComplete="username"
            autoFocus
            spellCheck={false}
            aria-invalid={!!problem}
            aria-describedby="signup-rules"
          />
        </label>
        <p id="signup-rules" className={problem ? 'error' : 'muted signup-rules'}>
          {problem ? t(`signup.problem.${problem}`) : t('signup.rules')}
        </p>
        <button type="submit" className="primary analysis-go" disabled={busy || !!problem || !value}>
          {busy ? t('signup.saving') : t('signup.submit')}
        </button>
        <p className="muted signup-legal">
          {t('signup.legal')} <a href="/terms">{t('legal.terms')}</a> · <a href="/privacy">{t('legal.privacy')}</a>
        </p>
      </form>
    </main>
  );
}
