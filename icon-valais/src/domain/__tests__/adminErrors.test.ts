import { rpcErrorKey } from '../adminErrors';

describe('rpcErrorKey', () => {
  it('maps database hints to specific messages', () => {
    expect(rpcErrorKey({ code: '42501', hint: 'last_admin' })).toBe('errors.lastAdmin');
    expect(rpcErrorKey({ code: '42501', hint: 'child_profile_role' })).toBe('errors.childProfileRole');
    expect(rpcErrorKey({ code: '22023', hint: 'child_must_be_minor' })).toBe('errors.childMustBeMinor');
  });
  it('maps course and location hints', () => {
    expect(rpcErrorKey({ hint: 'default_location_archived' })).toBe('errors.defaultLocationArchived');
    expect(rpcErrorKey({ hint: 'default_required' })).toBe('errors.defaultRequired');
    expect(rpcErrorKey({ hint: 'invalid_prof' })).toBe('errors.invalidProf');
    expect(rpcErrorKey({ hint: 'missing_field' })).toBe('errors.missingField');
    expect(rpcErrorKey({ hint: 'repeat_before_start' })).toBe('errors.repeatBeforeStart');
  });
  it('falls back to SQLSTATE codes', () => {
    expect(rpcErrorKey({ code: '42501', hint: null })).toBe('errors.notAllowed');
    expect(rpcErrorKey({ code: 'P0002' })).toBe('errors.notFound');
    expect(rpcErrorKey(null)).toBe('errors.generic');
  });
});
