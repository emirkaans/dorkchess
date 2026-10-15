// Gangs: teams of players with a weekly score. Shapes of the gang API
// (server/gangs.ts) and its rules. Pure.

import { offensiveName } from './badwords.ts';

export const GANG_MAX_MEMBERS = 50;
/** The weekly score counts the last this many days. */
export const GANG_WEEK_DAYS = 7;
/** Points per online game won or drawn, and per daily puzzle solved, in the week. */
export const GANG_POINTS = { win: 2, draw: 1, daily: 1 } as const;

export interface GangSummary {
  readonly tag: string;
  readonly name: string;
  readonly members: number;
  /** Points of the members in the last GANG_WEEK_DAYS days. */
  readonly score: number;
}

export interface GangMember {
  readonly username: string;
  readonly score: number;
  readonly owner: boolean;
}

export interface GangDetail extends GangSummary {
  readonly createdAt: number;
  readonly list: readonly GangMember[];
}

export interface GangList {
  readonly gangs: readonly GangSummary[];
  /** The signed-in player's gang tag, or null. */
  readonly mine: string | null;
}

export type GangProblem = 'name' | 'tag' | 'taken' | 'in-gang' | 'full' | 'signed-out';

/** A gang tag as stored and shown: capital letters and digits. */
export const cleanTag = (tag: string): string => tag.trim().toUpperCase();

/** What is wrong with a new gang's name and tag, or null. */
export function gangProblem(name: string, tag: string): 'name' | 'tag' | null {
  const n = name.trim();
  if (n.length < 3 || n.length > 24 || !/^[\p{L}\p{N} _-]+$/u.test(n) || offensiveName(n.replace(/\s+/g, '')))
    return 'name';
  const t = cleanTag(tag);
  if (!/^[A-Z0-9]{2,4}$/.test(t) || offensiveName(t)) return 'tag';
  return null;
}

/** A member's weekly points from their week's results. */
export const gangScore = (wins: number, draws: number, dailies: number): number =>
  wins * GANG_POINTS.win + draws * GANG_POINTS.draw + dailies * GANG_POINTS.daily;
