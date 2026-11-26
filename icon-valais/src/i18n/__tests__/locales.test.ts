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
// i18next plural variants (CLDR suffixes) differ per language: compare base keys only
const PLURAL = /_(zero|one|two|few|many|other)$/;
const baseKeys = (flat: Record<string, unknown>) => [...new Set(Object.keys(flat).map((k) => k.replace(PLURAL, '')))].sort();
const frKeys = baseKeys(fr);

describe.each(['de', 'en', 'ru'])('locale %s', (lang) => {
  const flat = flatten(require(`../locales/${lang}.json`));

  it('has the same keys as fr.json', () => {
    expect(baseKeys(flat)).toEqual(frKeys);
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

describe('plural forms', () => {
  const required: Record<string, string[]> = {
    fr: ['one', 'other'],
    de: ['one', 'other'],
    en: ['one', 'other'],
    ru: ['one', 'few', 'many', 'other'],
  };
  it.each(Object.keys(required))('%s has every CLDR plural variant for each plural key', (lang) => {
    const flat = flatten(require(`../locales/${lang}.json`));
    const bases = Object.keys(flat).filter((k) => PLURAL.test(k)).map((k) => k.replace(PLURAL, ''));
    for (const base of new Set(bases)) {
      for (const cat of required[lang]) expect(flat).toHaveProperty([`${base}_${cat}`]);
    }
  });
});
