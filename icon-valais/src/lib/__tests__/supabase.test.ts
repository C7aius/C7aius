jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

const URL_KEY = 'EXPO_PUBLIC_SUPABASE_URL';
const ANON_KEY = 'EXPO_PUBLIC_SUPABASE_ANON_KEY';

describe('supabase client', () => {
  const saved = { url: process.env[URL_KEY], key: process.env[ANON_KEY] };

  afterEach(() => {
    process.env[URL_KEY] = saved.url;
    process.env[ANON_KEY] = saved.key;
    if (saved.url === undefined) delete process.env[URL_KEY];
    if (saved.key === undefined) delete process.env[ANON_KEY];
    jest.resetModules();
  });

  it('throws a clear error when configuration is missing', () => {
    delete process.env[URL_KEY];
    delete process.env[ANON_KEY];
    expect(() => require('../supabase')).toThrow(/EXPO_PUBLIC_SUPABASE_URL/);
  });

  it('creates the client when configuration is present', () => {
    process.env[URL_KEY] = 'http://localhost:54321';
    process.env[ANON_KEY] = 'anon';
    expect(require('../supabase').supabase).toBeDefined();
  });
});
