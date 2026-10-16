// Running the site: staff roles, what each may do, and the shapes of the admin
// API (server/admin.ts). Pure.

export type StaffRole = 'admin' | 'moderator';

export type AdminAction =
  'ban' | 'unban' | 'rename-user' | 'set-role' | 'cancel-tournament' | 'rename-gang' | 'delete-gang';

export const isStaffRole = (role: unknown): role is StaffRole => role === 'admin' || role === 'moderator';

/**
 * Whether `role` may do `action` to an account with `targetRole` (null: not
 * staff, or the action has no account). Only admins give roles or act on
 * other staff.
 */
export function mayDo(role: StaffRole | null, action: AdminAction, targetRole: StaffRole | null = null): boolean {
  if (!role) return false;
  if (role === 'admin') return true;
  if (action === 'set-role') return false;
  return targetRole === null;
}

/** Error reports are kept this long. */
export const ERROR_KEEP_DAYS = 14;

export interface AdminStats {
  readonly users: number;
  readonly usersWeek: number;
  readonly banned: number;
  readonly gamesDay: number;
  readonly gamesTotal: number;
  readonly liveGames: number;
  readonly online: number;
  readonly tournamentsOpen: number;
  readonly gangs: number;
  readonly errorsDay: number;
}

export interface AdminUser {
  readonly id: string;
  readonly username: string;
  readonly createdAt: number;
  readonly role: StaffRole | null;
  readonly bannedAt: number | null;
  readonly banReason: string | null;
  readonly games: number;
}

export interface AdminTournament {
  readonly id: string;
  readonly name: string;
  readonly owner: string | null;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly players: number;
}

export interface AdminGang {
  readonly tag: string;
  readonly name: string;
  readonly members: number;
  readonly owner: string;
}

export interface AdminLogEntry {
  readonly at: number;
  readonly actor: string;
  readonly action: string;
  readonly target: string;
  readonly detail: string | null;
}

export interface AdminError {
  readonly at: number;
  readonly report: string;
}
