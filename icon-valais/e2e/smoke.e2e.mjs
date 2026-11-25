// Smoke test de bout en bout (Playwright) contre le web app + la stack Supabase locale.
// Prérequis : `npx supabase start`, `.env` rempli, `npx expo start --web --port 8081`.
// Lancement : node e2e/smoke.e2e.mjs   (variables : BASE_URL, SHOT_DIR, DB_CONTAINER)
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8081';
const SHOT_DIR = process.env.SHOT_DIR ?? './e2e-screenshots';
const DB_CONTAINER = process.env.DB_CONTAINER ?? 'supabase_db_icon-valais';
const PASSWORD = 'motdepasse123';
const stamp = Date.now();
const emails = {
  student: `eleve.${stamp}@example.com`,
  prof: `prof.${stamp}@example.com`,
  admin: `admin.${stamp}@example.com`,
  minor: `mineur.${stamp}@example.com`,
};

mkdirSync(SHOT_DIR, { recursive: true });
const results = [];

function sql(query) {
  return execFileSync('docker', ['exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-tAc', query], { encoding: 'utf8' });
}

async function shot(page, name) {
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png` });
}

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 1, locale: 'fr-CH' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  return page;
}

async function signup(page, { email, role, age, parentEmail, firstName }) {
  await page.goto(`${BASE_URL}/signup`);
  await page.getByRole('button', { name: role === 'prof' ? 'Professeur' : 'Élève' }).click();
  await page.getByRole('button', { name: 'Suivant' }).click();
  await page.getByLabel('Prénom', { exact: true }).fill(firstName);
  await page.getByLabel('Nom', { exact: true }).fill('Test');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirmer le mot de passe').fill(PASSWORD);
  await page.getByLabel('Âge').fill(String(age));
  await page.getByRole('button', { name: 'Suivant' }).click();
  await page.getByRole('button', { name: 'Grappling' }).click();
  await page.getByLabel('Années de grappling').fill('2');
  if (role === 'prof') {
    await page.getByRole('button', { name: 'Suivant' }).click();
    await page.getByLabel("Années d'expérience de coach").fill('5');
  }
  if (parentEmail) {
    await page.getByRole('button', { name: 'Suivant' }).click();
    await page.getByLabel('E-mail du parent').fill(parentEmail);
  }
  await page.getByRole('button', { name: "S'inscrire" }).click();
}

async function login(page, email) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

const tabsVisible = (page) => page.getByText('Classement', { exact: true }).first().waitFor();

async function flow(name, fn) {
  try {
    const evidence = await fn();
    results.push({ name, status: 'PASS', evidence });
  } catch (e) {
    results.push({ name, status: 'FAIL', evidence: String(e.message).split('\n').slice(0, 3).join(' | ') });
  }
  console.log(`${results.at(-1).status}  ${name}  ${results.at(-1).evidence ?? ''}`);
}

const browser = await chromium.launch();

await flow('1. Élève adulte : inscription puis onglets', async () => {
  const page = await newPage(browser);
  await signup(page, { email: emails.student, role: 'eleve', age: 30, firstName: 'Eva' });
  await tabsVisible(page);
  await page.waitForTimeout(1500); // pas de redirection tardive vers /pending
  if (page.url().includes('pending')) throw new Error(`redirigé vers ${page.url()}`);
  await shot(page, '1-student-tabs');
  await page.context().close();
  return page.url();
});

await flow('2. Prof : inscription puis /pending en attente de validation', async () => {
  const page = await newPage(browser);
  await signup(page, { email: emails.prof, role: 'prof', age: 35, firstName: 'Paul' });
  await page.getByText('Compte en attente de validation').waitFor();
  if (!page.url().includes('pending')) throw new Error(`URL inattendue ${page.url()}`);
  await shot(page, '2-prof-pending');
  await page.context().close();
  return page.url();
});

await flow('3. Admin valide le prof, le prof accède aux onglets', async () => {
  const adminPage = await newPage(browser);
  await signup(adminPage, { email: emails.admin, role: 'eleve', age: 40, firstName: 'Ada' });
  await tabsVisible(adminPage);
  sql(`update profiles set role='admin' where email='${emails.admin}'`);
  await adminPage.context().close();

  const page = await newPage(browser);
  await login(page, emails.admin);
  await page.getByRole('tab', { name: 'Admin' }).click();
  await page.getByRole('button', { name: 'Profs en attente' }).click();
  await page.getByLabel('Rechercher').fill(emails.prof);
  await page.getByText('Paul Test').first().click();
  await shot(page, '3a-admin-detail');
  await page.getByRole('button', { name: 'Valider' }).click();
  await page.getByText('Validé', { exact: true }).first().waitFor();
  await shot(page, '3b-admin-validated');
  await page.context().close();

  const profPage = await newPage(browser);
  await login(profPage, emails.prof);
  await tabsVisible(profPage);
  await shot(profPage, '3c-prof-tabs');
  await profPage.context().close();
  return 'prof validé, onglets visibles';
});

await flow('4. Mineur (14 ans) : écran de consentement parental', async () => {
  const page = await newPage(browser);
  await signup(page, { email: emails.minor, role: 'eleve', age: 14, parentEmail: `parent.${stamp}@example.com`, firstName: 'Max' });
  await page.getByText('Consentement parental requis').waitFor();
  await shot(page, '4-minor-pending');
  await page.context().close();
  return 'écran /pending consentement affiché (envoi e-mail non vérifié ici)';
});

await flow('5. Profil : passage en Deutsch change les titres des onglets', async () => {
  const page = await newPage(browser);
  await login(page, emails.student);
  await tabsVisible(page);
  await page.getByRole('tab', { name: 'Profil' }).click();
  await page.getByRole('button', { name: 'Modifier mon profil' }).click();
  await page.getByRole('button', { name: 'Deutsch' }).click();
  await page.getByText('Rangliste', { exact: true }).first().waitFor();
  await shot(page, '5-profile-deutsch');
  await page.context().close();
  return 'Rangliste visible';
});

await browser.close();
const failed = results.filter((r) => r.status !== 'PASS');
console.log(`\n${results.length - failed.length}/${results.length} flux OK`);
process.exit(failed.length ? 1 : 0);
