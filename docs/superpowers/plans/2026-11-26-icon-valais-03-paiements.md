# Icon Valais — Plan 3 : Paiements (adhésions, cours payants, Stripe, quittances) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les non-adhérents ont 10 cours gratuits puis paient chaque cours ; chacun peut s'abonner (carte avec renouvellement automatique, ou TWINT en une fois) aux tarifs étudiant et enfant ; les cours annulés sont remboursés automatiquement ; chacun télécharge ses quittances ; l'admin gère les tarifs, les justificatifs étudiants et voit les adhérents et les paiements.

**Architecture:** La base décide de tout ce qui touche à l'argent : statut d'adhérent, prix d'une réservation, compteur d'essais, état des paiements (migrations `0009`–`0011`, pgTAP). Les Edge Functions sont minces : elles parlent à Stripe par son API REST (`fetch`, pas de SDK) et appliquent les événements Stripe en appelant des fonctions SQL `service_role` idempotentes. Le webhook Stripe est vérifié par signature HMAC. Sur téléphone : PaymentSheet (`@stripe/stripe-react-native`) ; sur le web : page Stripe Checkout.

**Tech Stack:** existant + `@stripe/stripe-react-native`, `expo-image-picker`, `expo-document-picker`, Supabase Storage, `npm:pdf-lib` (Edge Function quittance).

**Spec:** `docs/superpowers/specs/2026-11-25-icon-valais-design.md` (§7 Réservation, §8 Abonnements et paiements, §10 Notifications)

**Notes héritées du plan 2 :** une réservation reste active quand son cours est annulé — tout calcul (compteur d'essais, remboursements) joint `courses.status`. Les Edge Functions ne démarrent pas dans le bac à sable local (proxy) : la logique vit en SQL (testée par pgTAP) et en modules `_shared` purs (testés par Deno).

## Global Constraints

- Devise : CHF. Montants en base : `numeric(8,2)`. Montants envoyés à Stripe : centimes entiers.
- Tarifs par défaut (modifiables par l'admin) : 1 mois 100, 3 mois 250, 6 mois 450, 12 mois 650 CHF ; étudiant −30 % (statut validé par l'admin) ; enfant −50 % si âge **< 16 ans** ; réductions non cumulables (la plus avantageuse) ; prix par défaut d'un nouveau cours pour non-adhérent : **20 CHF**.
- Est adhérent à une date : abonnement Stripe actif, OU abonnement payé en une fois non échu, OU `profiles.paid_until >= date` (« payé pour l'année » de l'admin).
- Réservation : adhérent → prix adhérent ; non-adhérent → gratuite tant qu'il a moins de **10** réservations d'essai actives (désinscriptions et cours annulés non comptés), sinon prix non-adhérent du cours, sans limite. Si montant > 0 : place retenue **15 minutes** en attente du paiement.
- Mention avant tout paiement de cours : « Remboursé uniquement si le cours est annulé par le professeur. » Désinscription d'un cours payé : pas de remboursement. Annulation d'un cours (prof ou admin) : remboursement automatique.
- Abonnement carte / Apple Pay / Google Pay : renouvellement automatique, résiliable (fin à l'échéance). TWINT : paiement unique sans renouvellement, push de rappel 7 jours avant la fin.
- Un parent paie l'abonnement et les cours de son enfant depuis son compte.
- Justificatif étudiant : PDF ou photo (appareil photo de l'app) ; l'admin valide ou refuse ; le fichier est **conservé** (stockage privé, lisible par l'élève et l'admin seulement, supprimé avec le compte).
- Quittances PDF : en-tête « Icon Valais Conthey », sans TVA, numéro séquentiel, page « Mes paiements ».
- Secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`) uniquement en variables d'environnement / secrets Supabase ; jamais dans le code, les logs, le README ou une réponse HTTP.
- Langues fr/de/en/ru (parité), fuseau `Europe/Zurich`, toute règle d'argent appliquée en base.

## Review Focus

1. **Double événement Stripe** (Stripe renvoie le même webhook) → aucun double effet : une seule confirmation, une seule prolongation, un seul remboursement. Testé tâches 2 et 3.
2. **Paiement qui arrive après les 15 minutes** (réservation déjà libérée) → le paiement est enregistré, la réservation est réactivée si le cours n'a pas commencé et n'est pas annulé, sinon remboursement automatique. Testé tâche 2.
3. **Compteur d'essais** : 10ᵉ réservation gratuite, 11ᵉ payante ; se désinscrire d'un essai le rend ; un cours d'essai annulé par le club le rend aussi ; un adhérent ne consomme pas d'essais. Testé tâche 2.
4. **Prix calculé côté serveur uniquement** : l'app ne peut jamais imposer un montant ni payer l'abonnement d'un profil qui n'est ni elle-même ni son enfant. Testé tâches 1 et 3.
5. **Enfant de 15 ans étudiant** → −50 % (pas −30 %, pas −80 %) ; à 16 ans → −30 % si étudiant validé, sinon plein tarif. Testé tâche 1.

---

### Task 1: Tarifs et adhésions (base)

**Files:**
- Create: `icon-valais/supabase/migrations/0009_memberships.sql`
- Test: `icon-valais/supabase/tests/memberships.test.sql`

**Interfaces:**
- Consumes: `profiles` (`age`, `paid_until`, `student_status`, `parent_profile_id`, `auth_user_id`), `create_course` (0008), helpers du plan 1.
- Produces :
  - table singleton `pricing_settings(id bool pk default true check (id), price_1m, price_3m, price_6m, price_12m numeric(8,2) not null check (> 0), student_discount_pct int not null default 30 check (0..90), child_discount_pct int not null default 50 check (0..90), child_max_age int not null default 15, default_course_price numeric(8,2) not null default 20 check (>= 0), updated_at)` ; ligne initiale 100/250/450/650, 30, 50, 15, 20 ; lisible par les comptes actifs ; écriture via `admin_update_pricing(p jsonb)` seulement
  - enums `membership_source ('stripe_subscription','one_time','admin_year')`, `membership_status ('pending','active','cancelled','ended')`
  - table `memberships(id uuid pk, profile_id uuid not null references profiles on delete cascade, paid_by uuid null references profiles on delete set null, source membership_source not null, months int not null check (months in (1,3,6,12)), starts_on date null, ends_on date null, status membership_status not null default 'pending', auto_renew bool not null default false, cancel_at_period_end bool not null default false, stripe_subscription_id text unique null, amount numeric(8,2) not null, created_at)` ; RLS lecture : soi, son parent, admin ; aucune écriture client
  - colonne `profiles.stripe_customer_id text unique null` (protégée comme les autres colonnes sensibles)
  - `is_member(p_profile uuid, p_on date default (now() at time zone 'Europe/Zurich')::date) returns bool` — `paid_until >= p_on` OU une ligne `memberships` `status in ('active','cancelled')` avec `starts_on <= p_on <= ends_on`
  - `membership_price(p_profile uuid, p_months int) returns table(base numeric, discount_pct int, reason text, amount numeric)` — `reason in ('none','student','child')` ; enfant si `age <= child_max_age` ; étudiant si `student_status = 'valide'` ; la plus grande réduction ; arrondi au centime
  - `can_pay_for(p_profile uuid) returns bool` — soi ou son enfant (`parent_profile_id = current_profile_id()`), compte appelant actif
  - `my_membership(p_profile uuid default null) returns table(is_member bool, until date, source membership_source, auto_renew bool, cancel_at_period_end bool)` — soi ou son enfant
  - `admin_update_pricing(p jsonb)` (admin ; clés = colonnes de `pricing_settings` ; `invalid_field` sinon)
  - `create_course` redéfini : `price_non_member` absent → `pricing_settings.default_course_price`

- [ ] **Step 1: Tests pgTAP qui échouent :**
  - `membership_price` : adulte non étudiant 3 mois → 250 / 0 / `none` ; étudiant validé 12 mois → 455 / 30 / `student` ; âge 15 étudiant → 50 % / `child` (pas 80 %) ; âge 16 étudiant validé → 30 % ; âge 16 non étudiant → 0 % ; après `admin_update_pricing({"price_1m":120})` → 1 mois = 120.
  - `is_member` : `paid_until` = aujourd'hui → vrai ; hier → faux ; abonnement `active` couvrant aujourd'hui → vrai ; `cancelled` mais `ends_on` futur → vrai ; `ended` → faux ; `pending` → faux.
  - `can_pay_for` : soi → vrai ; son enfant → vrai ; l'enfant d'un autre → faux ; un autre adulte → faux.
  - `admin_update_pricing` par un prof → `42501` ; `student_discount_pct = 95` → `22023` ou `23514` traduit ; clé inconnue → `invalid_field`.
  - `create_course` sans `price_non_member` → 20 ; avec 35 → 35.
  - Un élève ne peut ni insérer ni modifier `memberships`, ni changer `stripe_customer_id` (42501).
- [ ] **Step 2:** `npx supabase db reset && npx supabase test db` → FAIL.
- [ ] **Step 3:** Implémenter `0009_memberships.sql`.
- [ ] **Step 4:** → PASS ; types régénérés.
- [ ] **Step 5:** Commit `feat: tarifs et adhésions`.

### Task 2: Prix des réservations, essais, paiements et remboursements (base)

**Files:**
- Create: `icon-valais/supabase/migrations/0010_payments.sql`
- Test: `icon-valais/supabase/tests/payments.test.sql`

**Interfaces:**
- Consumes: tâche 1, `bookings`, `book_course`, `unbook_course`, `cancel_course`, `course_booking_counts`, `course_participants`, `notification_outbox`, `process_course_schedule` (plans 2).
- Produces :
  - colonnes `bookings` : `price numeric(8,2) not null default 0`, `free_trial bool not null default false`, `payment_status text not null default 'none' check (in ('none','pending','paid','refund_pending','refunded'))`, `pending_until timestamptz null`
  - définition unique d'une réservation **active** : `cancelled_at is null and (payment_status <> 'pending' or pending_until > now())` — appliquée partout où « active » est utilisé (index unique, compteurs, participants, notifications, appel)
  - enums `payment_kind ('course','membership')`, `payment_state ('pending','succeeded','failed','refund_pending','refunded')`
  - table `payments(id uuid pk, receipt_no bigint generated always as identity unique, kind payment_kind not null, payer_profile_id uuid null references profiles on delete set null, beneficiary_profile_id uuid null references profiles on delete set null, booking_id uuid null references bookings on delete set null, membership_id uuid null references memberships on delete set null, amount numeric(8,2) not null check (amount > 0), currency text not null default 'chf', method text null, stripe_payment_intent_id text unique null, stripe_invoice_id text unique null, status payment_state not null default 'pending', description text not null, created_at, paid_at, refunded_at)` ; RLS lecture : payeur, bénéficiaire, parent du bénéficiaire, admin ; aucune écriture client
  - `trial_used(p_profile uuid) returns int` — réservations `free_trial` actives dont le cours n'est pas `annule`
  - `my_trial_status(p_profile uuid default null) returns table(used int, trial_limit int)` — soi ou son enfant ; `trial_limit = 10`
  - `book_course` redéfini → `returns table(booking_id uuid, amount numeric, needs_payment bool)` : adhérent → `price_member` ; sinon `trial_used < 10` → 0 et `free_trial = true` ; sinon `price_non_member` ; montant > 0 → `payment_status = 'pending'`, `pending_until = now() + interval '15 minutes'` ; réserver de nouveau un cours en attente renvoie la même réservation et prolonge `pending_until`
  - `unbook_course` redéfini : réservation payée → reste `paid`, pas de remboursement ; en attente → libérée
  - `cancel_course` redéfini : chaque réservation `paid` des cours annulés passe `refund_pending` et son paiement `refund_pending`
  - fonctions `service_role` uniquement (appelées par les Edge Functions, idempotentes) :
    - `start_course_payment(p_booking uuid, p_payer uuid) returns table(payment_id uuid, amount numeric, description text)` — vérifie que `p_payer` peut payer pour le bénéficiaire et que la réservation est `pending` ; réutilise le paiement `pending` existant
    - `attach_payment_intent(p_payment uuid, p_intent text)`
    - `confirm_payment(p_intent text, p_method text) returns text` — `'confirmed'` | `'already'` | `'late_refund'` ; paiement `succeeded` ; réservation `paid` ; si elle avait expiré : réactivée si cours non commencé et non annulé, sinon `refund_pending` (retour `'late_refund'`)
    - `fail_payment(p_intent text)`
    - `refunds_to_process(p_limit int) returns setof payments` et `mark_refunded(p_payment uuid)` (réservation `refunded`)
  - `process_course_schedule` étendu : réservations `pending` expirées → `cancelled_at = now()`

- [ ] **Step 1: Tests pgTAP qui échouent :**
  - Non-adhérent : réservations 1 à 10 → montant 0, `free_trial` ; 11ᵉ → 20, `needs_payment`, `pending_until` ≈ +15 min.
  - Se désinscrire d'un essai → `trial_used` baisse ; un essai sur un cours annulé ne compte plus.
  - Adhérent (`paid_until` futur) → prix adhérent, `free_trial = false`, `trial_used` inchangé.
  - Réservation en attente expirée → plus active (compteur, participants, notifications d'annulation) ; `process_course_schedule` la libère.
  - `confirm_payment` deux fois → `'confirmed'` puis `'already'`, un seul passage à `paid`.
  - `confirm_payment` après expiration, cours futur → réservation réactivée ; cours annulé → `'late_refund'`, paiement `refund_pending`.
  - `cancel_course` d'un cours avec une réservation payée → paiement `refund_pending` ; `mark_refunded` → `refunded` ; `refunds_to_process` ne la renvoie plus.
  - `start_course_payment` pour l'enfant d'un autre → `42501` ; deux appels → même `payment_id`.
  - `authenticated` ne peut exécuter aucune fonction `service_role` (42501) ni lire les paiements d'un autre.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** → PASS ; tous les tests des plans 1–2 restent verts ; types régénérés.
- [ ] **Step 5:** Commit `feat: prix des réservations, essais, paiements et remboursements`.

### Task 3: Abonnements côté base et webhook Stripe

**Files:**
- Create: `icon-valais/supabase/migrations/0011_subscriptions.sql`
- Create: `icon-valais/supabase/functions/_shared/stripe.ts`, `_shared/stripeWebhook.ts`
- Create: `icon-valais/supabase/functions/stripe-webhook/index.ts`
- Test: `icon-valais/supabase/tests/subscriptions.test.sql`, `icon-valais/supabase/functions/_shared/stripe.test.ts`, `_shared/stripeWebhook.test.ts`
- Modify: `icon-valais/supabase/config.jsonc` (`stripe-webhook` : `verify_jwt: false`)

**Interfaces:**
- Consumes: tâches 1–2.
- Produces :
  - table `stripe_events(id text pk, type text, received_at)` (service_role) — idempotence
  - fonctions `service_role` :
    - `start_membership_payment(p_profile uuid, p_payer uuid, p_months int, p_source membership_source) returns table(membership_id uuid, payment_id uuid, amount numeric, description text)` — `can_pay_for` vérifié pour `p_payer` ; montant = `membership_price` ; crée `memberships` `pending` + `payments` `pending`
    - `activate_membership(p_payment_intent text, p_subscription text null, p_period_end date null) returns text` — `starts_on` = max(aujourd'hui, fin de l'adhésion en cours + 1 jour) ; `ends_on` = `p_period_end` si fourni, sinon `starts_on + months - 1 jour` ; `auto_renew = (p_subscription is not null)` ; idempotent
    - `renew_membership(p_subscription text, p_invoice text, p_amount numeric, p_period_end date) returns text` — nouveau paiement `succeeded` lié à la même adhésion, `ends_on = p_period_end` ; idempotent par `p_invoice`
    - `set_membership_cancel(p_subscription text, p_cancel_at_period_end bool)` et `end_membership(p_subscription text)`
    - `record_customer(p_profile uuid, p_customer text)`
  - `membership_expiring` ajouté aux genres de `notification_outbox` ; `process_course_schedule` écrit une ligne (une fois) pour chaque adhésion `one_time` active dont `ends_on` = aujourd'hui + 7 jours (au profil, ou au parent pour un enfant) ; textes traduits dans `_shared/push.ts`
  - `_shared/stripe.ts` : `toCents(chf: number): number` ; `stripeRequest(path: string, params: Record<string, string>, key: string, fetchFn?: typeof fetch): Promise<unknown>` (POST `application/x-www-form-urlencoded` vers `https://api.stripe.com/v1/...`, `Idempotency-Key` optionnelle) ; `encodeForm(obj): string` (notation `a[b][0]=` de Stripe)
  - `_shared/stripeWebhook.ts` : `verifyStripeSignature(payload: string, header: string, secret: string, nowSec: number, toleranceSec = 300): Promise<boolean>` (HMAC-SHA256 `t.payload`, comparaison en temps constant) ; `routeStripeEvent(event): Action` où `Action` = `{ fn: string; args: Record<string, unknown> } | { ignore: true }` pour `payment_intent.succeeded`, `payment_intent.payment_failed`, `invoice.paid` (`billing_reason = 'subscription_cycle'` → renouvellement ; `subscription_create` → activation), `customer.subscription.updated` (`cancel_at_period_end`), `customer.subscription.deleted`, `charge.refunded`
  - Edge `stripe-webhook` : lit le corps brut, vérifie la signature (`STRIPE_WEBHOOK_SECRET`) → 400 sinon ; insère `stripe_events` (déjà vu → 200 sans effet) ; appelle la fonction SQL de l'action ; 200

- [ ] **Step 1: Tests qui échouent :**
  - pgTAP : `start_membership_payment` d'un parent pour son enfant de 12 ans 1 mois → 50 ; pour l'enfant d'un autre → 42501.
  - pgTAP : `activate_membership` → `is_member` vrai jusqu'à `ends_on` ; deux fois → une seule activation ; une 2ᵉ adhésion payée pendant la 1ʳᵉ démarre le lendemain de sa fin.
  - pgTAP : `renew_membership` avec la même facture deux fois → une seule prolongation et un seul paiement.
  - pgTAP : `set_membership_cancel(true)` → toujours adhérent jusqu'à `ends_on`, `cancel_at_period_end` ; `end_membership` → `ended`.
  - pgTAP : adhésion `one_time` finissant dans 7 jours → une ligne `membership_expiring` (pour le parent si enfant) ; 2ᵉ passage → aucune.
  - Deno : signature valide → vrai ; corps modifié → faux ; horodatage vieux de 10 min → faux ; secret faux → faux.
  - Deno : `routeStripeEvent` pour chaque type → la bonne fonction et les bons arguments ; type inconnu → `ignore`.
  - Deno : `toCents(19.99) === 1999` ; `encodeForm({metadata:{a:'1'}, items:[{price:'p'}]})` → `metadata[a]=1&items[0][price]=p`.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** → PASS (pgTAP, Deno).
- [ ] **Step 5:** Commit `feat: abonnements, webhook Stripe et rappel TWINT`.

### Task 4: Edge Functions de paiement, remboursements et quittances

**Files:**
- Create: `icon-valais/supabase/functions/create-payment/index.ts`, `_shared/payments.ts`
- Create: `icon-valais/supabase/functions/cancel-subscription/index.ts`
- Create: `icon-valais/supabase/functions/process-refunds/index.ts`
- Create: `icon-valais/supabase/functions/receipt/index.ts`, `_shared/receipt.ts`
- Modify: `icon-valais/supabase/migrations/0011_subscriptions.sql` (tâche cron `process-refunds` toutes les 5 min via `pg_net`, comme `send-push`)
- Test: `icon-valais/supabase/functions/_shared/payments.test.ts`, `_shared/receipt.test.ts`
- Modify: `icon-valais/README.md` (secrets Stripe, URL du webhook, événements à cocher dans le tableau de bord Stripe)

**Interfaces:**
- Consumes: tâches 1–3.
- Produces :
  - Edge `create-payment` (POST, utilisateur connecté). Corps : `{ kind: 'course', bookingId }` ou `{ kind: 'membership', profileId, months, method: 'card' | 'twint' }`, plus `platform: 'native' | 'web'`. Réponse native : `{ paymentIntentClientSecret, customerId, ephemeralKeySecret, publishableKey, amount }` ; réponse web : `{ checkoutUrl }`. Cours et TWINT → PaymentIntent (`payment_method_types` : `card`, `twint` ; Apple/Google Pay via `card`) ; abonnement carte → Customer + Price en ligne + Subscription `payment_behavior=default_incomplete`, `metadata.membership_id`, et renvoi du `client_secret` de la première facture. Montant toujours lu en base. `metadata` : `payment_id`, `booking_id` / `membership_id`.
  - `_shared/payments.ts` : `buildCoursePaymentParams(row, customerId): Record<string,string>`, `buildSubscriptionParams(row, customerId): Record<string,string>`, `buildCheckoutParams(row, successUrl, cancelUrl): Record<string,string>` (purs, testés)
  - Edge `cancel-subscription` (POST `{ membershipId }`, payeur ou bénéficiaire) → Stripe `cancel_at_period_end=true`, puis `set_membership_cancel`
  - Edge `process-refunds` (service role, cron) : `refunds_to_process(20)` → `POST /v1/refunds` (`payment_intent`, `Idempotency-Key = refund-<payment_id>`) → `mark_refunded` ; une erreur Stripe laisse la ligne pour le passage suivant
  - `_shared/receipt.ts` : `buildReceiptPdf(r: ReceiptData, lang: Lang): Promise<Uint8Array>` — en-tête « Icon Valais Conthey », « Quittance n° <receipt_no> », date (Europe/Zurich), payeur, bénéficiaire si différent, description, montant CHF, moyen de paiement, mention « Pas de TVA », statut remboursé le cas échéant
  - Edge `receipt` (GET `?payment=<id>`, payeur / bénéficiaire / parent / admin) → `application/pdf`

- [ ] **Step 1: Tests qui échouent (Deno) :**
  - `buildCoursePaymentParams` : `amount = 2000`, `currency = chf`, `payment_method_types[0]=card`, `payment_method_types[1]=twint`, `metadata[payment_id]` présent.
  - `buildSubscriptionParams` : prix récurrent `month` avec `interval_count = months`, montant en centimes, `payment_behavior=default_incomplete`, `metadata[membership_id]`.
  - `buildReceiptPdf` : commence par `%PDF`, contient « Icon Valais Conthey », le numéro et « 20.00 CHF » (extraction texte de pdf-lib ou recherche dans le flux non compressé) ; 4 langues.
  - Gestion de requête `create-payment` (dépendances injectées) : réservation de quelqu'un d'autre → 403 ; montant pris en base et non dans le corps ; Stripe en erreur → 502 sans fuite de clé.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** → PASS ; `deno check` sur toutes les fonctions.
- [ ] **Step 5:** Commit `feat: paiement Stripe, remboursements et quittances`.

### Task 5: Justificatif étudiant (base + stockage)

**Files:**
- Create: `icon-valais/supabase/migrations/0012_student_proofs.sql`
- Test: `icon-valais/supabase/tests/student_proofs.test.sql`
- Modify: `icon-valais/supabase/functions/delete-account/index.ts` (supprimer aussi les fichiers du profil et de ses enfants)

**Interfaces:**
- Produces :
  - bucket privé `student-proofs` ; chemins `<profile_id>/<uuid>.<pdf|jpg|png>` ; 10 Mo max ; types `application/pdf`, `image/jpeg`, `image/png`
  - politiques `storage.objects` : envoi et lecture dans son dossier ou celui de son enfant ; lecture de tout le bucket par l'admin ; aucune suppression client
  - table `student_proofs(id uuid pk, profile_id uuid references profiles on delete cascade, path text not null, submitted_at, decided_at, decided_by uuid null references profiles on delete set null, decision text null check (in ('valide','refuse')))`
  - `submit_student_proof(p_profile uuid, p_path text)` — soi ou son enfant ; le chemin doit être dans le dossier du profil ; `student_status = 'en_attente'`, `is_student = true`
  - `admin_decide_student(p_proof uuid, p_valid bool)` — admin ; met `student_status` et la décision ; le fichier est conservé
  - vue `pending_student_proofs` (admin) : preuve + nom + âge

- [ ] **Step 1: Tests pgTAP qui échouent :** envoi d'une preuve pour soi → `en_attente` ; pour l'enfant d'un autre → 42501 ; chemin hors de son dossier → 42501 ; `admin_decide_student(...,true)` → `valide` et le prix étudiant s'applique (`membership_price`) ; par un prof → 42501 ; politique de stockage : un élève ne lit pas le dossier d'un autre.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat: justificatif étudiant`.

### Task 6: Réserver et payer un cours (app)

**Files:**
- Create: `icon-valais/src/lib/payments.ts`, `icon-valais/src/lib/__tests__/payments.test.ts`
- Create: `icon-valais/src/components/payments/PaySheet.tsx` (natif : PaymentSheet ; web : redirection Checkout)
- Modify: `icon-valais/src/components/courses/BookButton.tsx`, `src/lib/coursesApi.ts`, `app/_layout.tsx` (`StripeProvider` sur natif)
- Create: `icon-valais/app/payment-result.tsx` (retour web de Checkout)
- Test: `icon-valais/app/(tabs)/__tests__/courses.test.tsx` (complété)

**Interfaces:**
- Consumes: `book_course` (tâche 2), `create-payment` (tâche 4), `my_membership`, `my_trial_status` (tâche 2).
- Produces: `payBooking(bookingId: string): Promise<'paid' | 'cancelled' | 'error'>`, `payMembership(profileId: string, months: 1|3|6|12, method: 'card'|'twint'): Promise<'paid'|'cancelled'|'error'>`.

Comportement : la carte affiche pour un non-adhérent « Cours d'essai — X/10 utilisés » ou le prix ; réserver un cours payant ouvre un écran de confirmation avec le montant, la mention « Remboursé uniquement si le cours est annulé par le professeur. » et un lien « Devenir adhérent » ; après paiement, la réservation apparaît comme payée (le webhook confirme ; l'app recharge jusqu'à 10 s puis affiche « paiement en cours de confirmation »). Un abandon de paiement libère la place après 15 min.

- [ ] **Step 1: Tests qui échouent (RNTL, Stripe et API mockés) :** non-adhérent avec 3 essais → « 3/10 » ; 11ᵉ cours → écran avec « 20.00 CHF » et la mention exacte ; paiement réussi → `create-payment` appelé avec `{kind:'course', bookingId}` puis rechargement ; paiement annulé → aucun état payé ; web → redirection vers `checkoutUrl` ; adhérent → aucun écran de paiement pour un cours à 0 CHF.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implémenter (versions natives de `bundledNativeModules.json` ; plugin `@stripe/stripe-react-native` dans `app.json` avec `merchantIdentifier` placeholder documenté pour le plan 5).
- [ ] **Step 4:** → PASS ; `npx expo export --platform web` OK.
- [ ] **Step 5:** Commit `feat: paiement des cours`.

### Task 7: Abonnement et justificatif étudiant (app)

**Files:**
- Create: `icon-valais/app/(tabs)/profile/membership.tsx`, `app/(tabs)/profile/student-proof.tsx`
- Create: `icon-valais/src/components/payments/PlanPicker.tsx`
- Modify: `icon-valais/app/(tabs)/profile/index.tsx` (liens « Mon abonnement », « Justificatif étudiant », statut adhérent), `app/(tabs)/profile/child/[id].tsx` (abonnement de l'enfant)
- Test: `icon-valais/app/(tabs)/profile/__tests__/membership.test.tsx`, `student-proof.test.tsx`

**Interfaces:**
- Consumes: `membership_price`, `my_membership`, `payMembership`, `cancel-subscription`, `submit_student_proof`, Storage.

Écran abonnement : statut (« Adhérent jusqu'au JJ.MM.AAAA », renouvellement auto ou non, résiliation programmée) ; 4 formules avec le prix calculé par le serveur et la réduction appliquée (« −50 % enfant », « −30 % étudiant ») ; choix « Carte (renouvellement automatique) » / « TWINT (paiement unique) » ; bouton « Résilier » (confirmation) si `auto_renew`. Pour un enfant, le parent ouvre le même écran depuis la fiche de l'enfant. Écran justificatif : « Prendre une photo » (`expo-image-picker` caméra) ou « Choisir un PDF » (`expo-document-picker`), envoi dans `student-proofs/<profile_id>/`, puis statut « en attente / validé / refusé ».

- [ ] **Step 1: Tests qui échouent :** les 4 prix viennent de `membership_price` (mock) et affichent la réduction ; choisir 3 mois + TWINT → `payMembership(id,3,'twint')` ; « Résilier » demande confirmation puis appelle `cancel-subscription` ; un parent voit l'écran pour son enfant ; justificatif : photo prise → envoi au bon chemin puis `submit_student_proof` ; fichier > 10 Mo → message traduit.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat: abonnement et justificatif étudiant`.

### Task 8: Mes paiements et administration (app)

**Files:**
- Create: `icon-valais/app/(tabs)/profile/payments.tsx`
- Create: `icon-valais/app/(tabs)/admin/pricing.tsx`, `app/(tabs)/admin/students.tsx`, `app/(tabs)/admin/payments.tsx`
- Modify: `icon-valais/app/(tabs)/admin/index.tsx` (liens ; badge « Adhérent jusqu'au … » / « Non-adhérent » / « Essais X/10 » dans la liste), `src/components/admin/AccountDetail.tsx` (adhésion, paiements du membre)
- Test: `icon-valais/app/(tabs)/profile/__tests__/payments.test.tsx`, `app/(tabs)/admin/__tests__/{pricing,students,payments}.test.tsx`

Mes paiements : liste (date, description, montant, statut, « Remboursé » le cas échéant), bouton « Quittance » qui ouvre l'Edge Function `receipt` (natif : partage du PDF ; web : téléchargement). Admin : tarifs (5 prix + 2 pourcentages + âge enfant, validation), justificatifs en attente (aperçu du fichier par URL signée, Valider / Refuser), paiements (filtre période, total encaissé, total remboursé).

- [ ] **Step 1: Tests qui échouent :** la liste affiche « Remboursé » pour un paiement `refunded` ; « Quittance » appelle `receipt?payment=<id>` ; l'écran tarifs refuse 95 % ; « Valider » appelle `admin_decide_student(id, true)` ; un non-admin voit « accès refusé » sur les 3 écrans admin ; le total encaissé exclut les remboursés.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat: mes paiements et administration des paiements`.

### Task 9: Vérification finale du plan 3

- [ ] **Step 1:** `npx tsc --noEmit`, `npx jest`, `npx supabase db reset && npx supabase test db`, tests Deno → tout PASS.
- [ ] **Step 2:** Étendre `e2e/smoke.e2e.mjs` (Stripe simulé par SQL, en appelant les mêmes fonctions `service_role` que le webhook) : un non-adhérent réserve 10 cours gratuits puis le 11ᵉ affiche 20 CHF et la mention ; `confirm_payment` → la réservation apparaît payée ; l'admin annule le cours → paiement `refund_pending` puis `mark_refunded` → « Remboursé » dans Mes paiements ; un parent prend l'abonnement 1 mois de son enfant de 12 ans → 50 CHF, `activate_membership` → l'enfant réserve un cours à 0 CHF ; l'admin valide un justificatif → le prix étudiant s'affiche ; quittance PDF téléchargeable (si les Edge Functions ne démarrent pas localement : `buildReceiptPdf` exécuté par script Deno sur un paiement réel de la base, noté).
- [ ] **Step 3:** Si la clé Stripe de test est disponible dans l'environnement (secret réseau pour `api.stripe.com`), appeler une fois l'API Stripe de test avec les paramètres construits par `_shared/payments.ts` (PaymentIntent 20 CHF card+twint, abonnement 1 mois) et vérifier les réponses ; sinon noter « non exécuté ».
- [ ] **Step 4:** README : configuration Stripe (clés, webhook, événements), secrets Supabase, cron des remboursements, cartes de test, limites.
- [ ] **Step 5:** Commit `docs: plan 3 vérifié`.
