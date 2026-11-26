# Icon Valais — Plan 1 : Fondations (comptes, rôles, profils) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une app Expo (iOS / Android / web) où l'on peut créer un compte élève ou prof, se connecter, gérer son profil et ses enfants. L'admin y valide les profs et gère les statuts.

**Architecture:** Un seul projet Expo (Expo Router, TypeScript) dans `icon-valais/` et un projet Supabase (Postgres + Auth + Edge Functions) dans `icon-valais/supabase/`. Les règles métier pures vivent dans `src/domain/` et sont testées avec Jest. Les droits sont appliqués côté base (RLS, triggers, fonctions RPC `security definer`) et testés avec pgTAP. L'interface n'est qu'un client.

**Tech Stack:** Expo SDK stable le plus récent (`npx create-expo-app@latest`), Expo Router, TypeScript strict, `@supabase/supabase-js`, `zod`, `i18next` + `react-i18next` + `expo-localization`, `jest-expo` + `@testing-library/react-native`, Supabase CLI (pgTAP via `supabase test db`), Resend (envoi de l'e-mail de consentement parental).

**Spec:** `docs/superpowers/specs/2026-11-25-icon-valais-design.md`

## Feuille de route (plans suivants, rédigés après celui-ci)

| Plan | Contenu | Sections du document de conception |
|---|---|---|
| 1 — Fondations (ce plan) | projet, thème, 4 langues, comptes, rôles, enfants, admin comptes, suppression de compte | §5, §11, §12 |
| 2 — Cours | lieux, cours, récurrence, créneaux vacants, Open Mat, cours privés, réservation (sans paiement), appel, notifications push | §6, §7, §10 |
| 3 — Paiements | Stripe : cours à l'unité, limite de 10 réservations, abonnements, tarifs étudiant/enfant, justificatif, remboursement sur annulation, quittances | §8 |
| 4 — Classements & admin | classement de régularité, tableau de bord, statistiques d'heures | §9 |
| 5 — Publication | icône, comptes Apple/Google, EAS Build/Submit, hébergement web, politique de confidentialité | §3, §12 |

## Global Constraints

- Nom affiché : **Icon Valais**. Couleurs : anthracite `#2B2B2B`, orange `#FF6A00`.
- Langues : `fr` (défaut), `de`, `en`, `ru` ; langue du téléphone par défaut, modifiable dans le profil.
- Connexion : e-mail + mot de passe uniquement.
- Aucune date de naissance, aucune donnée médicale. Âge : entier de 0 à 100.
- Supabase en région Zurich (`eu-central-2`).
- Rôles : `eleve`, `prof`, `admin`. L'admin est affiché « Prof » aux autres utilisateurs.
- Compte prof inactif tant que `prof_status <> 'valide'`.
- Âge < 16 sans parent : compte inactif tant que le parent n'a pas confirmé par e-mail.
- Ceintures adultes : blanche, bleue, violette, marron, noire. Si âge < 18 : grise, jaune, orange, verte en plus. Pas de barrettes.
- Toute règle de droit doit être appliquée en base, pas seulement dans l'interface.
- Code dans `icon-valais/` (sera déplacé dans un dépôt dédié plus tard : aucun chemin absolu, aucune référence au dépôt `C7aius`).

## Review Focus

1. **Âges limites** : 15 → consentement requis, 16 → non ; 17 → ceintures enfant visibles, 18 → non ; âge vide, négatif, décimal ou 101 → refusé. Testé dans la tâche 2.
2. **Escalade de droits** : un élève qui modifie lui-même `role`, `prof_status`, `paid_until` ou `student_status` via l'API → refusé. Testé dans la tâche 3.
3. **Prof en attente** : il se connecte et voit l'écran « en attente de validation », sans accès aux onglets prof. Testé dans les tâches 3 et 6.
4. **Profil enfant sans login** : seul son parent (ou l'admin) peut le lire ou le modifier ; un autre utilisateur ne voit que la vue publique. Testé dans la tâche 3.
5. **E-mail déjà utilisé** à l'inscription → message traduit, et le formulaire garde les données saisies. Testé dans la tâche 5.

---

### Task 1: Projet Expo, thème, langues

**Files:**
- Create: `icon-valais/` (via `npx create-expo-app@latest icon-valais --template tabs`), puis nettoyer les écrans d'exemple
- Create: `icon-valais/src/theme.ts`
- Create: `icon-valais/src/i18n/index.ts`, `icon-valais/src/i18n/locales/{fr,de,en,ru}.json`
- Create: `icon-valais/src/lib/supabase.ts`
- Create: `icon-valais/.env.example` (`EXPO_PUBLIC_SUPABASE_URL=`, `EXPO_PUBLIC_SUPABASE_ANON_KEY=`)
- Test: `icon-valais/src/i18n/__tests__/locales.test.ts`

**Interfaces:**
- Produces: `colors = { anthracite: '#2B2B2B', orange: '#FF6A00', white: '#FFFFFF', grey: '#8A8A8A', danger: '#D93025' }` ; `initI18n(lang?: Lang): Promise<void>` ; `type Lang = 'fr' | 'de' | 'en' | 'ru'` ; `supabase` (client typé, session persistée via AsyncStorage sur mobile).

- [ ] **Step 1:** Créer le projet, ajouter les dépendances (`@supabase/supabase-js`, `@react-native-async-storage/async-storage`, `zod`, `i18next`, `react-i18next`, `expo-localization`, `@testing-library/react-native`), configurer `jest-expo` et `"strict": true`.
- [ ] **Step 2: Test qui échoue** `locales.test.ts` : pour chaque fichier `de/en/ru`, l'ensemble des clés (aplaties) est égal à celui de `fr.json`, et aucune valeur n'est vide.
- [ ] **Step 3:** `npx jest src/i18n` → FAIL (fichiers absents).
- [ ] **Step 4:** Écrire `fr.json` avec les clés `common.*`, `auth.*`, `signup.*`, `profile.*`, `belts.*`, `sports.*`, `roles.*`, `admin.*`, `tabs.*`, `errors.*`, puis les traduire en `de/en/ru`. `initI18n` choisit `lang` ou la langue de l'appareil si elle fait partie de `Lang`, sinon `fr`.
- [ ] **Step 5:** `npx jest src/i18n` → PASS. `npx expo start --web` affiche l'app sur fond anthracite.
- [ ] **Step 6:** Commit `feat: projet Expo, thème Icon Valais, 4 langues`.

### Task 2: Règles métier pures (âge, ceintures, inscription)

**Files:**
- Create: `icon-valais/src/domain/types.ts`, `belts.ts`, `registration.ts`, `roles.ts`
- Test: `icon-valais/src/domain/__tests__/{belts,registration,roles}.test.ts`

**Interfaces:**
- Produces :
  - `type Sport = 'jjb' | 'grappling' | 'mma'`, `type Role = 'eleve' | 'prof' | 'admin'`, `type ProfStatus = 'en_attente' | 'valide' | 'refuse'`
  - `type Belt = 'blanche'|'grise'|'jaune'|'orange'|'verte'|'bleue'|'violette'|'marron'|'noire'`
  - `beltOptions(age: number): Belt[]` — ordre : blanche, grise, jaune, orange, verte (si âge < 18), bleue, violette, marron, noire
  - `needsParentConsent(age: number, createdByParent: boolean): boolean` — `age < 16 && !createdByParent`
  - `registrationSchema` (zod) et `type RegistrationInput` : `role`, `firstName`, `lastName`, `email`, `password` (min 8), `phone?`, `age` (entier 0–100), `sports: Sport[]` (min 1), `bjjBelt?` (requis si `jjb` est choisi et valide pour l'âge), `yearsGrappling?`, `yearsMma?` (entiers ≥ 0, requis si le sport est choisi), `parentEmail?` (requis si `needsParentConsent`), champs coach si `role === 'prof'` : `coachYears` (entier ≥ 0, requis), `trainingPlaces?`, `competitionAwards?`, `cv?`
  - `displayRole(role: Role): 'eleve' | 'prof'` — `admin` → `prof`
  - `canEditBelt(role: Role, profStatus: ProfStatus | null): boolean` — admin, ou prof avec statut `valide`

- [ ] **Step 1: Tests qui échouent :**
  - `beltOptions(17)` contient `grise` ; `beltOptions(18)` ne la contient pas ; `beltOptions(0)[0] === 'blanche'`.
  - `needsParentConsent(15,false) === true`, `(16,false) === false`, `(10,true) === false`.
  - `registrationSchema` refuse : âge `-1`, `101`, `12.5`, chaîne vide ; `sports: []` ; `jjb` sans ceinture ; ceinture `grise` à 18 ans ; âge 15 sans `parentEmail` ; prof sans `coachYears`.
  - Le schéma accepte un élève de 30 ans en `grappling` + `mma` avec années renseignées.
  - `displayRole('admin') === 'prof'` ; `canEditBelt('prof','en_attente') === false`, `canEditBelt('prof','valide') === true`.
- [ ] **Step 2:** `npx jest src/domain` → FAIL.
- [ ] **Step 3:** Implémenter. Les messages d'erreur zod sont des clés i18n (`errors.ageRange`, …).
- [ ] **Step 4:** `npx jest src/domain` → PASS.
- [ ] **Step 5:** Commit `feat: règles âge, ceintures, inscription, rôles`.

### Task 3: Base de données — profils, droits, RPC admin

**Files:**
- Create: `icon-valais/supabase/config.toml` (`supabase init`)
- Create: `icon-valais/supabase/migrations/0001_profiles.sql`
- Test: `icon-valais/supabase/tests/profiles.test.sql` (pgTAP)

**Interfaces:**
- Produces (schéma `public`) :
  - enums `user_role`, `prof_status`, `sport`, `belt`, `student_status ('aucun','en_attente','valide','refuse')`, `lang ('fr','de','en','ru')`
  - table `profiles` : `id uuid pk default gen_random_uuid()`, `auth_user_id uuid unique null references auth.users on delete cascade`, `parent_profile_id uuid null references profiles on delete cascade`, `role user_role not null default 'eleve'`, `prof_status prof_status null`, `first_name`, `last_name text not null`, `email text null`, `phone text null`, `age int not null check (age between 0 and 100)`, `sports sport[] not null`, `bjj_belt belt null`, `years_grappling int null`, `years_mma int null`, `coach_years int null`, `training_places text null`, `competition_awards text null`, `cv text null`, `is_student bool default false`, `student_status student_status default 'aucun'`, `paid_until date null`, `parent_email text null`, `parent_consent_at timestamptz null`, `language lang default 'fr'`, `created_at timestamptz default now()`
  - vue `public_profiles` : `id, first_name, last_name, bjj_belt, sports, display_role` (`admin` → `prof`)
  - fonctions : `current_profile_id() returns uuid`, `is_admin() returns bool`, `is_active_prof() returns bool`, `is_account_active(p profiles) returns bool`
  - RPC (security definer, vérifient l'appelant) : `set_belt(p_profile uuid, p_belt belt)` (prof actif ou admin), `admin_set_prof_status(p_profile uuid, p_status prof_status)`, `admin_set_role(p_profile uuid, p_role user_role)`, `admin_mark_paid_current_year(p_profile uuid)` (met `paid_until` au 31.12 de l'année courante), `create_child_profile(p jsonb) returns uuid`, `delete_my_account()`
  - trigger `handle_new_user` : à la création d'un `auth.users`, crée le profil à partir de `raw_user_meta_data` ; met `prof_status = 'en_attente'` si le rôle demandé est `prof` ; `admin` n'est jamais accepté à l'inscription (rabattu à `eleve`)
  - trigger `protect_profile_columns` : refuse toute modification de `role`, `prof_status`, `paid_until`, `student_status`, `parent_consent_at`, `bjj_belt` par un non-admin hors des RPC ci-dessus. Les RPC passent par le paramètre de session `app.bypass_protect = 'on'`.

- [ ] **Step 1: Tests pgTAP qui échouent :**
  - Un utilisateur `eleve` qui fait `update profiles set role='admin'` sur lui-même → exception ; idem pour `paid_until` et `bjj_belt`.
  - Inscription avec `role:'admin'` en métadonnées → profil `eleve`.
  - Inscription avec `role:'prof'` → `prof_status = 'en_attente'` et `is_account_active` faux ; après `admin_set_prof_status(...,'valide')` → vrai.
  - `set_belt` appelé par un élève → exception ; par un prof `valide` → ok.
  - `admin_mark_paid_current_year` appelé par un non-admin → exception ; par l'admin → `paid_until = make_date(extract(year from now())::int, 12, 31)`.
  - Un parent crée un enfant via `create_child_profile` : le parent le lit et le modifie ; un autre utilisateur ne le lit pas dans `profiles` mais le voit dans `public_profiles`.
  - `public_profiles.display_role` de l'admin = `'prof'`.
  - Âge 15 sans `parent_consent_at` → `is_account_active` faux.
- [ ] **Step 2:** `supabase start && supabase test db` → FAIL.
- [ ] **Step 3:** Écrire `0001_profiles.sql` (tables, enums, vue, fonctions, triggers, RLS : lecture/écriture de son profil et de ses enfants ; admin tout ; `public_profiles` lisible par tout utilisateur connecté).
- [ ] **Step 4:** `supabase db reset && supabase test db` → PASS.
- [ ] **Step 5:** Générer les types : `supabase gen types typescript --local > src/lib/database.types.ts`, puis typer le client `supabase`.
- [ ] **Step 6:** Commit `feat: schéma profils, RLS, RPC admin`.

> Si Docker n'est pas disponible dans l'environnement d'exécution, signaler le blocage et lancer les tests pgTAP sur un projet Supabase de développement (`supabase link` + `supabase test db --linked`). Ne pas sauter les tests.

### Task 4: Consentement parental et suppression de compte (Edge Functions)

**Files:**
- Create: `icon-valais/supabase/migrations/0002_parent_consent.sql`
- Create: `icon-valais/supabase/functions/send-parent-consent/index.ts`
- Create: `icon-valais/supabase/functions/confirm-parent-consent/index.ts`
- Create: `icon-valais/supabase/functions/delete-account/index.ts`
- Create: `icon-valais/supabase/functions/_shared/consent.ts`
- Test: `icon-valais/supabase/functions/_shared/consent.test.ts` (Deno), `icon-valais/supabase/tests/parent_consent.test.sql`

**Interfaces:**
- Consumes: `profiles.parent_email`, `profiles.parent_consent_at`, `is_account_active` (tâche 3).
- Produces :
  - table `parent_consents(token uuid pk default gen_random_uuid(), profile_id uuid references profiles on delete cascade, parent_email text, created_at, confirmed_at timestamptz null)` — lisible par le service uniquement
  - `confirm_parent_consent(p_token uuid) returns bool` (security definer) : met `parent_consent_at = now()` ; `false` si le jeton est inconnu, déjà utilisé ou vieux de plus de 7 jours
  - `buildConsentEmail(lang: Lang, childFirstName: string, link: string): { subject: string; html: string }` dans `_shared/consent.ts`
  - Edge `send-parent-consent` (POST, utilisateur connecté) : crée le jeton, envoie l'e-mail via Resend (`RESEND_API_KEY` en secret)
  - Edge `confirm-parent-consent` (GET `?token=`) : appelle la RPC et renvoie une page HTML simple traduite (succès ou lien invalide)
  - Edge `delete-account` (POST, utilisateur connecté) : supprime les enfants, le profil et l'utilisateur `auth` (clé service)

- [ ] **Step 1: Tests qui échouent :** `buildConsentEmail('de', 'Lea', url)` contient `Lea` et `url`, sujet non vide pour les 4 langues ; pgTAP : jeton valide → `true` puis `is_account_active` vrai ; second appel → `false` ; jeton de 8 jours → `false`.
- [ ] **Step 2:** `deno test supabase/functions/_shared` et `supabase test db` → FAIL.
- [ ] **Step 3:** Implémenter la migration, les fonctions et le gabarit d'e-mail.
- [ ] **Step 4:** Les tests passent. Vérifier `supabase functions serve` et un `curl` sur `confirm-parent-consent` avec un faux jeton → page « lien invalide ».
- [ ] **Step 5:** Commit `feat: consentement parental et suppression de compte`.

### Task 5: Connexion et inscription (écrans)

**Files:**
- Create: `icon-valais/src/auth/AuthProvider.tsx` (session + profil courant)
- Create: `icon-valais/app/(auth)/login.tsx`, `app/(auth)/signup.tsx`, `app/(auth)/forgot-password.tsx`
- Create: `icon-valais/src/components/signup/{StepRole,StepIdentity,StepSports,StepCoach,StepParent}.tsx`
- Create: `icon-valais/app/pending.tsx` (prof en attente / consentement parental en attente)
- Modify: `icon-valais/app/_layout.tsx` (redirection selon session et `is_account_active`)
- Test: `icon-valais/src/components/signup/__tests__/signup.test.tsx`

**Interfaces:**
- Consumes: `registrationSchema`, `beltOptions`, `needsParentConsent` (tâche 2) ; `supabase` (tâche 1) ; trigger `handle_new_user` (tâche 3) ; Edge `send-parent-consent` (tâche 4).
- Produces: `useAuth(): { session; profile: Profile | null; isActive: boolean; signOut(): Promise<void>; refresh(): Promise<void> }`.

Parcours : Rôle (élève/prof) → Identité (prénom, nom, e-mail, mot de passe, téléphone facultatif, âge) → Sports (cases JJB/grappling/MMA ; ceinture si JJB, avec la liste de `beltOptions(age)` ; années d'expérience pour grappling et MMA) → Coach (si prof) → E-mail du parent (si `needsParentConsent`) → `supabase.auth.signUp` avec les métadonnées → écran `pending` si le compte est inactif, sinon onglets.

- [ ] **Step 1: Tests qui échouent (RNTL, `supabase` mocké) :**
  - Âge 12 + JJB → l'option « Grise » est affichée ; âge 25 → non.
  - Âge 14 → l'étape « E-mail du parent » apparaît ; âge 16 → non.
  - Rôle prof → l'étape Coach apparaît.
  - `signUp` renvoie « User already registered » → message `errors.emailTaken` affiché et les champs gardent leurs valeurs.
- [ ] **Step 2:** `npx jest src/components/signup` → FAIL.
- [ ] **Step 3:** Implémenter les écrans (couleurs du thème, textes i18n uniquement).
- [ ] **Step 4:** Tests → PASS. Vérification manuelle sur `expo start --web` avec le Supabase local : inscription élève → onglets ; inscription prof → écran « en attente ».
- [ ] **Step 5:** Commit `feat: connexion et inscription`.

### Task 6: Onglets, profil, enfants

**Files:**
- Create: `icon-valais/app/(tabs)/_layout.tsx` — onglets : Cours (vide, plan 2), Classement (vide, plan 4), Compétition (« bientôt disponible »), Profil, Admin (visible si admin)
- Create: `icon-valais/app/(tabs)/profile/index.tsx`, `profile/edit.tsx`, `profile/children.tsx`, `profile/child/[id].tsx`
- Create: `icon-valais/src/components/LanguagePicker.tsx`
- Test: `icon-valais/app/(tabs)/__tests__/tabs.test.tsx`, `icon-valais/app/(tabs)/profile/__tests__/profile.test.tsx`

**Interfaces:**
- Consumes: `useAuth`, RPC `create_child_profile`, Edge `delete-account`.

Le profil permet de modifier : téléphone, âge, sports, années d'expérience, champs coach, langue. La ceinture est en lecture seule ; elle est modifiable à l'inscription puis seulement par un prof ou l'admin. L'écran contient aussi la déconnexion et la suppression du compte (double confirmation).

- [ ] **Step 1: Tests qui échouent :** l'onglet Admin est absent pour un élève et un prof, présent pour l'admin ; « Compétition » affiche `tabs.competitionSoon` ; changer la langue en `ru` change le titre de l'onglet Profil ; la suppression du compte demande deux confirmations avant d'appeler `delete-account` ; un parent ajoute un enfant de 8 ans → `create_child_profile` appelé avec `age: 8`.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat: onglets, profil, enfants`.

### Task 7: Administration des comptes et modification des ceintures

**Files:**
- Create: `icon-valais/app/(tabs)/admin/index.tsx` (liste des comptes, recherche, filtre rôle / « profs en attente »)
- Create: `icon-valais/app/(tabs)/admin/user/[id].tsx` (fiche : valider/refuser prof, changer rôle, « payé pour l'année », ceinture)
- Create: `icon-valais/src/components/BeltEditor.tsx` (réutilisable par les profs depuis une fiche élève dès le plan 2)
- Test: `icon-valais/app/(tabs)/admin/__tests__/admin.test.tsx`

**Interfaces:**
- Consumes: RPC `admin_set_prof_status`, `admin_set_role`, `admin_mark_paid_current_year`, `set_belt` ; `canEditBelt`.
- Produces: `<BeltEditor profileId: string; age: number; current: Belt | null; onSaved(b: Belt): void />`.

- [ ] **Step 1: Tests qui échouent :** le filtre « profs en attente » n'affiche que les `prof_status = 'en_attente'` ; « Valider » appelle `admin_set_prof_status(id,'valide')` ; « Payé pour l'année » affiche ensuite « Adhérent jusqu'au 31.12.AAAA » ; `BeltEditor` pour un profil de 12 ans propose « Grise » ; une erreur RPC affiche un message traduit.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implémenter (mise en page large sur le web : liste à gauche, fiche à droite à partir de 900 px).
- [ ] **Step 4:** → PASS. Vérification manuelle sur le web : valider un prof en attente → il se reconnecte et voit les onglets.
- [ ] **Step 5:** Commit `feat: administration des comptes`.

### Task 8: Vérification finale du plan 1

- [ ] **Step 1:** `npx tsc --noEmit` → 0 erreur ; `npx jest` → tout PASS ; `supabase test db` → tout PASS.
- [ ] **Step 2:** Ajouter `icon-valais/README.md` : prérequis, `.env`, `supabase start`, `npx expo start`, lancement des tests.
- [ ] **Step 3:** Commit `docs: README icon-valais` et push.
