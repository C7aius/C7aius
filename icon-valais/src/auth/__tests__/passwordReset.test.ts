import { APP_SCHEME, parseRecoveryUrl, resetRedirectUrl } from '../passwordReset';

const appJson = require('../../../app.json');

describe('resetRedirectUrl', () => {
  it('uses the app origin on web', () => {
    expect(resetRedirectUrl('web', 'http://localhost:8081')).toBe('http://localhost:8081/reset-password');
  });
  it('uses the app scheme on native, matching app.json', () => {
    expect(APP_SCHEME).toBe(appJson.expo.scheme);
    expect(resetRedirectUrl('ios')).toBe('iconvalais://reset-password');
    expect(resetRedirectUrl('android')).toBe('iconvalais://reset-password');
  });
  it('is allowed by supabase/config.jsonc additional_redirect_urls', () => {
    const fs = require('fs');
    const path = require('path');
    const config = fs.readFileSync(path.join(__dirname, '../../../supabase/config.jsonc'), 'utf8');
    const line = config.split('\n').find((l: string) => l.includes('"additional_redirect_urls"')) ?? '';
    expect(line).toContain('"iconvalais://reset-password"');
    expect(line).toContain('"http://localhost:8081/reset-password"');
  });
});

describe('parseRecoveryUrl', () => {
  it('extracts tokens from a recovery deep link', () => {
    expect(
      parseRecoveryUrl('iconvalais://reset-password#access_token=a.b.c&expires_in=3600&refresh_token=r1&token_type=bearer&type=recovery'),
    ).toEqual({ kind: 'tokens', accessToken: 'a.b.c', refreshToken: 'r1' });
  });
  it('reports link errors (expired link)', () => {
    expect(parseRecoveryUrl('iconvalais://reset-password#error=access_denied&error_code=otp_expired&error_description=x')).toEqual({
      kind: 'error',
      code: 'otp_expired',
    });
  });
  it('ignores other links', () => {
    expect(parseRecoveryUrl('iconvalais://reset-password')).toEqual({ kind: 'none' });
    expect(parseRecoveryUrl('iconvalais://x#access_token=a&refresh_token=b&type=signup')).toEqual({ kind: 'none' });
    expect(parseRecoveryUrl(null)).toEqual({ kind: 'none' });
  });
});
