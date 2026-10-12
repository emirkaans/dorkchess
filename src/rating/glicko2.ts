// Glicko-2 ratings (Mark Glickman, "Example of the Glicko-2 system", 2013),
// as lichess uses them: a rating, a deviation (how sure we are of it) and a
// volatility (how erratic the player is). Pure functions, no I/O.

export interface Glicko {
  /** Rating on the familiar scale (1500 to start). */
  readonly rating: number;
  /** Rating deviation: 350 for a newcomer, smaller as games are played. */
  readonly rd: number;
  /** Volatility: how much the rating is expected to swing. */
  readonly vol: number;
}

export const DEFAULT_GLICKO: Glicko = { rating: 1500, rd: 350, vol: 0.06 };

/** Above this deviation a rating is shown as provisional ("1500?"), as on lichess. */
export const PROVISIONAL_RD = 110;
const MIN_RD = 45;
const MAX_RD = 350;
const MAX_VOL = 0.1;
/** System constant: how much volatility may change (lichess: 0.75). */
const TAU = 0.75;
const SCALE = 173.7178;
/** Days without games over which a deviation grows back as much as one rating period's volatility. */
const DAYS_PER_PERIOD = 1;

/** A game's result for the player: 1 win, 0.5 draw, 0 loss. */
export interface GameResult {
  readonly opponent: Glicko;
  readonly score: 0 | 0.5 | 1;
}

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const expected = (mu: number, muJ: number, phiJ: number) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/** The deviation after `days` without games: uncertainty grows back with time. */
export function aged(p: Glicko, days: number): Glicko {
  if (days <= 0) return p;
  const phi = p.rd / SCALE;
  const grown = Math.sqrt(phi * phi + p.vol * p.vol * (days / DAYS_PER_PERIOD)) * SCALE;
  return { ...p, rd: Math.min(MAX_RD, grown) };
}

/**
 * The player's new rating after one rating period with these results (an
 * empty list only widens the deviation). Step numbers follow Glickman's paper.
 */
export function update(player: Glicko, results: readonly GameResult[]): Glicko {
  // Step 2: to the Glicko-2 scale.
  const mu = (player.rating - 1500) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.vol;
  if (!results.length) {
    return { ...player, rd: Math.min(MAX_RD, Math.sqrt(phi * phi + sigma * sigma) * SCALE) };
  }
  const opp = results.map((r) => ({
    mu: (r.opponent.rating - 1500) / SCALE,
    phi: r.opponent.rd / SCALE,
    s: r.score,
  }));

  // Steps 3 and 4: estimated variance and improvement.
  let vInv = 0;
  let deltaSum = 0;
  for (const o of opp) {
    const e = expected(mu, o.mu, o.phi);
    vInv += g(o.phi) ** 2 * e * (1 - e);
    deltaSum += g(o.phi) * (o.s - e);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;

  // Step 5: the new volatility (Illinois algorithm).
  const a = Math.log(sigma * sigma);
  const f = (x: number) =>
    (Math.exp(x) * (delta * delta - phi * phi - v - Math.exp(x))) / (2 * (phi * phi + v + Math.exp(x)) ** 2) -
    (x - a) / (TAU * TAU);
  const EPS = 0.000001;
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  for (let i = 0; i < 100 && Math.abs(B - A) > EPS; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else fA /= 2;
    B = C;
    fB = fC;
  }
  const newSigma = Math.min(MAX_VOL, Math.exp(A / 2));

  // Steps 6 to 8: new deviation and rating, back to the familiar scale.
  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * deltaSum;
  return {
    rating: newMu * SCALE + 1500,
    rd: Math.max(MIN_RD, Math.min(MAX_RD, newPhi * SCALE)),
    vol: newSigma,
  };
}

/** Both players' ratings after a game between them (`whiteScore`: 1, 0.5 or 0). */
export function rateGame(white: Glicko, black: Glicko, whiteScore: 0 | 0.5 | 1): { white: Glicko; black: Glicko } {
  const blackScore = (1 - whiteScore) as 0 | 0.5 | 1;
  return {
    white: update(white, [{ opponent: black, score: whiteScore }]),
    black: update(black, [{ opponent: white, score: blackScore }]),
  };
}

export const isProvisional = (p: Glicko) => p.rd > PROVISIONAL_RD;
