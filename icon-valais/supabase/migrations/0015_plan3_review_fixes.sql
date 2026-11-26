-- =============================================================================
-- 0015_plan3_review_fixes : corrections de la revue finale du plan 3
--
--  * Remboursements : nouvel état payment_state 'refund_failed' (visible de
--    l'admin). payments.refund_attempts / refund_next_attempt_at : un échec
--    de remboursement (process-refunds → refund_attempt_failed) est réessayé
--    avec un délai exponentiel (5 min, 10, 20, … ; refund_backoff) ; au 8e
--    échec → refund_failed. refunds_to_process respecte
--    refund_next_attempt_at ; une ligne refund_pending sans intent (donc
--    impossible à rembourser automatiquement) passe directement en
--    refund_failed (fail_unrefundable_payments).
--  * Remboursement refusé par Stripe après coup (refund.failed,
--    charge.refund.updated / refund.updated avec status failed) :
--    mark_refund_failed → paiement refund_failed (réservation de cours
--    remboursée → refund_pending).
--  * Abonnement / paiement Stripe orphelin (adhésion supprimée, p. ex. avec
--    le compte) : activate_membership / renew_membership ne lèvent plus
--    P0002 à chaque rejeu de Stripe ; l'argent est noté à rendre et
--    l'abonnement à annuler dans orphan_stripe_items (record_orphan),
--    traités par process-refunds (orphans_to_process → DELETE
--    /v1/subscriptions/<id> et/ou POST /v1/refunds → mark_orphan_done ;
--    échec → orphan_attempt_failed, même délai exponentiel, 8 essais →
--    failed_at). Résultat 'orphan'.
--  * activate_membership : second abonnement actif pour le même profil
--    (double activation) → paiement refund_pending (error
--    duplicate_subscription), nouvel abonnement annulé immédiatement
--    (stripe_cancel_pending) → 'duplicate_subscription'. Adhésion déjà
--    terminée (ended, p. ex. expirée par process_course_schedule) qui reçoit
--    son paiement → remboursé (+ abonnement annulé) → 'late_refund'.
--  * renew_membership sur une adhésion terminée (ended) : facture remboursée
--    (paiement refund_pending, error membership_ended) et abonnement annulé
--    immédiatement → 'ended_refund' (au lieu de prolonger).
--  * process_course_schedule : adhésion pending depuis plus de 24 h →
--    ended, son paiement pending → failed (error expired).
--  * profiles : suppression par l'API (rôle authenticated) d'un profil qui a
--    un abonnement Stripe actif (ou à annuler) → 42501 live_subscription
--    (trigger profiles_block_live_subscription). La suppression du compte
--    (delete-account : abonnements annulés chez Stripe d'abord, puis cascade
--    depuis auth.users) n'est pas concernée.
--
-- HINTs stables : live_subscription, invalid_field, missing_intent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Remboursements : état refund_failed, tentatives
-- ---------------------------------------------------------------------------
-- La nouvelle valeur n'est utilisée que dans des fonctions plpgsql (évaluées
-- à l'exécution, après validation de la migration).
alter type public.payment_state add value if not exists 'refund_failed';

alter table public.payments
  add column refund_attempts int not null default 0 check (refund_attempts >= 0),
  add column refund_next_attempt_at timestamptz null;

-- Délai avant la tentative suivante après p_attempts échecs : 5 min × 2^(n-1).
create function public.refund_backoff(p_attempts int) returns interval
language sql immutable set search_path = '' as $$
  select interval '5 minutes' * power(2, greatest(coalesce(p_attempts, 1), 1) - 1)::int;
$$;

-- refund_pending sans intent : rien à rembourser automatiquement → refund_failed
-- (visible de l'admin, à régler à la main). Renvoie le nombre de lignes.
create function public.fail_unrefundable_payments() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_n int;
begin
  update public.payments
     set status = 'refund_failed',
         error = concat_ws('; ', error, 'refund: missing_intent')
   where status = 'refund_pending' and stripe_payment_intent_id is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Paiements à rembourser (process-refunds) : refund_pending avec intent, dont
-- la tentative suivante est due.
create or replace function public.refunds_to_process(p_limit int) returns setof public.payments
language plpgsql security definer set search_path = '' as $$
begin
  perform public.fail_unrefundable_payments();
  return query
    select * from public.payments
     where status = 'refund_pending' and stripe_payment_intent_id is not null
       and (refund_next_attempt_at is null or refund_next_attempt_at <= now())
     order by created_at, id
     limit greatest(coalesce(p_limit, 20), 0);
end;
$$;

-- Échec d'un remboursement (process-refunds) : tentative suivante différée ;
-- 8e échec → refund_failed. Renvoie 'retry', 'refund_failed' ou 'ignored'
-- (paiement inconnu ou plus en refund_pending).
create function public.refund_attempt_failed(p_payment uuid, p_error text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_n int;
begin
  update public.payments
     set refund_attempts = refund_attempts + 1,
         refund_next_attempt_at = now() + public.refund_backoff(refund_attempts + 1),
         status = case when refund_attempts + 1 >= 8 then 'refund_failed' else status end::public.payment_state,
         error = case when refund_attempts + 1 >= 8
                      then concat_ws('; ', error, 'refund: ' || left(coalesce(p_error, 'error'), 200))
                      else error end
   where id = p_payment and status = 'refund_pending'
  returning refund_attempts into v_n;
  if v_n is null then
    return 'ignored';
  end if;
  return case when v_n >= 8 then 'refund_failed' else 'retry' end;
end;
$$;

-- Remboursement refusé par Stripe (refund.failed / refund.updated failed).
-- Paiement retrouvé par p_payment (metadata.payment_id du remboursement),
-- sinon par l'intent. refunded / refund_pending → refund_failed (réservation
-- remboursée → refund_pending : l'argent est encore dû). Sinon 'ignored' ;
-- introuvable → 'unknown' (un remboursement d'orphelin est marqué failed_at).
create function public.mark_refund_failed(p_intent text, p_payment uuid default null, p_reason text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_booking uuid;
  v_p public.payments;
begin
  if p_payment is not null then
    select id, booking_id into v_id, v_booking from public.payments where id = p_payment;
  end if;
  if v_id is null and p_intent is not null then
    select id, booking_id into v_id, v_booking from public.payments where stripe_payment_intent_id = p_intent;
  end if;
  if v_id is null then
    update public.orphan_stripe_items
       set failed_at = now(), refunded_at = null,
           error = concat_ws('; ', error, 'refund_failed: ' || coalesce(p_reason, 'unknown'))
     where p_intent is not null and intent = p_intent;
    return 'unknown';
  end if;
  -- ordre des verrous : réservation → paiement
  if v_booking is not null then
    perform 1 from public.bookings where id = v_booking for update;
  end if;
  select * into v_p from public.payments where id = v_id for update;
  if v_p.status not in ('refunded', 'refund_pending') then
    return 'ignored';
  end if;
  update public.payments
     set status = 'refund_failed', refunded_at = null,
         error = concat_ws('; ', error, 'refund_failed: ' || coalesce(p_reason, 'unknown'))
   where id = v_p.id;
  update public.bookings set payment_status = 'refund_pending'
   where id = v_p.booking_id and payment_status = 'refunded';
  return 'refund_failed';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Éléments Stripe orphelins (adhésion introuvable)
-- ---------------------------------------------------------------------------
--  kind 'subscription' : abonnement (stripe_id) à annuler immédiatement ;
--  kind 'payment'      : paiement sans adhésion (stripe_id = intent).
--  intent non null : montant à rembourser (null : rien à rendre, ou rendu par
--  la ligne payments correspondante).
create table public.orphan_stripe_items (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('subscription', 'payment')),
  stripe_id       text not null,
  intent          text null,
  invoice         text null unique,
  amount          numeric(8,2) null,
  created_at      timestamptz not null default now(),
  refunded_at     timestamptz null,
  cancelled_at    timestamptz null,
  attempts        int not null default 0,
  next_attempt_at timestamptz null,
  failed_at       timestamptz null,
  error           text null
);

create unique index orphan_stripe_items_intent_idx on public.orphan_stripe_items (intent) where intent is not null;

alter table public.orphan_stripe_items enable row level security;

create policy orphan_stripe_items_select on public.orphan_stripe_items
  for select to authenticated
  using (public.is_admin() and public.current_account_active());

revoke all on public.orphan_stripe_items from anon, authenticated, service_role;
grant select on public.orphan_stripe_items to authenticated, service_role;

-- Enregistre un orphelin. Déjà connu (même intent, même facture, ou même
-- abonnement sans montant) → 'already' ; sinon 'orphan'.
create function public.record_orphan(
  p_kind text, p_stripe_id text, p_intent text, p_invoice text, p_amount numeric
) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if p_kind is null or p_kind not in ('subscription', 'payment') or coalesce(p_stripe_id, '') = '' then
    raise exception 'record_orphan: kind and stripe id are required'
      using errcode = '22023', hint = 'invalid_field';
  end if;
  if (p_intent is not null and exists (select 1 from public.orphan_stripe_items where intent = p_intent))
     or (p_invoice is not null and exists (select 1 from public.orphan_stripe_items where invoice = p_invoice))
     or (p_intent is null and p_invoice is null
         and exists (select 1 from public.orphan_stripe_items
                      where kind = p_kind and stripe_id = p_stripe_id and intent is null and invoice is null)) then
    return 'already';
  end if;
  insert into public.orphan_stripe_items (kind, stripe_id, intent, invoice, amount)
  values (p_kind, p_stripe_id, p_intent, p_invoice, p_amount)
  on conflict do nothing;
  return 'orphan';
end;
$$;

-- Orphelins à traiter (process-refunds) : abonnement à annuler et/ou montant à
-- rembourser, tentative suivante due, pas abandonnés.
create function public.orphans_to_process(p_limit int) returns setof public.orphan_stripe_items
language sql stable security definer set search_path = '' as $$
  select * from public.orphan_stripe_items
   where failed_at is null
     and (next_attempt_at is null or next_attempt_at <= now())
     and ((kind = 'subscription' and cancelled_at is null) or (intent is not null and refunded_at is null))
   order by created_at, id
   limit greatest(coalesce(p_limit, 20), 0);
$$;

-- p_what : 'cancelled' (toutes les lignes du même abonnement) ou 'refunded'.
create function public.mark_orphan_done(p_id uuid, p_what text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_o public.orphan_stripe_items;
begin
  select * into v_o from public.orphan_stripe_items where id = p_id for update;
  if v_o.id is null then
    raise exception 'mark_orphan_done: orphan not found' using errcode = 'P0002';
  end if;
  if p_what = 'cancelled' then
    update public.orphan_stripe_items set cancelled_at = coalesce(cancelled_at, now())
     where kind = 'subscription' and stripe_id = v_o.stripe_id;
  elsif p_what = 'refunded' then
    update public.orphan_stripe_items set refunded_at = coalesce(refunded_at, now()) where id = p_id;
  else
    raise exception 'mark_orphan_done: p_what must be cancelled or refunded'
      using errcode = '22023', hint = 'invalid_field';
  end if;
end;
$$;

-- Échec Stripe sur un orphelin : délai exponentiel ; 8e échec → failed_at.
create function public.orphan_attempt_failed(p_id uuid, p_error text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_n int;
begin
  update public.orphan_stripe_items
     set attempts = attempts + 1,
         next_attempt_at = now() + public.refund_backoff(attempts + 1),
         failed_at = case when attempts + 1 >= 8 then now() end,
         error = case when attempts + 1 >= 8 then left(coalesce(p_error, 'error'), 200) else error end
   where id = p_id and failed_at is null
  returning attempts into v_n;
  if v_n is null then
    return 'ignored';
  end if;
  return case when v_n >= 8 then 'failed' else 'retry' end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. activate_membership (0012) : orphelin, double abonnement, adhésion
-- terminée
-- ---------------------------------------------------------------------------
--  'activated' | 'already' | 'awaiting_invoice' | 'amount_mismatch' (0012)
--  'orphan'                 : adhésion introuvable → argent à rendre,
--                             abonnement à annuler (orphan_stripe_items, ou
--                             paiement refund_pending s'il existe encore)
--  'duplicate_subscription' : un autre abonnement actif qui se renouvelle
--                             existe déjà pour ce profil → refund_pending,
--                             nouvel abonnement annulé immédiatement
--  'late_refund'            : adhésion terminée (expirée) → refund_pending,
--                             abonnement annulé immédiatement
create or replace function public.activate_membership(
  p_payment_intent text,
  p_subscription text default null,
  p_period_end date default null,
  p_membership uuid default null,
  p_method text default null,
  p_amount_cents bigint default null,
  p_currency text default null
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Europe/Zurich')::date;
  v_mid uuid;
  v_pid uuid;
  v_m public.memberships;
  v_p public.payments;
  v_kind public.payment_kind;
  v_cur date;
  v_start date;
  v_end date;
  v_err text;
  v_reason text;
begin
  if p_payment_intent is not null then
    select id, membership_id, kind into v_pid, v_mid, v_kind
      from public.payments where stripe_payment_intent_id = p_payment_intent;
    if v_kind = 'course' then
      raise exception 'activate_membership: not a membership payment'
        using errcode = '22023', hint = 'invalid_field';
    end if;
  end if;
  if v_mid is null and p_subscription is not null then
    select id into v_mid from public.memberships where stripe_subscription_id = p_subscription;
  end if;
  if v_mid is null and p_membership is not null then
    select id into v_mid from public.memberships where id = p_membership;
  end if;

  if v_mid is null then
    -- adhésion introuvable (supprimée, p. ex. avec le compte) : ne pas lever
    -- P0002 (Stripe réessaierait sans fin) ; l'argent est rendu et
    -- l'abonnement annulé par process-refunds
    if v_pid is not null then
      select * into v_p from public.payments where id = v_pid for update;
      if v_p.status in ('pending', 'failed') then
        update public.payments
           set status = 'refund_pending', error = 'orphan', paid_at = now(),
               method = coalesce(p_method, method)
         where id = v_p.id;
      end if;
      if p_subscription is not null then
        perform public.record_orphan('subscription', p_subscription, null, null, null);
      end if;
      return case when v_p.status in ('pending', 'failed') or p_subscription is not null then 'orphan' else 'already' end;
    end if;
    if p_payment_intent is null and p_subscription is null then
      raise exception 'activate_membership: membership not found' using errcode = 'P0002';
    end if;
    if p_payment_intent is null and coalesce(p_amount_cents, 0) > 0 then
      raise exception 'activate_membership: payment intent unknown'
        using errcode = '55000', hint = 'missing_intent';
    end if;
    return public.record_orphan(
      case when p_subscription is not null then 'subscription' else 'payment' end,
      coalesce(p_subscription, p_payment_intent),
      case when coalesce(p_amount_cents, 1) > 0 then p_payment_intent end,
      null,
      round(p_amount_cents / 100.0, 2));
  end if;

  -- verrous : profil bénéficiaire (empilement des périodes) → adhésion → paiement
  perform 1 from public.profiles p
    join public.memberships m on m.profile_id = p.id
   where m.id = v_mid
     for no key update of p;
  select * into v_m from public.memberships where id = v_mid for update;
  if v_pid is null then
    select id into v_pid from public.payments
     where membership_id = v_mid and kind = 'membership'
     order by (status in ('pending', 'failed')) desc, created_at
     limit 1;
  end if;
  if v_pid is not null then
    select * into v_p from public.payments where id = v_pid for update;
  end if;

  if v_p.status in ('succeeded', 'refund_pending', 'refunded', 'refund_failed')
     or v_m.status in ('active', 'cancelled') then
    return 'already';
  end if;
  -- v_m.status : pending, ou ended (expirée / annulée avant paiement)
  if v_m.source = 'stripe_subscription' and p_subscription is null then
    return 'awaiting_invoice';
  end if;
  -- paiement réglé sans intent connu : il ne pourrait pas être remboursé ;
  -- refusé (le webhook renvoie 500, Stripe réessaiera)
  if v_p.id is not null and coalesce(v_p.stripe_payment_intent_id, p_payment_intent) is null then
    raise exception 'activate_membership: payment intent unknown'
      using errcode = '55000', hint = 'missing_intent';
  end if;
  v_err := public.amount_mismatch(coalesce(v_p.amount, v_m.amount), p_amount_cents, p_currency);

  if v_err is null and v_m.status = 'ended' then
    v_reason := 'membership_ended';
  elsif v_err is null and v_m.source = 'stripe_subscription'
        and exists (select 1 from public.memberships o
                     where o.profile_id = v_m.profile_id and o.id <> v_m.id
                       and o.source = 'stripe_subscription' and o.status = 'active' and o.auto_renew
                       and o.ends_on >= v_today) then
    v_reason := 'duplicate_subscription';
  end if;

  if v_err is not null or v_reason is not null then
    if v_p.id is not null then
      -- argent reçu rendu (process-refunds, par l'intent)
      update public.payments
         set status = 'refund_pending', error = coalesce(v_err, v_reason), paid_at = now(),
             method = coalesce(p_method, method),
             stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent)
       where id = v_p.id;
    elsif p_payment_intent is not null then
      perform public.record_orphan('payment', p_payment_intent, p_payment_intent, null,
                                   round(p_amount_cents / 100.0, 2));
    end if;
    if v_m.source = 'stripe_subscription' and p_subscription is not null then
      -- Stripe ne doit plus facturer : annulation immédiate par process-refunds
      update public.memberships
         set stripe_subscription_id = coalesce(stripe_subscription_id, p_subscription),
             stripe_cancel_pending = true,
             auto_renew = false
       where id = v_m.id;
    end if;
    return case
      when v_err is not null then 'amount_mismatch'
      when v_reason = 'membership_ended' then 'late_refund'
      else 'duplicate_subscription'
    end;
  end if;

  select max(e) into v_cur from (
    select paid_until as e from public.profiles where id = v_m.profile_id
    union all
    select ends_on from public.memberships
     where profile_id = v_m.profile_id and id <> v_m.id and status in ('active', 'cancelled')
  ) x;
  v_start := greatest(v_today, v_cur + 1);
  v_end := coalesce(p_period_end, (v_start + make_interval(months => v_m.months) - interval '1 day')::date);
  v_start := least(v_start, v_end);

  update public.memberships
     set status = 'active',
         starts_on = v_start,
         ends_on = v_end,
         auto_renew = p_subscription is not null,
         cancel_at_period_end = false,
         stripe_subscription_id = coalesce(p_subscription, stripe_subscription_id)
   where id = v_m.id;
  if v_p.id is not null then
    update public.payments
       set status = 'succeeded',
           paid_at = now(),
           method = coalesce(p_method, method),
           error = null,
           stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent)
     where id = v_p.id;
  end if;
  return 'activated';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. renew_membership (0012) : abonnement inconnu → orphelin ; adhésion
-- terminée → remboursée et annulée
-- ---------------------------------------------------------------------------
--  'renewed' | 'already' | 'amount_mismatch' (0012)
--  'orphan'       : abonnement inconnu (adhésion supprimée) → facture à
--                   rembourser, abonnement à annuler (orphan_stripe_items)
--  'ended_refund' : adhésion terminée → paiement refund_pending (error
--                   membership_ended), abonnement annulé immédiatement
create or replace function public.renew_membership(
  p_subscription text, p_invoice text, p_amount numeric, p_period_end date,
  p_currency text default null, p_intent text default null
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_m public.memberships;
  v_err text;
  v_intent text;
begin
  if p_invoice is null or p_invoice = '' or p_period_end is null then
    raise exception 'renew_membership: p_invoice and p_period_end are required'
      using errcode = '22023', hint = 'invalid_field';
  end if;
  select * into v_m from public.memberships where stripe_subscription_id = p_subscription for update;
  if v_m.id is null then
    if coalesce(p_amount, 0) > 0 and p_intent is null then
      raise exception 'renew_membership: payment intent unknown'
        using errcode = '55000', hint = 'missing_intent';
    end if;
    return public.record_orphan('subscription', p_subscription,
                                case when coalesce(p_amount, 0) > 0 then p_intent end, p_invoice, p_amount);
  end if;
  if exists (select 1 from public.payments where stripe_invoice_id = p_invoice) then
    return 'already';
  end if;

  v_intent := case when p_intent is not null
                     and not exists (select 1 from public.payments where stripe_payment_intent_id = p_intent)
                   then p_intent end;
  -- montant obligatoire (absent = 0) ; devise absente = chf
  v_err := public.amount_mismatch(v_m.amount, round(coalesce(p_amount, 0) * 100)::bigint, coalesce(p_currency, 'chf'));
  if coalesce(p_amount, 0) > 0 and p_intent is null then
    raise exception 'renew_membership: payment intent unknown'
      using errcode = '55000', hint = 'missing_intent';
  end if;

  if v_m.status = 'ended' then
    if coalesce(p_amount, 0) > 0 then
      insert into public.payments (kind, payer_profile_id, beneficiary_profile_id, membership_id, amount,
                                   method, stripe_invoice_id, stripe_payment_intent_id, status, error, description,
                                   paid_at)
      values ('membership', v_m.paid_by, v_m.profile_id, v_m.id, p_amount, 'card', p_invoice, v_intent,
              'refund_pending', 'membership_ended',
              format('Adhésion %s mois (abonnement), renouvellement', v_m.months), now());
    end if;
    update public.memberships set stripe_cancel_pending = true, auto_renew = false where id = v_m.id;
    return 'ended_refund';
  end if;

  if v_err is not null then
    if coalesce(p_amount, 0) > 0 then
      insert into public.payments (kind, payer_profile_id, beneficiary_profile_id, membership_id, amount,
                                   method, stripe_invoice_id, stripe_payment_intent_id, status, error, description,
                                   paid_at)
      values ('membership', v_m.paid_by, v_m.profile_id, v_m.id, p_amount, 'card', p_invoice, v_intent,
              'refund_pending', v_err, format('Adhésion %s mois (abonnement), renouvellement', v_m.months), now());
      -- Stripe ne doit plus facturer ce montant : annulation immédiate
      update public.memberships set stripe_cancel_pending = true, auto_renew = false where id = v_m.id;
    end if;
    return 'amount_mismatch';
  end if;

  insert into public.payments (kind, payer_profile_id, beneficiary_profile_id, membership_id, amount,
                               method, stripe_invoice_id, stripe_payment_intent_id, status, description, paid_at)
  values ('membership', v_m.paid_by, v_m.profile_id, v_m.id, p_amount, 'card', p_invoice, v_intent, 'succeeded',
          format('Adhésion %s mois (abonnement), renouvellement jusqu''au %s',
                 v_m.months, to_char(p_period_end, 'DD.MM.YYYY')),
          now());
  update public.memberships
     set ends_on = greatest(coalesce(ends_on, p_period_end), p_period_end),
         starts_on = coalesce(starts_on, (now() at time zone 'Europe/Zurich')::date)
   where id = v_m.id;
  return 'renewed';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. apply_stripe_event (0012) : + mark_refund_failed
-- ---------------------------------------------------------------------------
create or replace function public.apply_stripe_event(p_id text, p_type text, p_fn text, p_args jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
  a jsonb := coalesce(p_args, '{}');
begin
  if p_id is null or p_id = '' or p_type is null or p_type = '' then
    raise exception 'apply_stripe_event: p_id and p_type are required'
      using errcode = '22023', hint = 'invalid_field';
  end if;
  if p_fn is null or p_fn not in ('confirm_payment', 'activate_membership', 'settle_payment_intent', 'fail_payment',
                                  'renew_membership', 'set_membership_cancel', 'end_membership',
                                  'mark_refunded_by_intent', 'mark_refund_failed') then
    raise exception 'apply_stripe_event: unknown action %', p_fn
      using errcode = '22023', hint = 'invalid_field';
  end if;

  insert into public.stripe_events (id, type) values (p_id, p_type) on conflict (id) do nothing;
  if not found then
    return 'duplicate';
  end if;

  case p_fn
    when 'confirm_payment' then
      return public.confirm_payment(a->>'p_intent', a->>'p_method', (a->>'p_amount_cents')::bigint, a->>'p_currency',
                                    (a->>'p_payment')::uuid);
    when 'activate_membership' then
      return public.activate_membership(a->>'p_payment_intent', a->>'p_subscription', (a->>'p_period_end')::date,
                                        (a->>'p_membership')::uuid, a->>'p_method',
                                        (a->>'p_amount_cents')::bigint, a->>'p_currency');
    when 'settle_payment_intent' then
      return public.settle_payment_intent(a->>'p_intent', a->>'p_method', (a->>'p_amount_cents')::bigint,
                                          a->>'p_currency');
    when 'fail_payment' then
      perform public.fail_payment(a->>'p_intent');
    when 'renew_membership' then
      return public.renew_membership(a->>'p_subscription', a->>'p_invoice', (a->>'p_amount')::numeric,
                                     (a->>'p_period_end')::date, a->>'p_currency', a->>'p_intent');
    when 'set_membership_cancel' then
      perform public.set_membership_cancel(a->>'p_subscription', (a->>'p_cancel_at_period_end')::bool,
                                           (a->>'p_event_at')::timestamptz);
    when 'end_membership' then
      perform public.end_membership(a->>'p_subscription');
    when 'mark_refunded_by_intent' then
      return public.mark_refunded_by_intent(a->>'p_intent', a->>'p_invoice');
    when 'mark_refund_failed' then
      return public.mark_refund_failed(a->>'p_intent', (a->>'p_payment')::uuid, a->>'p_reason');
  end case;
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. invoke_process_refunds (0012) : tentatives dues, orphelins
-- ---------------------------------------------------------------------------
create or replace function public.invoke_process_refunds() returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_key text;
begin
  perform public.fail_unrefundable_payments();
  if not exists (select 1 from public.payments
                  where status = 'refund_pending' and stripe_payment_intent_id is not null
                    and (refund_next_attempt_at is null or refund_next_attempt_at <= now()))
     and not exists (select 1 from public.memberships where stripe_cancel_pending and stripe_subscription_id is not null)
     and not exists (select 1 from public.orphans_to_process(1)) then
    return null;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'functions_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if coalesce(v_url, '') = '' or coalesce(v_key, '') = '' then
    return null;
  end if;
  return net.http_post(
    url     := rtrim(v_url, '/') || '/process-refunds',
    body    := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    timeout_milliseconds := 60000
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. process_course_schedule (0011) : + adhésions pending abandonnées
-- ---------------------------------------------------------------------------
create or replace function public.process_course_schedule() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Europe/Zurich')::date;
begin
  with vacant as (
    update public.courses
       set vacancy_notified_at = now()
     where status = 'prevu'
       and prof_id is null
       and vacancy_notified_at is null
       and starts_at > now()
       and starts_at <= now() + interval '24 hours'
    returning id, is_private
  )
  insert into public.notification_outbox (profile_id, kind, course_id)
  select p.id, 'slot_vacant', v.id
    from vacant v
   cross join public.profiles p
   where p.auth_user_id is not null
     and (p.role = 'admin' or (p.role = 'prof' and p.prof_status = 'valide' and not v.is_private))
     and public.is_account_active(p);

  update public.courses
     set status = 'open_mat'
   where status = 'prevu'
     and prof_id is null
     and starts_at <= now();

  with expired as (
    update public.bookings
       set cancelled_at = now()
     where cancelled_at is null
       and payment_status = 'pending'
       and pending_until <= now()
    returning course_id, profile_id
  )
  delete from public.attendance a
   using expired e
   where a.course_id = e.course_id and a.profile_id = e.profile_id;

  -- adhésion jamais payée (paiement abandonné) depuis plus de 24 h : ended,
  -- paiement pending → failed. Un paiement qui aboutirait encore est
  -- remboursé (activate_membership → late_refund).
  with abandoned as (
    update public.memberships
       set status = 'ended', auto_renew = false
     where status = 'pending'
       and created_at < now() - interval '24 hours'
    returning id
  )
  update public.payments p
     set status = 'failed', error = coalesce(p.error, 'expired')
    from abandoned a
   where p.membership_id = a.id and p.status = 'pending';

  -- rappel d'échéance : adhésion one_time active finissant d'ici 7 jours, sans
  -- adhésion (ni « payé pour l'année ») le lendemain. L'UPDATE ... RETURNING
  -- ne renvoie une ligne qu'une fois : idempotent, y compris en concurrence.
  with expiring as (
    update public.memberships m
       set expiry_notified_at = now()
     where m.source = 'one_time'
       and m.status = 'active'
       and m.ends_on between v_today and v_today + 7
       and m.expiry_notified_at is null
       and not public.is_member(m.profile_id, m.ends_on + 1)
    returning m.profile_id, m.ends_on
  )
  insert into public.notification_outbox (profile_id, kind, payload)
  select case when p.auth_user_id is null then p.parent_profile_id else p.id end,
         'membership_expiring',
         case when p.auth_user_id is null
              then jsonb_build_object('child_profile_id', p.id, 'ends_on', e.ends_on)
              else jsonb_build_object('ends_on', e.ends_on)
         end
    from expiring e
    join public.profiles p on p.id = e.profile_id
   where p.auth_user_id is not null or p.parent_profile_id is not null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Suppression d'un profil avec un abonnement Stripe actif
-- ---------------------------------------------------------------------------
-- Abonnement « vivant » : Stripe peut encore facturer (pending / active avec
-- un abonnement, ou annulation immédiate en attente).
create function public.has_live_subscription(p_profile uuid) returns bool
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
     where m.profile_id = p_profile
       and m.stripe_subscription_id is not null
       and (m.stripe_cancel_pending or m.status in ('pending', 'active'))
  );
$$;

-- Seules les suppressions faites par l'API au nom d'un utilisateur (jeton
-- authenticated) sont bloquées : la suppression du compte (delete-account,
-- qui annule d'abord les abonnements chez Stripe, puis cascade depuis
-- auth.users) et le service_role passent.
create function public.block_live_subscription_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') in ('authenticated', 'anon')
     and public.has_live_subscription(old.id) then
    raise exception 'profile has a live Stripe subscription: cancel it first'
      using errcode = '42501', hint = 'live_subscription';
  end if;
  return old;
end;
$$;

create trigger profiles_block_live_subscription
  before delete on public.profiles
  for each row execute function public.block_live_subscription_delete();

-- ---------------------------------------------------------------------------
-- 9. Droits d'exécution : jamais anon ; service_role seul
-- ---------------------------------------------------------------------------
revoke all on function public.refund_backoff(int) from public, anon, authenticated;
revoke all on function public.fail_unrefundable_payments() from public, anon, authenticated;
revoke all on function public.refunds_to_process(int) from public, anon, authenticated;
revoke all on function public.refund_attempt_failed(uuid, text) from public, anon, authenticated;
revoke all on function public.mark_refund_failed(text, uuid, text) from public, anon, authenticated;
revoke all on function public.record_orphan(text, text, text, text, numeric) from public, anon, authenticated;
revoke all on function public.orphans_to_process(int) from public, anon, authenticated;
revoke all on function public.mark_orphan_done(uuid, text) from public, anon, authenticated;
revoke all on function public.orphan_attempt_failed(uuid, text) from public, anon, authenticated;
revoke all on function public.activate_membership(text, text, date, uuid, text, bigint, text)
  from public, anon, authenticated;
revoke all on function public.renew_membership(text, text, numeric, date, text, text) from public, anon, authenticated;
revoke all on function public.apply_stripe_event(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.invoke_process_refunds() from public, anon, authenticated;
revoke all on function public.process_course_schedule() from public, anon, authenticated;
revoke all on function public.has_live_subscription(uuid) from public, anon, authenticated;
revoke all on function public.block_live_subscription_delete() from public, anon, authenticated;

grant execute on function public.refunds_to_process(int) to service_role;
grant execute on function public.refund_attempt_failed(uuid, text) to service_role;
grant execute on function public.mark_refund_failed(text, uuid, text) to service_role;
grant execute on function public.orphans_to_process(int) to service_role;
grant execute on function public.mark_orphan_done(uuid, text) to service_role;
grant execute on function public.orphan_attempt_failed(uuid, text) to service_role;
grant execute on function public.activate_membership(text, text, date, uuid, text, bigint, text) to service_role;
grant execute on function public.renew_membership(text, text, numeric, date, text, text) to service_role;
grant execute on function public.apply_stripe_event(text, text, text, jsonb) to service_role;
grant execute on function public.invoke_process_refunds() to service_role;
grant execute on function public.process_course_schedule() to service_role;
