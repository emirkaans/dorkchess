/** Decorative punk shapes (crown, skull avatars). Hidden from screen readers. */

export function Crown({ className = '' }: { className?: string }) {
  return (
    <svg className={`crown ${className}`} viewBox="0 0 48 40" aria-hidden="true">
      <path d="M4 32L2 8L14 20L24 4L34 20L46 8L44 32Z" />
    </svg>
  );
}

const HEAD =
  'M50 18C31 18 20 31 20 47c0 10 4 17 10 21v10c0 3 2 5 5 5h30c3 0 5-2 5-5V68c6-4 10-11 10-21 0-16-11-29-30-29Z';

/** Skull avatar: a bot wears a crown, a human a mohawk. */
export function Avatar({ bot }: { bot: boolean }) {
  return (
    <svg className="avatar-skull" viewBox="0 -6 100 106" aria-hidden="true">
      {bot ? (
        <path className="avatar-crown" d="M30 22L28 4L40 14L50 0L60 14L72 4L70 22Z" />
      ) : (
        <path className="avatar-hawk" d="M34 24L38 2L45 18L50 -4L55 18L62 2L66 24Z" />
      )}
      <path className="avatar-bone" d={HEAD} />
      <circle className="avatar-hole" cx="38" cy="48" r="8" />
      <circle className="avatar-hole" cx="62" cy="48" r="8" />
      <path className="avatar-hole" d="M50 57l-5 9h10Z" />
      <path className="avatar-teeth" d="M40 74v8M47 74v8M54 74v8M61 74v8" />
    </svg>
  );
}

/** A few paint splatter dots. */
export function Splatter({ className = '' }: { className?: string }) {
  return (
    <svg className={`splatter ${className}`} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="30" cy="34" r="10" opacity=".55" />
      <circle cx="52" cy="20" r="4" opacity=".7" />
      <circle cx="18" cy="60" r="3" opacity=".6" />
      <circle cx="60" cy="44" r="2" />
    </svg>
  );
}
