const flatten = (obj: Record<string, unknown>, prefix = ''): Record<string, unknown> =>
  Object.entries(obj).reduce<Record<string, unknown>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') {
      Object.assign(acc, flatten(value as Record<string, unknown>, path));
    } else {
      acc[path] = value;
    }
    return acc;
  }, {});

const fr = flatten(require('../locales/fr.json'));
const frKeys = Object.keys(fr).sort();

describe.each(['de', 'en', 'ru'])('locale %s', (lang) => {
  const flat = flatten(require(`../locales/${lang}.json`));

  it('has the same keys as fr.json', () => {
    expect(Object.keys(flat).sort()).toEqual(frKeys);
  });

  it('has no empty values', () => {
    const empty = Object.entries(flat).filter(
      ([, v]) => typeof v !== 'string' || v.trim() === '',
    );
    expect(empty).toEqual([]);
  });
});

it('fr.json has no empty values', () => {
  const empty = Object.entries(fr).filter(([, v]) => typeof v !== 'string' || v.trim() === '');
  expect(empty).toEqual([]);
});
