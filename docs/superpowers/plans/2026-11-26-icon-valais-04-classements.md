# Icon Valais — Plan 4 : Classements et tableau de bord admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un classement de régularité visible par tous (top 10 / top 20 / tous, toutes périodes ou cette année) et un tableau de bord admin : membres filtrables par statut et par régularité, heures d'enseignement par prof et totales, heures de présence par membre.

**Architecture:** Tous les calculs en SQL (migration `0016_stats.sql`, fonctions `security definer` en lecture seule, pgTAP), à partir des présences cochées (`attendance.present`) sur des cours non annulés et déjà commencés. L'app n'affiche que ce que ces fonctions renvoient.

**Tech Stack:** existant.

**Spec:** `docs/superpowers/specs/2026-11-25-icon-valais-design.md` (§9)

**Notes héritées :** une présence peut exister sur un cours annulé avant le plan 2 (fix 0008 les supprime désormais) — toujours filtrer `courses.status <> 'annule'`. Les présences ajoutées à l'appel (walk-ins) comptent comme les autres.

## Global Constraints

- Source unique : `attendance.present = true` sur des cours `status <> 'annule'` et `starts_at <= now()`.
- Heures = durée du cours (`ends_at - starts_at`), affichées en heures avec une décimale.
- Périodes : « Toujours » et « Cette année » (année civile, `Europe/Zurich`) pour le classement ; pour l'admin, en plus « Ce mois » et dates libres. Toutes les bornes en heure de Zurich.
- Classement visible par tous les comptes actifs (élèves et profs) ; affiche prénom, nom, ceinture, nombre de présences ; ex aequo = même rang (rang dense).
- Segments de régularité (admin) : **essai** = 1 présence au total ; **occasionnel** = 2 présences ou plus, mais moins de 12 sur les 90 derniers jours ; **régulier** = 12 présences ou plus sur les 90 derniers jours (≈ 1 par semaine) ; **jamais venu** = 0.
- Filtres statut (admin) : adhérent / non-adhérent (à aujourd'hui, même règle que `admin_member_overview`).
- Heures d'enseignement : cours avec `prof_id` renseigné, non annulés, déjà commencés ; un « Open Mat » sans prof ne compte pour personne.
- Langues fr/de/en/ru (parité), couleurs du thème.

## Review Focus

1. **Cours annulé avec des présences** → ne compte ni dans le classement ni dans les heures. Testé tâche 1.
2. **Ex aequo** → même rang, le suivant prend le rang suivant (1, 1, 2). Testé tâche 1.
3. **Présence le 31 décembre à 23 h 30 heure suisse** → compte dans l'année en cours, pas la suivante. Testé tâche 1.
4. **Compte inactif** (prof en attente, mineur sans accord) → n'apparaît pas dans le classement et ne peut pas l'ouvrir. Testé tâche 1.
5. **Un prof qui assiste à un cours comme élève** → ses présences comptent dans le classement ; ses heures d'enseignement ne comptent que pour les cours où il est le prof. Testé tâche 1.

---

### Task 1: Statistiques (base)

**Files:**
- Create: `icon-valais/supabase/migrations/0016_stats.sql`
- Test: `icon-valais/supabase/tests/stats.test.sql`

**Interfaces:**
- Produces :
  - index `attendance(profile_id) where present`, `courses(prof_id, starts_at)`
  - `attendance_ranking(p_period text default 'all', p_limit int default null) returns table(rank int, profile_id uuid, first_name text, last_name text, bjj_belt belt, sessions int)` — `p_period in ('all','year')` sinon `22023 invalid_field` ; comptes actifs uniquement (appelant et lignes : `is_account_active`) ; tri `sessions desc, last_name, first_name` ; `dense_rank`
  - `my_ranking(p_period text default 'all') returns table(rank int, sessions int)` — rang de l'appelant (null s'il n'a aucune présence)
  - `admin_teaching_hours(p_from date, p_to date) returns table(prof_id uuid, first_name text, last_name text, courses int, hours numeric)` — admin actif ; bornes incluses, dates Zurich ; tri `hours desc`
  - `admin_member_hours(p_from date, p_to date) returns table(profile_id uuid, first_name text, last_name text, sessions int, hours numeric)` — admin ; tri `hours desc, last_name`
  - `admin_member_segments() returns table(profile_id uuid, visits_total int, visits_90d int, segment text, last_visit date)` — admin ; `segment in ('jamais','essai','occasionnel','regulier')`
  - grants : `authenticated` pour `attendance_ranking`/`my_ranking` ; les `admin_*` vérifient `is_admin()` + compte actif (42501) ; `anon` jamais

- [ ] **Step 1: Tests pgTAP qui échouent :**
  - 3 élèves avec 5, 5, 2 présences → rangs 1, 1, 2 ; `p_limit = 1` → les 2 ex aequo ; une présence sur un cours annulé ne compte pas ; une présence sur un cours futur (cochée 30 min avant) ne compte pas encore.
  - Présence le 2026-12-31 22:30 UTC (= 23:30 Zurich) compte dans « year » 2026 (test avec dates calculées relatives à l'année courante).
  - Un prof en attente ou un mineur sans accord n'apparaît pas et reçoit 42501 en appelant la fonction.
  - Un prof qui assiste à un cours comme élève apparaît dans le classement ; `admin_teaching_hours` ne compte que ses cours en tant que prof ; un Open Mat sans prof ne compte pour personne ; un cours de 1 h 30 → 1.5.
  - `admin_member_segments` : 0 → jamais ; 1 → essai ; 5 au total dont 3 récents → occasionnel ; 12 sur 90 jours → regulier.
  - Un élève qui appelle `admin_*` → 42501 ; `p_period = 'x'` → `22023`.
- [ ] **Step 2:** `npx supabase db reset && npx supabase test db` → FAIL.
- [ ] **Step 3:** Implémenter `0016_stats.sql`.
- [ ] **Step 4:** → PASS ; types régénérés.
- [ ] **Step 5:** Commit `feat: statistiques de présence et d'enseignement`.

### Task 2: Onglet Classement (app)

**Files:**
- Modify: `icon-valais/app/(tabs)/ranking/index.tsx`
- Create: `icon-valais/src/lib/statsApi.ts`
- Test: `icon-valais/app/(tabs)/ranking/__tests__/ranking.test.tsx`

**Interfaces:**
- Consumes: `attendance_ranking`, `my_ranking`.
- Produces: `fetchRanking(period: 'all'|'year', limit: 10|20|null)`, `fetchMyRanking(period)`.

Écran : choix « Top 10 / Top 20 / Tous », choix « Toujours / Cette année », liste (rang, nom, ceinture, présences) avec médailles 🥇🥈🥉 pour les rangs 1–3, sa propre ligne surlignée en orange, et en haut « Ta position : n° X (Y présences) » (ou « Pas encore de présence »). Rechargement au focus.

- [ ] **Step 1: Tests qui échouent :** « Top 10 » appelle `attendance_ranking('all', 10)` ; « Cette année » relance avec `'year'` ; ex aequo affichés avec le même rang ; la ligne de l'utilisateur est surlignée ; liste vide → message traduit ; erreur → message traduit.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implémenter (textes i18n dans les 4 langues).
- [ ] **Step 4:** `npx jest`, `npx tsc --noEmit` → PASS.
- [ ] **Step 5:** Commit `feat: classement de régularité`.

### Task 3: Tableau de bord admin (app)

**Files:**
- Create: `icon-valais/app/(tabs)/admin/dashboard.tsx`
- Create: `icon-valais/src/domain/periods.ts` (bornes Zurich : ce mois, cette année, dates libres)
- Modify: `icon-valais/app/(tabs)/admin/index.tsx` (lien « Tableau de bord » ; filtres segment + adhérent/non-adhérent ; colonnes nombre de venues, dernière venue, fin d'abonnement)
- Modify: `icon-valais/src/lib/statsApi.ts`
- Test: `icon-valais/src/domain/__tests__/periods.test.ts`, `icon-valais/app/(tabs)/admin/__tests__/dashboard.test.tsx`, compléter `admin.test.tsx`

**Interfaces:**
- Consumes: `admin_teaching_hours`, `admin_member_hours`, `admin_member_segments`, `admin_member_overview` (plan 3).
- Produces: `periodRange(kind: 'month'|'year'|'custom', today: string, from?: string, to?: string): { from: string; to: string }` (dates `YYYY-MM-DD` Zurich).

Tableau de bord : sélecteur de période ; carte « Heures d'enseignement » (par prof + total) ; carte « Heures de présence » (membres triés par heures décroissantes, 50 premiers + « voir tout ») ; compteurs en haut : profs en attente, justificatifs en attente (liens vers les écrans existants). Liste des membres : puces de filtre « Adhérents / Non-adhérents » et « Jamais venu / Essai / Occasionnel / Régulier », combinables ; chaque ligne affiche nombre de venues, dernière venue, « Adhérent jusqu'au … ».

- [ ] **Step 1: Tests qui échouent :** `periodRange('month','2026-03-15')` → `2026-03-01`…`2026-03-31` ; `periodRange('year','2026-03-15')` → `2026-01-01`…`2026-12-31` ; custom avec fin avant début → erreur ; le tableau affiche le total des heures (somme des profs, une décimale) ; changer de période relance les deux RPC avec les nouvelles bornes ; filtre « Régulier » + « Adhérents » ne garde que les lignes correspondantes ; non-admin → « accès refusé ».
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** → PASS ; `npx expo export --platform web` OK.
- [ ] **Step 5:** Commit `feat: tableau de bord admin`.

### Task 4: Vérification finale du plan 4

- [ ] **Step 1:** `npx tsc --noEmit`, `npx jest`, `npx supabase db reset && npx supabase test db`, tests Deno → tout PASS.
- [ ] **Step 2:** Étendre `e2e/smoke.e2e.mjs` : présences cochées pour 3 élèves (SQL sur des cours passés) → l'onglet Classement montre l'ordre attendu et la position de l'utilisateur ; l'admin ouvre le tableau de bord → heures du prof et total corrects ; filtre « Essai » ne montre que l'élève venu une fois. Les 18 flux existants restent verts.
- [ ] **Step 3:** README : section « Classements et statistiques » (règles de calcul, segments).
- [ ] **Step 4:** Commit `docs: plan 4 vérifié`.
