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
// Mailpit (ex-Inbucket) de la stack locale : `npx supabase status` → MAILPIT_URL
const MAIL_URL = process.env.MAIL_URL ?? 'http://127.0.0.1:54324';
const PASSWORD = 'motdepasse123';
const NEW_PASSWORD = 'nouveaumotdepasse456';
const stamp = Date.now();
const emails = {
  student: `eleve.${stamp}@example.com`,
  prof: `prof.${stamp}@example.com`,
  admin: `admin.${stamp}@example.com`,
  minor: `mineur.${stamp}@example.com`,
  student2: `eleve2.${stamp}@example.com`,
};

mkdirSync(SHOT_DIR, { recursive: true });
const results = [];
let lastPage = null; // dernière page ouverte : capture d'écran en cas d'échec d'un flux

function sql(query) {
  return execFileSync('docker', ['exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-tAc', query], { encoding: 'utf8' }).trim();
}

// Date AAAA-MM-JJ à Zurich, décalée de `days` jours.
function zurichDate(days = 0) {
  const d = new Date(Date.now() + days * 24 * 3600 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(d);
}

// Dernier lien de réinitialisation reçu par `to` dans Mailpit (null si Mailpit est injoignable).
async function resetLinkFor(to, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const list = await fetch(`${MAIL_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`).then((r) => r.json());
    const msg = list.messages?.[0];
    if (msg) {
      const full = await fetch(`${MAIL_URL}/api/v1/message/${msg.ID}`).then((r) => r.json());
      const m = /href="([^"]*\/auth\/v1\/verify[^"]*)"/.exec(full.HTML ?? '') ?? /(http\S*\/auth\/v1\/verify\S*)/.exec(full.Text ?? '');
      if (m) return m[1].replace(/&amp;/g, '&');
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`aucun e-mail de réinitialisation pour ${to}`);
}

async function shot(page, name) {
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png` });
}

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 1, locale: 'fr-CH' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  lastPage = page;
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

async function login(page, email, password = PASSWORD) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

const tabsVisible = (page) => page.getByText('Classement', { exact: true }).first().waitFor();

async function flow(name, fn) {
  try {
    const evidence = await fn();
    results.push({ name, status: 'PASS', evidence });
  } catch (e) {
    results.push({ name, status: 'FAIL', evidence: String(e.message).split('\n').slice(0, 3).join(' | ') });
    await lastPage?.screenshot({ path: `${SHOT_DIR}/FAIL-${name.split('.')[0]}.png` }).catch(() => undefined);
  }
  console.log(`${results.at(-1).status}  ${name}  ${results.at(-1).evidence ?? ''}`);
}

const browser = await chromium.launch();
let profPassword = PASSWORD; // devient NEW_PASSWORD si le flux 7 aboutit

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
  await page.getByText(`parent.${stamp}@example.com`).waitFor();
  // sans Resend configuré localement l'envoi échoue : l'écran ne doit pas prétendre l'inverse
  await page.waitForTimeout(3000);
  const notSent = await page.getByText("l'e-mail n'a pas pu lui être envoyé", { exact: false }).count();
  const sent = await page.getByText("l'e-mail qui lui a été envoyé", { exact: false }).count();
  await shot(page, '4-minor-pending');
  await page.context().close();
  if (notSent + sent !== 1) throw new Error(`texte d'envoi incohérent (notSent=${notSent}, sent=${sent})`);
  return `adresse du parent affichée ; envoi ${notSent ? 'échoué → texte « non envoyé » + bouton renvoyer' : 'réussi'}`;
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

await flow('6. Langue enregistrée : reconnexion (nouvel onglet) puis rechargement, toujours en allemand', async () => {
  const page = await newPage(browser); // navigateur en fr-CH : l'allemand vient du profil
  await login(page, emails.student);
  await page.getByText('Rangliste', { exact: true }).first().waitFor();
  await page.reload();
  await page.getByText('Rangliste', { exact: true }).first().waitFor();
  await shot(page, '6-reload-deutsch');
  await page.context().close();
  return 'Rangliste après connexion et après rechargement';
});

await flow('7. Mot de passe oublié → lien Mailpit → nouveau mot de passe → connexion', async () => {
  const reachable = await fetch(`${MAIL_URL}/api/v1/info`).then((r) => r.ok).catch(() => false);
  if (!reachable) return `NON VÉRIFIÉ : Mailpit injoignable sur ${MAIL_URL}`;
  const email = emails.prof; // compte en français
  const page = await newPage(browser);
  await page.goto(`${BASE_URL}/forgot-password`);
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Envoyer le lien' }).click();
  await page.getByText('Si un compte existe').waitFor();
  const link = await resetLinkFor(email);
  if (!decodeURIComponent(link).includes('/reset-password')) throw new Error(`redirect_to inattendu : ${link}`);
  await page.goto(link);
  await page.getByLabel('Nouveau mot de passe').waitFor();
  await page.waitForTimeout(1000); // pas de redirection vers les onglets
  if (!page.url().includes('reset-password')) throw new Error(`redirigé vers ${page.url()}`);
  await shot(page, '7a-reset-form');
  await page.getByLabel('Nouveau mot de passe').fill(NEW_PASSWORD);
  await page.getByLabel('Confirmer le mot de passe').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Changer le mot de passe' }).click();
  await page.getByText('Mot de passe modifié').waitFor();
  await login(page, email, NEW_PASSWORD);
  await tabsVisible(page);
  profPassword = NEW_PASSWORD;
  await shot(page, '7b-login-new-password');
  await page.context().close();
  return 'lien reçu, mot de passe changé, connexion avec le nouveau mot de passe';
});

// ---------------------------------------------------------------------------
// Plan 2 : cours. Les flux 8 à 13 s'enchaînent (le cours créé au flux 8 sert aux suivants).
// ---------------------------------------------------------------------------
const adminProfileId = () => sql(`select id from profiles where email='${emails.admin}'`);
const seriesIds = () =>
  sql(`select id from courses where created_by='${adminProfileId()}' and sport='mma' order by starts_at`).split('\n').filter(Boolean);
const courseStatus = (id) => sql(`select status from courses where id='${id}'`);
const startDate = zurichDate(1);
const untilDate = zurichDate(15); // 3 occurrences hebdomadaires : J+1, J+8, J+15

await flow('8. Admin crée un cours récurrent → visible dans le planning', async () => {
  const page = await newPage(browser);
  await login(page, emails.admin);
  await tabsVisible(page);
  await page.getByRole('tab', { name: 'Cours' }).click();
  await page.getByRole('button', { name: 'Nouveau cours' }).click();
  // le planning reste monté derrière le formulaire (mêmes puces « MMA ») : cibler la rangée sous le libellé « Sport »
  await page.getByText('Sport', { exact: true }).locator('xpath=following-sibling::*[1]').getByRole('button', { name: 'MMA' }).click();
  await page.getByLabel('Date (AAAA-MM-JJ)').fill(startDate);
  await page.getByLabel('Début (HH:MM)').fill('18:30');
  await page.getByLabel('Fin (HH:MM)').fill('20:00');
  await page.getByRole('switch', { name: 'Cours récurrent' }).click();
  await page.getByLabel("Répéter chaque semaine jusqu'au (AAAA-MM-JJ)").fill(untilDate);
  await shot(page, '8a-admin-form');
  await page.getByRole('button', { name: 'Créer le cours' }).click();
  await page.getByRole('button', { name: 'Nouveau cours' }).waitFor(); // retour au planning
  const ids = seriesIds();
  if (ids.length !== 3) throw new Error(`${ids.length} occurrences en base au lieu de 3`);
  // semaine du premier cours : on avance jusqu'à voir la carte MMA
  for (let i = 0; i < 3 && !(await page.getByText('Créneau libre').count()); i++) {
    await page.getByRole('button', { name: 'Semaine suivante' }).click();
    await page.waitForTimeout(800);
  }
  await page.getByText('Créneau libre').first().waitFor();
  await shot(page, '8b-admin-planning');
  await page.context().close();
  return `3 occurrences (${startDate} → ${untilDate}), « Créneau libre » dans le planning`;
});

await flow('9. Élève réserve puis se désinscrit', async () => {
  const page = await newPage(browser);
  await signup(page, { email: emails.student2, role: 'eleve', age: 28, firstName: 'Eve' });
  await tabsVisible(page);
  await page.getByRole('tab', { name: 'Cours' }).click();
  for (let i = 0; i < 3 && !(await page.getByText('Créneau libre').count()); i++) {
    await page.getByRole('button', { name: 'Semaine suivante' }).click();
    await page.waitForTimeout(800);
  }
  const card = page.getByText('0 / 20 inscrits').first();
  await card.waitFor();
  await page.getByRole('button', { name: 'Réserver' }).first().click();
  await page.getByText('1 / 20 inscrits').first().waitFor();
  await shot(page, '9a-booked');
  await page.getByRole('button', { name: 'Se désinscrire' }).first().click();
  await page.getByText('0 / 20 inscrits').first().waitFor();
  await shot(page, '9b-unbooked');
  // se réinscrit : ce booking sert à l'appel (flux 11) et à l'annulation (flux 12)
  await page.getByRole('button', { name: 'Réserver' }).first().click();
  await page.getByText('1 / 20 inscrits').first().waitFor();
  const [c1] = seriesIds();
  const n = sql(`select count(*) from bookings where course_id='${c1}' and cancelled_at is null`);
  if (n !== '1') throw new Error(`réservation active attendue en base, trouvé ${n}`);
  await page.context().close();
  return 'réservé (1/20) → désinscrit (0/20) → réservé de nouveau';
});

await flow('10. Prof prend un créneau vacant', async () => {
  const [c1] = seriesIds();
  const page = await newPage(browser);
  await login(page, emails.prof, profPassword);
  await tabsVisible(page);
  await page.goto(`${BASE_URL}/courses/${c1}`);
  await page.getByText('Créneau libre').waitFor();
  await page.getByRole('button', { name: 'Prendre ce cours' }).click();
  await page.getByText('Prof : Paul Test').waitFor();
  await shot(page, '10-prof-took');
  const prof = sql(`select p.email from courses c join profiles p on p.id=c.prof_id where c.id='${c1}'`);
  await page.context().close();
  if (prof !== emails.prof) throw new Error(`prof en base : ${prof}`);
  return 'Prof : Paul Test affiché, prof_id en base';
});

await flow("11. Prof fait l'appel (cours placé dans le passé proche)", async () => {
  const [c1] = seriesIds();
  sql(`update courses set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' where id='${c1}'`);
  const page = await newPage(browser);
  await login(page, emails.prof, profPassword);
  await tabsVisible(page);
  await page.goto(`${BASE_URL}/courses/${c1}`);
  await page.getByText('Participants', { exact: true }).waitFor();
  await page.getByText('Eve Test').waitFor();
  await page.getByRole('checkbox', { name: 'Présent : Eve Test' }).click();
  // react-native-web n'expose pas aria-checked : la coche « ✓ » dans la case est le signal visible
  await page.locator('[aria-label="Présent : Eve Test"]').getByText('✓').waitFor();
  if (await page.getByText('belts.', { exact: false }).count()) throw new Error('clé i18n brute « belts.* » affichée');
  await shot(page, '11-attendance');
  const present = sql(`select a.present from attendance a join profiles p on p.id=a.profile_id where a.course_id='${c1}' and p.email='${emails.student2}'`);
  await page.context().close();
  if (present !== 't') throw new Error(`attendance.present = '${present}'`);
  return 'Eve Test cochée présente, ligne attendance en base';
});

await flow("12. Admin annule « ce cours et les suivants » → Annulé + outbox course_cancelled", async () => {
  const [, c2, c3] = seriesIds();
  const eve = sql(`select id from profiles where email='${emails.student2}'`);
  sql(`insert into bookings (course_id, profile_id, booked_by) values ('${c2}','${eve}','${eve}')`); // inscrit à notifier
  const page = await newPage(browser);
  await login(page, emails.admin);
  await tabsVisible(page);
  await page.goto(`${BASE_URL}/courses/${c2}`);
  await page.getByRole('button', { name: 'Annuler le cours' }).click();
  await page.getByRole('button', { name: 'Ce cours et les suivants' }).click();
  await shot(page, '12a-cancel-confirm');
  await page.getByRole('button', { name: "Confirmer l'annulation" }).click();
  await page.getByText('Annulé', { exact: true }).first().waitFor();
  await shot(page, '12b-cancelled');
  await page.context().close();
  const st = [courseStatus(c2), courseStatus(c3)];
  if (st.some((x) => x !== 'annule')) throw new Error(`statuts ${st}`);
  const rows = sql(`select count(*) from notification_outbox where kind='course_cancelled' and course_id='${c2}' and profile_id='${eve}'`);
  if (Number(rows) < 1) throw new Error(`aucune ligne course_cancelled pour le cours ${c2}`);
  return `occurrences 2 et 3 « annule », ${rows} ligne(s) course_cancelled en outbox`;
});

await flow('13. process_course_schedule() : cours vacant commencé → Open Mat', async () => {
  const [c1] = seriesIds();
  const vacantStarted = sql(
    `insert into courses (sport, level, kind, location_id, starts_at, ends_at, places, created_by)
     select 'mma','adulte','normal', location_id, now() - interval '30 minutes', now() + interval '30 minutes', 20, created_by from courses where id='${c1}' returning id`,
  ).split('\n')[0];
  const vacantSoon = sql(
    `insert into courses (sport, level, kind, location_id, starts_at, ends_at, places, created_by)
     select 'mma','adulte','normal', location_id, now() + interval '3 hours', now() + interval '4 hours', 20, created_by from courses where id='${c1}' returning id`,
  ).split('\n')[0];
  sql('select process_course_schedule()');
  const st = courseStatus(vacantStarted);
  if (st !== 'open_mat') throw new Error(`statut ${st} au lieu de open_mat`);
  const vac = sql(`select count(*) from notification_outbox where kind='slot_vacant' and course_id='${vacantSoon}'`);
  if (Number(vac) < 1) throw new Error('aucune ligne slot_vacant pour le cours vacant dans moins de 24 h');
  const page = await newPage(browser);
  await login(page, emails.student2);
  await tabsVisible(page);
  await page.goto(`${BASE_URL}/courses/${vacantStarted}`);
  await page.getByText('Open Mat', { exact: true }).waitFor();
  await shot(page, '13-open-mat');
  await page.context().close();
  return `open_mat affiché ; ${vac} ligne(s) slot_vacant pour le cours dans 3 h`;
});

await browser.close();
const failed = results.filter((r) => r.status !== 'PASS');
console.log(`\n${results.length - failed.length}/${results.length} flux OK`);
process.exit(failed.length ? 1 : 0);
