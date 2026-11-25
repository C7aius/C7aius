# Icon Valais — Plan 2 : Cours (lieux, planning, réservation, appel, notifications) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les profs et l'admin créent des cours (récurrents ou non, privés pour l'admin), les profs prennent les créneaux libres, les élèves (et parents pour leurs enfants) réservent, le prof fait l'appel, et les notifications push partent pour les cours annulés, les créneaux vacants à 24 h et la validation d'un compte prof.

**Architecture:** Toute la logique de droits et de planning vit en base (migrations `0005`–`0007`, fonctions RPC `security definer`, pgTAP). La récurrence est générée en SQL en heure locale `Europe/Zurich`. Les notifications passent par une table `notification_outbox` remplie par la base ; une Edge Function `send-push` la vide vers l'API Expo Push ; `pg_cron` déclenche le traitement planifié. L'app ne fait qu'afficher et appeler les RPC.

**Tech Stack:** existant (Expo Router, TypeScript, Supabase, i18next, Jest, pgTAP, Deno) + `expo-notifications`, `expo-device`, extensions Postgres `pg_cron` et `pg_net`.

**Spec:** `docs/superpowers/specs/2026-11-25-icon-valais-design.md` (§6 Lieux, §7 Cours, §10 Notifications)

**Hors de ce plan :** paiement, prix appliqué à la réservation, limite de 10 réservations non-adhérent (plan 3) ; classement et statistiques (plan 4). Les prix sont **saisis et affichés** ici, pas encaissés.

## Global Constraints

- Fuseau horaire de référence : `Europe/Zurich` pour toute date affichée, toute récurrence et toute limite « année courante ».
- Lieux initiaux : **Conthey (défaut)**, Sion, Martigny. Chaque lieu : nom, adresse, lien Google Maps. Gérés par l'admin.
- Cours — champs : sport `jjb | grappling | mma` ; niveau `adulte | enfant` ; type `normal | competition` ; lieu (Conthey par défaut) ; début, fin ; prof (peut être vide) ; places **indicatives** 1–100, défaut 20, non bloquantes ; prix adhérent (défaut 0 CHF) ; prix non-adhérent.
- Récurrence hebdomadaire uniquement. Prof : jusqu'au 31 décembre de l'année courante. Admin : jusqu'à 5 ans après la date du premier cours.
- Modifier / annuler : cette occurrence seule, ou cette occurrence et les suivantes.
- Créneau vacant : tout prof actif peut le prendre, premier arrivé. 24 h avant le cours, s'il est encore vacant : push à tous les profs actifs (une seule fois). Si personne ne le prend : le cours est maintenu et affiché « Open Mat », sans notification.
- Cours privés : seul l'admin voit la fonction, crée, modifie et assigne le prof. Une fois créé, visible et réservable par tous.
- Annulation d'un cours : admin + prof créateur. Push à tous les inscrits (pas d'e-mail).
- Réservation et désinscription libres, sans délai ni pénalité, sans liste d'attente.
- Appel : le prof assigné (ou l'admin) coche les présents, pendant ou après le cours.
- Un prof peut modifier la ceinture des élèves (déjà en base : `set_belt`) — accessible depuis la liste d'appel.
- Notifications : push uniquement (cours annulé → inscrits ; créneau vacant 24 h avant → profs ; compte prof validé → le prof). Pour un enfant sans login, la notification va au parent.
- Seuls les comptes actifs (`current_account_active()`) lisent les cours ou agissent.
- Langues fr/de/en/ru (test de parité), couleurs anthracite `#2B2B2B` / orange `#FF6A00`, aucune donnée médicale.
- Toute règle de droit doit être appliquée en base, pas seulement dans l'interface.

## Review Focus

1. **Changement d'heure** : un cours récurrent du mardi 19:00 créé en mars reste à 19:00 heure suisse après le passage à l'heure d'été et d'hiver. Testé tâche 1.
2. **Deux profs prennent le même créneau en même temps** : un seul l'obtient, l'autre reçoit une erreur traduite « déjà pris ». Testé tâche 2.
3. **Réserver un cours annulé ou déjà commencé** → refusé avec message traduit ; réserver deux fois → pas de doublon. Testé tâche 3.
4. **Parent qui réserve pour un enfant qui n'est pas le sien** → refusé ; les réservations de ses enfants apparaissent dans sa vue. Testé tâche 3.
5. **Annuler « cette occurrence et les suivantes »** ne touche pas les cours passés et produit exactement une notification par inscrit et par cours annulé. Testé tâche 2 et 4.

---

### Task 1: Lieux, cours et création récurrente (base)

**Files:**
- Create: `icon-valais/supabase/migrations/0005_courses.sql`
- Test: `icon-valais/supabase/tests/courses.test.sql`
- Modify: `icon-valais/src/lib/database.types.ts` (régénéré)

**Interfaces:**
- Consumes: `profiles`, `current_profile_id()`, `is_admin()`, `is_active_prof()`, `current_account_active()` (plan 1).
- Produces :
  - enums `course_level ('adulte','enfant')`, `course_kind ('normal','competition')`, `course_status ('prevu','open_mat','annule')`
  - table `locations(id uuid pk, name text unique not null check (char_length(name) <= 60), address text not null default '' check (char_length(address) <= 200), maps_url text not null default '' check (maps_url = '' or maps_url ~ '^https://'), is_default bool not null default false, archived bool not null default false, created_at)` ; index unique partiel « un seul `is_default` » ; seed : Conthey (défaut), Sion, Martigny
  - table `course_series(id uuid pk, created_by uuid references profiles, created_at)`
  - table `courses(id uuid pk, series_id uuid null references course_series on delete set null, sport sport not null, level course_level not null, kind course_kind not null default 'normal', is_private bool not null default false, location_id uuid not null references locations, starts_at timestamptz not null, ends_at timestamptz not null check (ends_at > starts_at), prof_id uuid null references profiles on delete set null, places int not null default 20 check (places between 1 and 100), price_member numeric(8,2) not null default 0 check (>= 0), price_non_member numeric(8,2) not null default 0 check (>= 0), status course_status not null default 'prevu', created_by uuid not null references profiles, vacancy_notified_at timestamptz null, created_at)`
  - RLS : `locations` lisible par tout compte actif, écriture admin seulement ; `courses` lisible par tout compte actif, **aucune écriture directe** (tout passe par les RPC)
  - `admin_upsert_location(p jsonb) returns uuid` (admin ; `is_default = true` retire le défaut des autres)
  - `create_course(p jsonb, p_repeat_until date default null) returns uuid[]` — clés de `p` : `sport, level, kind, is_private, location_id (défaut = lieu par défaut), local_date (YYYY-MM-DD), start_time (HH:MI), end_time (HH:MI), prof_id, places, price_member, price_non_member`. Règles : appelant prof actif ou admin ; `is_private` seulement admin ; un prof qui crée sans `prof_id` se met lui-même ; `prof_id` d'un autre seulement si admin, et la cible doit être prof `valide` ou admin ; `p_repeat_until` null → un cours ; sinon une occurrence par semaine de `local_date` à `p_repeat_until` inclus, toutes dans une nouvelle `course_series` ; limite prof = 31.12 de l'année courante Europe/Zurich, limite admin = `local_date + interval '5 years'` ; au-delà → `22023` hint `repeat_too_far` ; lieu archivé → `22023` hint `location_archived`. Les instants sont calculés par `(local_date + start_time) at time zone 'Europe/Zurich'`.

- [ ] **Step 1: Tests pgTAP qui échouent :**
  - Un élève appelle `create_course` → `42501`.
  - Un prof en attente → `42501`.
  - Un prof valide crée un cours sans `prof_id` → `prof_id` = lui-même, `status = 'prevu'`, `places = 20`, lieu = Conthey.
  - Un prof valide avec `is_private = true` → `42501` ; l'admin → ok.
  - Un prof valide avec `prof_id` d'un autre prof → `42501`.
  - Un prof, mardi 2026-03-24 19:00–20:30, `p_repeat_until = 2026-04-14` → 4 cours, tous à `19:00` en `Europe/Zurich` (vérifier `to_char(starts_at at time zone 'Europe/Zurich','HH24:MI') = '19:00'` pour chacun, avant et après le 29 mars).
  - Un prof avec `p_repeat_until` dans l'année suivante → `22023` ; l'admin avec 4 ans → ok ; l'admin avec 5 ans + 1 jour → `22023`.
  - `places = 0` ou `101` → `23514`. `end_time <= start_time` → `23514`.
  - Un élève qui fait `insert into courses` directement → refusé (aucune politique).
  - `admin_upsert_location` avec `is_default = true` sur Sion → Conthey n'est plus défaut ; un prof qui l'appelle → `42501`.
  - Un compte inactif (prof en attente) lit 0 ligne dans `courses` et `locations`.
- [ ] **Step 2:** `npx supabase db reset && npx supabase test db` → FAIL.
- [ ] **Step 3:** Écrire `0005_courses.sql` (conventions du plan 1 : `security definer`, `search_path = ''`, revoke/grant explicites, codes d'erreur 42501 / 22023 / 23514 / P0002 avec `hint`).
- [ ] **Step 4:** Tests → PASS ; régénérer `database.types.ts` ; `npx tsc --noEmit` OK.
- [ ] **Step 5:** Commit `feat: lieux et création de cours récurrents`.

### Task 2: Gestion des cours — modifier, annuler, assigner, prendre un créneau (base)

**Files:**
- Modify: `icon-valais/supabase/migrations/0005_courses.sql`
- Create: `icon-valais/supabase/migrations/0006_notifications.sql` (seulement la table `notification_outbox`, utilisée ici)
- Test: `icon-valais/supabase/tests/course_management.test.sql`

**Interfaces:**
- Consumes: tâche 1.
- Produces :
  - table `notification_outbox(id bigserial pk, profile_id uuid not null references profiles on delete cascade, kind text not null check (kind in ('course_cancelled','slot_vacant','prof_validated')), course_id uuid null references courses on delete cascade, payload jsonb not null default '{}', created_at timestamptz default now(), sent_at timestamptz null, error text null)` — lisible/écrivable par `service_role` uniquement
  - `notify_profile(p_profile uuid, p_kind text, p_course uuid)` interne (non exposée) : si le profil n'a pas de login (`auth_user_id is null`), la ligne est écrite pour son parent
  - `update_course(p_course uuid, p jsonb, p_scope text) returns int` — `p_scope in ('one','following')` ; clés modifiables : `sport, level, kind, location_id, start_time, end_time, places, price_member, price_non_member` ; `following` = même `series_id` et `starts_at >= ` celui du cours ciblé, cours `annule` exclus ; droits : admin, ou prof actif créateur d'un cours non privé ; renvoie le nombre de cours modifiés ; un cours déjà commencé n'est pas modifiable (`22023` hint `course_started`)
  - `cancel_course(p_course uuid, p_scope text) returns int` — mêmes droits et même portée ; met `status = 'annule'` sur les cours futurs non annulés, écrit une ligne `course_cancelled` par réservation active de chaque cours annulé ; renvoie le nombre de cours annulés
  - `assign_prof(p_course uuid, p_prof uuid)` — admin seulement ; `p_prof` null = libérer ; la cible doit être prof `valide` ou admin
  - `take_slot(p_course uuid)` — prof actif ; cours non privé, `prof_id is null`, `status in ('prevu','open_mat')`, pas commencé ; atomique (`update ... where prof_id is null returning`) ; sinon `22023` hint `slot_taken` ; si `status = 'open_mat'` repasse à `prevu`
  - `leave_slot(p_course uuid)` — le prof assigné ; cours pas commencé ; met `prof_id = null` et `vacancy_notified_at = null`

- [ ] **Step 1: Tests pgTAP qui échouent :**
  - `update_course(...,'following')` sur la 2ᵉ occurrence d'une série de 4 → renvoie 3 ; la 1ʳᵉ inchangée.
  - Un prof non créateur → `42501` ; un prof créateur sur un cours privé (assigné par l'admin) → `42501`.
  - `cancel_course(...,'following')` alors que 2 élèves sont inscrits à chacun des 3 cours concernés → 3 cours `annule`, 6 lignes `course_cancelled`, aucun cours passé modifié.
  - Annuler un cours où un parent a inscrit son enfant sans login → la ligne d'outbox est pour le parent.
  - Deux `take_slot` successifs sur un créneau vacant par deux profs → le premier réussit, le second lève `22023` `slot_taken`.
  - `take_slot` sur un cours privé → `42501` ; par un élève → `42501`.
  - `assign_prof` par un prof → `42501` ; vers un élève → `22023`.
  - `leave_slot` par un prof non assigné → `42501` ; par le prof assigné → `prof_id` null.
  - `notification_outbox` illisible par `authenticated` (`42501`).
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** → PASS ; types régénérés.
- [ ] **Step 5:** Commit `feat: modifier, annuler, assigner et prendre un cours`.

### Task 3: Réservations et appel (base)

**Files:**
- Create: `icon-valais/supabase/migrations/0007_bookings.sql`
- Test: `icon-valais/supabase/tests/bookings.test.sql`

**Interfaces:**
- Consumes: tâches 1–2.
- Produces :
  - table `bookings(id uuid pk, course_id uuid references courses on delete cascade, profile_id uuid references profiles on delete cascade, booked_by uuid references profiles, created_at, cancelled_at timestamptz null)` ; index unique `(course_id, profile_id) where cancelled_at is null`
  - table `attendance(course_id uuid references courses on delete cascade, profile_id uuid references profiles on delete cascade, present bool not null, marked_by uuid references profiles, marked_at timestamptz default now(), primary key (course_id, profile_id))`
  - RLS : un utilisateur lit ses réservations et celles de ses enfants ; le prof assigné et l'admin lisent toutes celles du cours ; `attendance` lisible par le prof assigné, l'admin, et l'intéressé (ou son parent) ; aucune écriture directe
  - vue `course_booking_counts(course_id, booked)` lisible par les comptes actifs (nombre de réservations actives, sans noms)
  - `book_course(p_course uuid, p_profile uuid default null) returns uuid` — `p_profile` null = soi ; sinon un de ses enfants (`parent_profile_id = current_profile_id()`), sinon `42501` ; cours `annule` ou déjà commencé → `22023` hint `course_closed` ; déjà réservé → renvoie la réservation existante (pas de doublon)
  - `unbook_course(p_course uuid, p_profile uuid default null)` — mêmes règles de propriété ; met `cancelled_at = now()` ; cours commencé → `22023` `course_closed`
  - `course_participants(p_course uuid) returns table(profile_id uuid, first_name text, last_name text, age int, bjj_belt belt, present bool)` — prof assigné ou admin ; réservations actives, `present` null si pas encore coché
  - `set_attendance(p_course uuid, p_profile uuid, p_present bool)` — prof assigné ou admin ; à partir de `starts_at - interval '30 minutes'` (avant → `22023` hint `too_early`) ; `p_profile` doit avoir une réservation active **ou** l'admin/prof peut ajouter un présent non inscrit (crée la réservation, `booked_by` = le prof)

- [ ] **Step 1: Tests pgTAP qui échouent :**
  - Réserver deux fois le même cours → une seule réservation active.
  - Réserver un cours annulé ou commencé → `22023` `course_closed`.
  - Un parent réserve pour son enfant → ok ; pour l'enfant d'un autre → `42501`.
  - Se désinscrire puis se réinscrire → une seule réservation active.
  - `course_booking_counts` reflète les réservations actives ; un élève ne voit pas les réservations des autres dans `bookings`.
  - `course_participants` par un élève → `42501` ; par le prof assigné → liste avec ceinture et âge.
  - `set_attendance` 1 h avant → `too_early` ; pendant le cours → ok ; par un prof non assigné → `42501` ; ajout d'un présent non inscrit → réservation créée.
  - Un compte inactif ne peut pas réserver (`42501`).
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** → PASS ; types régénérés.
- [ ] **Step 5:** Commit `feat: réservations et appel`.

### Task 4: Planification automatique et envoi des notifications push

**Files:**
- Modify: `icon-valais/supabase/migrations/0006_notifications.sql`
- Create: `icon-valais/supabase/functions/send-push/index.ts`, `icon-valais/supabase/functions/_shared/push.ts`
- Test: `icon-valais/supabase/tests/notifications.test.sql`, `icon-valais/supabase/functions/_shared/push.test.ts`
- Modify: `icon-valais/README.md` (section « Notifications et tâches planifiées »)

**Interfaces:**
- Consumes: `notification_outbox`, `notify_profile` (tâche 2), `admin_set_prof_status` (plan 1).
- Produces :
  - table `push_tokens(token text pk, profile_id uuid references profiles on delete cascade, platform text check (platform in ('ios','android')), updated_at)` ; RLS : chacun voit/supprime les siens
  - `register_push_token(p_token text, p_platform text)` — compte connecté ; upsert (un jeton déplacé vers un autre compte change de propriétaire) ; `p_token` doit commencer par `ExponentPushToken[`
  - `process_course_schedule() returns void` (service_role / cron uniquement) :
    1. cours `prevu`, `prof_id is null`, `vacancy_notified_at is null`, `starts_at` entre `now()` et `now() + 24 h` → une ligne `slot_vacant` par prof actif (profs `valide` + admin), puis `vacancy_notified_at = now()`
    2. cours `prevu`, `prof_id is null`, `starts_at <= now()` → `status = 'open_mat'`, sans notification
  - `admin_set_prof_status` modifié : passage à `valide` → ligne `prof_validated` pour ce prof
  - tâches `pg_cron` : `process-course-schedule` toutes les 5 minutes ; `send-push` chaque minute via `net.http_post` vers l'URL de la fonction, URL et clé lues dans `vault.decrypted_secrets` (`functions_url`, `service_role_key`) — si absents, la tâche ne fait rien (pas d'erreur)
  - `_shared/push.ts` : `buildPushMessages(rows: OutboxRow[], tokens: Map<string, string[]>, langs: Map<string, Lang>): ExpoMessage[]` (titre et texte traduits fr/de/en/ru selon `profiles.language`, `data: { courseId }`) ; `chunk<T>(items: T[], size: 100): T[][]`
  - Edge `send-push` (POST, service role uniquement) : lit jusqu'à 500 lignes non envoyées, envoie par paquets de 100 à `https://exp.host/--/api/v2/push/send`, met `sent_at` (ou `error`) ; supprime les jetons signalés `DeviceNotRegistered`

- [ ] **Step 1: Tests qui échouent :**
  - pgTAP : un cours vacant dans 23 h → `process_course_schedule()` écrit une ligne `slot_vacant` par prof actif (pas pour un prof en attente) ; un second appel n'en écrit pas d'autre.
  - pgTAP : un cours vacant dans 25 h → rien.
  - pgTAP : un cours vacant commencé il y a 1 min → `open_mat`, aucune ligne outbox.
  - pgTAP : un cours avec prof commencé → reste `prevu`.
  - pgTAP : `admin_set_prof_status(...,'valide')` → une ligne `prof_validated`.
  - pgTAP : `register_push_token` avec un jeton invalide → `22023` ; deux comptes enregistrent le même jeton → il appartient au dernier.
  - Deno : `buildPushMessages` produit un message par jeton, texte allemand pour un profil `de`, et `data.courseId` ; un profil sans jeton → aucun message ; `chunk` de 250 → 100/100/50.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implémenter ; documenter dans le README les deux secrets Vault à créer (`select vault.create_secret(...)`).
- [ ] **Step 4:** → PASS (`npx supabase test db`, `deno test --config supabase/functions/deno.json`).
- [ ] **Step 5:** Commit `feat: créneaux vacants, Open Mat et envoi des notifications push`.

### Task 5: Onglet Cours — planning et réservation (app)

**Files:**
- Create: `icon-valais/src/domain/courses.ts`, `icon-valais/src/domain/__tests__/courses.test.ts`
- Create: `icon-valais/src/lib/coursesApi.ts` (requêtes et appels RPC typés)
- Modify: `icon-valais/app/(tabs)/index.tsx` (planning)
- Create: `icon-valais/src/components/courses/{CourseCard,LocationDetails,WeekNav,BookButton}.tsx`
- Modify: `icon-valais/src/domain/adminErrors.ts` (hints `slot_taken`, `course_closed`, `too_early`, `repeat_too_far`, `course_started`)
- Test: `icon-valais/app/(tabs)/__tests__/courses.test.tsx`

**Interfaces:**
- Consumes: tables/vues/RPC des tâches 1–3.
- Produces :
  - `type CourseRow` (ligne `courses` + `location` + `prof: {first_name,last_name} | null` + `booked: number` + `myBookings: string[]` (ids des profils — soi et enfants — inscrits))
  - `courseLabelStatus(c: Pick<CourseRow,'status'|'prof_id'|'starts_at'>, now: Date): 'annule' | 'open_mat' | 'vacant' | 'prevu'` — `prof_id` null et pas commencé → `vacant` ; `prof_id` null et commencé → `open_mat`
  - `weekRange(anchor: Date): { from: Date; to: Date }` (lundi 00:00 → lundi suivant, Europe/Zurich)
  - `formatCourseTime(startsAt: string, endsAt: string, lang: Lang): string` (ex. `mar. 24.03 · 19:00–20:30`, heure suisse)
  - `formatChf(amount: number): string` (`0 CHF` → libellé `courses.free`, sinon `25.00 CHF`)
  - `fetchWeek(from: Date, to: Date): Promise<CourseRow[]>`, `bookCourse(courseId, profileId?)`, `unbookCourse(courseId, profileId?)`

Écran : navigation semaine précédente/suivante, filtres lieu et sport, cartes par jour. Carte : heure, sport, niveau, type (badge « Compétition »), lieu (déroulable : adresse + lien Google Maps cliquable), prof ou statut (« Créneau libre », « Open Mat », « Annulé » barré), `inscrits / places` indicatif, prix adhérent et non-adhérent, bouton Réserver / Se désinscrire. Un parent voit un choix « moi / enfant X » pour réserver. Tap sur la carte → détail (tâche 6).

- [ ] **Step 1: Tests qui échouent :**
  - `courseLabelStatus` : vacant futur → `vacant` ; vacant commencé → `open_mat` ; annulé → `annule`.
  - `weekRange(new Date('2026-03-29T12:00:00Z'))` → du lundi 23.03 00:00 au lundi 30.03 00:00 heure suisse (vérifier les deux instants UTC, avec le changement d'heure).
  - `formatChf(0)` → clé `courses.free` ; `formatChf(25)` → `25.00 CHF`.
  - RNTL (API mockée) : la carte d'un cours annulé n'a pas de bouton Réserver ; Réserver appelle `book_course` ; un parent avec un enfant voit le choix et réserve pour l'enfant ; l'erreur `course_closed` affiche le message traduit ; « Lieu » déroulé montre l'adresse et un lien `https://` ; un cours vacant affiche « Créneau libre ».
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implémenter (textes i18n dans les 4 langues).
- [ ] **Step 4:** `npx jest` + `npx tsc --noEmit` → PASS.
- [ ] **Step 5:** Commit `feat: planning des cours et réservation`.

### Task 6: Détail d'un cours — actions prof/admin et appel (app)

**Files:**
- Create: `icon-valais/app/(tabs)/courses/_layout.tsx` (Stack, onglet masqué), `app/(tabs)/courses/[id].tsx`
- Create: `icon-valais/src/components/courses/{ParticipantsList,AssignProfPicker}.tsx`
- Modify: `icon-valais/app/(tabs)/_layout.tsx` (`courses` avec `href: null`)
- Test: `icon-valais/app/(tabs)/courses/__tests__/detail.test.tsx`

**Interfaces:**
- Consumes: `take_slot`, `leave_slot`, `assign_prof`, `cancel_course`, `course_participants`, `set_attendance`, `<BeltEditor />` (plan 1), `coursesApi`.
- Produces: `fetchCourse(id: string): Promise<CourseRow | null>` ajouté à `coursesApi.ts`.

Écran : toutes les infos de la carte + actions selon le rôle :
- prof actif sur cours vacant non privé : « Prendre ce cours » ;
- prof assigné, cours pas commencé : « Me retirer » ;
- admin : « Assigner un prof » (liste des profs valides + admin, et « aucun ») ;
- admin ou prof créateur : « Annuler » avec choix « ce cours » / « ce cours et les suivants » (si série), confirmation ;
- prof assigné ou admin : liste des participants avec case Présent, nom, âge, ceinture, bouton « Ceinture » ouvrant `BeltEditor` (prof ≠ lui-même), et « Ajouter un présent » (recherche dans `public_profiles`).

- [ ] **Step 1: Tests qui échouent (RNTL, API mockée) :**
  - Un élève ne voit aucune action prof/admin.
  - Un prof sur un créneau vacant voit « Prendre ce cours » ; l'erreur `slot_taken` affiche « déjà pris » et recharge.
  - L'admin voit « Assigner un prof » et « Annuler » ; annuler une occurrence de série propose les deux portées et appelle `cancel_course` avec `following` quand choisi.
  - Le prof assigné coche un participant → `set_attendance(course, profile, true)` ; `too_early` → message traduit.
  - Le bouton « Ceinture » est absent sur la ligne du prof lui-même.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat: détail d'un cours, prise de créneau et appel`.

### Task 7: Créer / modifier un cours et gérer les lieux (app)

**Files:**
- Create: `icon-valais/app/(tabs)/courses/new.tsx`, `app/(tabs)/courses/[id]/edit.tsx`
- Create: `icon-valais/src/components/courses/CourseForm.tsx`, `icon-valais/src/domain/courseForm.ts`
- Create: `icon-valais/app/(tabs)/admin/locations.tsx`
- Modify: `icon-valais/app/(tabs)/index.tsx` (bouton « + » pour prof actif / admin), `app/(tabs)/admin/index.tsx` (lien « Lieux »), `app/(tabs)/courses/[id].tsx` (bouton « Modifier »)
- Test: `icon-valais/src/domain/__tests__/courseForm.test.ts`, `icon-valais/app/(tabs)/courses/__tests__/form.test.tsx`, `icon-valais/app/(tabs)/admin/__tests__/locations.test.tsx`

**Interfaces:**
- Consumes: `create_course`, `update_course`, `admin_upsert_location`, `locations`.
- Produces :
  - `courseFormSchema` (zod) : `sport`, `level`, `kind`, `isPrivate`, `locationId`, `localDate` (`YYYY-MM-DD`), `startTime`/`endTime` (`HH:MM`, fin > début), `profId?`, `places` (1–100, défaut 20), `priceMember` (≥ 0, défaut 0), `priceNonMember` (≥ 0), `recurring: boolean`, `repeatUntil?`
  - `maxRepeatUntil(role: Role, localDate: string, today: string): string` — prof : `AAAA-12-31` de l'année de `today` ; admin : `localDate` + 5 ans
  - `toCreateCoursePayload(v): { p: object; p_repeat_until: string | null }` (clés snake_case de la tâche 1)

Formulaire : interrupteur « Cours récurrent » ; si activé, date de fin (prof : fixée au 31.12, affichée ; admin : choix jusqu'à `maxRepeatUntil`). Interrupteur « Cours privé » et choix du prof visibles **seulement pour l'admin**. Modification d'une occurrence de série : choix « ce cours » / « ce cours et les suivants ». Écran Lieux (admin) : liste, ajout, modification (nom, adresse, lien Maps `https://`), « par défaut », archiver.

- [ ] **Step 1: Tests qui échouent :**
  - `maxRepeatUntil('prof','2026-03-24','2026-03-01') === '2026-12-31'` ; `maxRepeatUntil('admin','2026-03-24','2026-03-01') === '2031-03-24'`.
  - Schéma : `places` 0 → erreur ; fin avant début → erreur ; récurrent sans date de fin → erreur ; date de fin au-delà du maximum → erreur.
  - `toCreateCoursePayload` non récurrent → `p_repeat_until: null`.
  - RNTL : un prof ne voit ni « Cours privé » ni le choix du prof ; l'admin les voit ; soumettre appelle `create_course` avec le bon payload ; l'erreur `repeat_too_far` est traduite.
  - Lieux : un prof qui ouvre l'écran voit « accès refusé » ; l'admin ajoute un lieu avec un lien `http://` → erreur de validation.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat: création et modification de cours, gestion des lieux`.

### Task 8: Enregistrement des notifications push (app)

**Files:**
- Create: `icon-valais/src/lib/push.ts`, `icon-valais/src/lib/__tests__/push.test.ts`
- Modify: `icon-valais/src/auth/AuthProvider.tsx` (enregistrement après connexion d'un compte actif), `icon-valais/app/_layout.tsx` (tap sur notification → `/courses/<courseId>`), `icon-valais/app.json` (plugin `expo-notifications`)

**Interfaces:**
- Consumes: `register_push_token` (tâche 4).
- Produces: `registerForPush(): Promise<'registered' | 'denied' | 'unsupported'>` — `unsupported` sur web, simulateur, ou sans `projectId` EAS (configuré au plan 5) ; `routeForNotification(data: unknown): string | null`.

- [ ] **Step 1: Tests qui échouent (modules Expo mockés) :** web → `unsupported` sans appel RPC ; permission refusée → `denied` ; accordée → `register_push_token(token,'ios'|'android')` ; `routeForNotification({courseId:'x'}) === '/courses/x'`, données invalides → `null`.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implémenter (`expo-notifications`, `expo-device` installés avec les versions de `bundledNativeModules.json`).
- [ ] **Step 4:** → PASS ; `npx expo export --platform web` OK.
- [ ] **Step 5:** Commit `feat: enregistrement des notifications push`.

### Task 9: Vérification finale du plan 2

- [ ] **Step 1:** `npx tsc --noEmit`, `npx jest`, `npx supabase test db`, tests Deno → tout PASS.
- [ ] **Step 2:** Étendre `e2e/smoke.e2e.mjs` : l'admin crée un cours récurrent → visible dans le planning ; un élève le réserve puis se désinscrit ; un prof prend un créneau vacant ; le prof fait l'appel (cours placé dans le passé proche via SQL) ; l'admin annule « ce cours et les suivants » → statut « Annulé » et lignes `course_cancelled` présentes dans l'outbox (SQL) ; `process_course_schedule()` appelé via SQL → un cours vacant commencé passe en « Open Mat ».
- [ ] **Step 3:** README : nouvelles commandes, secrets Vault, limites (push réel testable seulement sur téléphone après le plan 5).
- [ ] **Step 4:** Commit `docs: plan 2 vérifié`.
