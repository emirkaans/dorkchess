import { describe, expect, it } from 'vitest';
import { isStaffRole, mayDo } from '../src/online/admin.ts';
import { parseRoute, pathOf } from '../src/ui/routes.ts';

describe('staff roles', () => {
  it('lets admins do everything and moderators all but roles and other staff', () => {
    expect(mayDo('admin', 'set-role')).toBe(true);
    expect(mayDo('admin', 'ban', 'moderator')).toBe(true);
    expect(mayDo('moderator', 'ban')).toBe(true);
    expect(mayDo('moderator', 'rename-gang')).toBe(true);
    expect(mayDo('moderator', 'set-role')).toBe(false);
    expect(mayDo('moderator', 'ban', 'admin')).toBe(false);
    expect(mayDo('moderator', 'rename-user', 'moderator')).toBe(false);
    expect(mayDo(null, 'ban')).toBe(false);
  });

  it('knows the roles and the page address', () => {
    expect(isStaffRole('admin')).toBe(true);
    expect(isStaffRole('moderator')).toBe(true);
    expect(isStaffRole('owner')).toBe(false);
    expect(isStaffRole(null)).toBe(false);
    expect(parseRoute('/admin')).toEqual({ kind: 'admin' });
    expect(pathOf({ kind: 'admin' })).toBe('/admin');
  });
});
