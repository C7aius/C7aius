import { consentSendErrorKey, deleteAccountErrorKey } from '../functionErrors';

const err = (status: number, body?: unknown) => ({
  context: { status, json: async () => (body === undefined ? Promise.reject(new Error('no body')) : body) },
});

describe('consentSendErrorKey', () => {
  it('maps 400 (own email / missing address)', async () => {
    expect(await consentSendErrorKey(err(400, { error: 'parent_email must differ from own email' }))).toBe('pending.ownEmail');
    expect(await consentSendErrorKey(err(400, { error: 'parent_email required' }))).toBe('pending.missingAddress');
  });
  it('maps 409 (locked / not eligible)', async () => {
    expect(await consentSendErrorKey(err(409, { error: 'parent_email_locked' }))).toBe('pending.locked');
    expect(await consentSendErrorKey(err(409, { error: 'consent not required' }))).toBe('pending.notEligible');
    expect(await consentSendErrorKey(err(409))).toBe('pending.notEligible');
  });
  it('maps 429, 502 and others', async () => {
    expect(await consentSendErrorKey(err(429))).toBe('pending.tooMany');
    expect(await consentSendErrorKey(err(502, { error: 'email delivery failed' }))).toBe('pending.deliveryFailed');
    expect(await consentSendErrorKey(err(500))).toBe('errors.generic');
    expect(await consentSendErrorKey({ context: { status: 409 } })).toBe('pending.notEligible');
    expect(await consentSendErrorKey(null)).toBe('errors.generic');
  });
});

describe('deleteAccountErrorKey', () => {
  it('maps 409 to the last-admin message', async () => {
    expect(await deleteAccountErrorKey(err(409, { error: 'last_admin' }))).toBe('errors.lastAdminDelete');
    expect(await deleteAccountErrorKey(err(500))).toBe('errors.generic');
  });
});
