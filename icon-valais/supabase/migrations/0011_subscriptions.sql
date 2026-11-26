-- =============================================================================
-- 0011_subscriptions : abonnements, webhook Stripe et rappel TWINT
-- (Plan 3, tâche 3)
--
--  * stripe_events : identifiants des événements Stripe déjà reçus
--    (idempotence du webhook) ; service_role seul.
--  * Fonctions service_role (Edge Functions), idempotentes, sans auth.uid() :
--    le payeur est vérifié explicitement (start_membership_payment).
--     - start_membership_payment : adhésion pending + paiement pending ;
--       montant = membership_price (jamais fourni par le client).
--     - activate_membership : paiement réussi d'une adhésion. Période empilée
--       après l'adhésion en cours (ou « payé pour l'année ») ; abonnement
--       Stripe : fin = fin de la période facturée. Un abonnement n'est activé
--       que par sa première facture (invoice.paid / subscription_create) : le
--       payment_intent.succeeded de cette facture renvoie awaiting_invoice.
--     - renew_membership : facture de renouvellement (idempotent par facture) ;
--       ends_on ne recule jamais.
--     - set_membership_cancel / end_membership : résiliation à l'échéance
--       (cancelled : adhérent jusqu'à ends_on) / fin de l'abonnement (ended).
--     - settle_payment_intent : payment_intent.succeeded sans metadata →
--       confirm_payment (cours) ou activate_membership (adhésion) ; intent
--       inconnu → unknown, sans erreur (ex. intent d'une facture de
--       renouvellement, traitée par invoice.paid).
--     - mark_refunded_by_intent : remboursement constaté par Stripe
--       (charge.refunded, y compris fait depuis le tableau de bord).
--     - record_customer : client Stripe du profil (jamais remplacé).
--  * notification_outbox : genre membership_expiring ; process_course_schedule
--    écrit un rappel (une fois : memberships.expiry_notified_at) pour chaque
--    adhésion one_time active finissant dans 7 jours, sauf si une autre
--    adhésion prend le relais ; au profil, ou à son parent (profil sans login).
--    payload : ends_on, child_profile_id.
--  * Ordre des verrous : profil bénéficiaire → adhésion → paiement.
--
-- HINTs stables : invalid_field.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Événements Stripe reçus
-- ---------------------------------------------------------------------------
create table public.stripe_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;

revoke all on public.stripe_events from anon, authenticated;
grant select, insert, delete on public.stripe_events to service_role;

-- ---------------------------------------------------------------------------
-- 2. Rappel d'échéance
-- ---------------------------------------------------------------------------
alter table public.memberships add column expiry_notified_at timestamptz null;

alter table public.notification_outbox drop constraint notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check
  check (kind in ('course_cancelled', 'slot_vacant', 'prof_validated', 'membership_expiring'));

-- ---------------------------------------------------------------------------
-- 3. Démarrer le paiement d'une adhésion
-- ---------------------------------------------------------------------------
-- p_payer : le bénéficiaire ou son parent, compte actif (sinon 42501).
-- p_source : stripe_subscription ou one_time (sinon 22023 invalid_field).
create function public.start_membership_payment(
  p_profile uuid, p_payer uuid, p_months int, p_source public.membership_source
) returns table (membership_id uuid, payment_id uuid, amount numeric, description text)
language plpgsql security definer set search_path = '' as $$
declare
  v_payer public.profiles;
  v_amount numeric(8,2);
  v_desc text;
  v_m uuid;
  v_p uuid;
begin
  select * into v_payer from public.profiles where id = p_payer;
  if v_payer.id is null
     or not public.is_account_active(v_payer)
     or not exists (select 1 from public.profiles b
                     where b.id = p_profile
                       and (b.id = v_payer.id or b.parent_profile_id = v_payer.id)) then
    raise exception 'start_membership_payment: payer cannot pay for this profile' using errcode = '42501';
  end if;
  if p_source is null or p_source not in ('stripe_subscription', 'one_time') then
    raise exception 'start_membership_payment: source must be stripe_subscription or one_time'
      using errcode = '22023', hint = 'invalid_field';
  end if;

  -- 22023 invalid_field si la durée est invalide
  select mp.amount into v_amount from public.membership_price(p_profile, p_months) mp;
  v_desc := format('Adhésion %s mois', p_months)
            || case when p_source = 'stripe_subscription' then ' (abonnement)' else '' end;

  insert into public.memberships (profile_id, paid_by, source, months, status, amount)
  values (p_profile, v_payer.id, p_source, p_months, 'pending', v_amount)
  returning id into v_m;
  insert into public.payments (kind, payer_profile_id, beneficiary_profile_id, membership_id, amount, description)
  values ('membership', v_payer.id, p_profile, v_m, v_amount, v_desc)
  returning id into v_p;

  membership_id := v_m;
  payment_id := v_p;
  amount := v_amount;
  description := v_desc;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Activer une adhésion payée
-- ---------------------------------------------------------------------------
-- Paiement retrouvé par p_payment_intent ; à défaut (facture sans intent dans
-- l'événement) adhésion retrouvée par p_subscription puis p_membership
-- (metadata.membership_id de l'abonnement).
--  'activated'        : adhésion active ; paiement succeeded
--  'already'          : déjà activée (ou terminée), ou paiement déjà traité
--  'awaiting_invoice' : abonnement Stripe appelé sans p_subscription (intent
--                       de la première facture) : activé par invoice.paid
-- Rien de retrouvé → P0002 ; paiement de cours → 22023 invalid_field.
-- starts_on = max(aujourd'hui, fin de la dernière adhésion comptée ou de
-- paid_until + 1 jour) ; ends_on = p_period_end, sinon starts_on + months - 1
-- jour ; un abonnement dont la période facturée finit avant ce début commence
-- au plus tard à la fin de cette période (période jamais vide).
create function public.activate_membership(
  p_payment_intent text,
  p_subscription text default null,
  p_period_end date default null,
  p_membership uuid default null,
  p_method text default null
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
    raise exception 'activate_membership: membership not found' using errcode = 'P0002';
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

  if v_m.status <> 'pending' or v_p.status in ('succeeded', 'refund_pending', 'refunded') then
    return 'already';
  end if;
  if v_m.source = 'stripe_subscription' and p_subscription is null then
    return 'awaiting_invoice';
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
           stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent)
     where id = v_p.id;
  end if;
  return 'activated';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Renouvellement d'un abonnement (invoice.paid / subscription_cycle)
-- ---------------------------------------------------------------------------
--  'renewed' : paiement succeeded lié à l'adhésion, ends_on = max(ends_on,
--              p_period_end) (une facture rejouée en retard ne recule pas)
--  'already' : facture déjà enregistrée
-- Abonnement inconnu → P0002. Facture à 0 (bon de réduction) : prolongation
-- sans paiement.
create function public.renew_membership(
  p_subscription text, p_invoice text, p_amount numeric, p_period_end date
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_m public.memberships;
begin
  if p_invoice is null or p_invoice = '' or p_period_end is null then
    raise exception 'renew_membership: p_invoice and p_period_end are required'
      using errcode = '22023', hint = 'invalid_field';
  end if;
  select * into v_m from public.memberships where stripe_subscription_id = p_subscription for update;
  if v_m.id is null then
    raise exception 'renew_membership: subscription not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.payments where stripe_invoice_id = p_invoice) then
    return 'already';
  end if;

  if coalesce(p_amount, 0) > 0 then
    insert into public.payments (kind, payer_profile_id, beneficiary_profile_id, membership_id, amount,
                                 method, stripe_invoice_id, status, description, paid_at)
    values ('membership', v_m.paid_by, v_m.profile_id, v_m.id, p_amount, 'card', p_invoice, 'succeeded',
            format('Adhésion %s mois (abonnement), renouvellement jusqu''au %s',
                   v_m.months, to_char(p_period_end, 'DD.MM.YYYY')),
            now());
  end if;
  update public.memberships
     set ends_on = greatest(coalesce(ends_on, p_period_end), p_period_end),
         starts_on = coalesce(starts_on, (now() at time zone 'Europe/Zurich')::date)
   where id = v_m.id;
  return 'renewed';
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Résiliation et fin d'abonnement
-- ---------------------------------------------------------------------------
-- cancel_at_period_end vrai : active → cancelled (adhérent jusqu'à ends_on),
-- plus de renouvellement ; faux : cancelled → active. Adhésion terminée ou
-- abonnement inconnu : sans effet.
create function public.set_membership_cancel(p_subscription text, p_cancel_at_period_end bool) returns void
language sql security definer set search_path = '' as $$
  update public.memberships
     set cancel_at_period_end = p_cancel_at_period_end,
         auto_renew = not p_cancel_at_period_end,
         status = case
           when status in ('active', 'cancelled') then
             case when p_cancel_at_period_end then 'cancelled' else 'active' end::public.membership_status
           else status
         end
   where stripe_subscription_id = p_subscription
     and status <> 'ended';
$$;

-- Abonnement supprimé chez Stripe : ended (n'est plus adhérent), plus de
-- renouvellement. Abonnement inconnu : sans effet.
create function public.end_membership(p_subscription text) returns void
language sql security definer set search_path = '' as $$
  update public.memberships
     set status = 'ended', auto_renew = false
   where stripe_subscription_id = p_subscription
     and status <> 'ended';
$$;

-- ---------------------------------------------------------------------------
-- 7. payment_intent.succeeded sans metadata : routage par l'intent
-- ---------------------------------------------------------------------------
create function public.settle_payment_intent(p_intent text, p_method text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_kind public.payment_kind;
begin
  select kind into v_kind from public.payments where stripe_payment_intent_id = p_intent;
  if v_kind is null then
    return 'unknown';
  elsif v_kind = 'course' then
    return public.confirm_payment(p_intent, p_method);
  else
    return public.activate_membership(p_intent, null, null, null, p_method);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Remboursement constaté par Stripe (charge.refunded, remboursement total)
-- ---------------------------------------------------------------------------
--  'refunded' : paiement refunded ; réservation refunded si elle était payée
--               ou attendait ce remboursement
--  'already'  : déjà refunded ;  'unknown' : intent inconnu
-- L'adhésion éventuelle n'est pas modifiée (décision de l'admin).
create function public.mark_refunded_by_intent(p_intent text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_booking uuid;
  v_p public.payments;
begin
  select booking_id into v_booking from public.payments where stripe_payment_intent_id = p_intent;
  if not found then
    return 'unknown';
  end if;
  -- ordre des verrous : réservation → paiement
  if v_booking is not null then
    perform 1 from public.bookings where id = v_booking for update;
  end if;
  select * into v_p from public.payments where stripe_payment_intent_id = p_intent for update;
  if v_p.status = 'refunded' then
    return 'already';
  end if;
  update public.payments set status = 'refunded', refunded_at = now() where id = v_p.id;
  update public.bookings set payment_status = 'refunded'
   where id = v_p.booking_id and payment_status in ('paid', 'refund_pending');
  return 'refunded';
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Client Stripe du profil : enregistré une fois, jamais remplacé ; renvoie
-- le client à utiliser (celui déjà enregistré le cas échéant).
-- ---------------------------------------------------------------------------
create function public.record_customer(p_profile uuid, p_customer text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_cur text;
begin
  if p_customer is null or p_customer = '' then
    raise exception 'record_customer: p_customer is required'
      using errcode = '22023', hint = 'invalid_field';
  end if;
  select stripe_customer_id into v_cur from public.profiles where id = p_profile for update;
  if not found then
    raise exception 'record_customer: profile not found' using errcode = 'P0002';
  end if;
  if v_cur is not null then
    return v_cur;
  end if;
  update public.profiles set stripe_customer_id = p_customer where id = p_profile;
  return p_customer;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. process_course_schedule (0010) : + rappel d'échéance des adhésions
-- one_time (7 jours avant ends_on, une fois).
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

  -- rappel d'échéance : adhésion one_time active finissant dans 7 jours, sans
  -- adhésion (ni « payé pour l'année ») le lendemain. L'UPDATE ... RETURNING
  -- ne renvoie une ligne qu'une fois : idempotent, y compris en concurrence.
  with expiring as (
    update public.memberships m
       set expiry_notified_at = now()
     where m.source = 'one_time'
       and m.status = 'active'
       and m.ends_on = v_today + 7
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
-- 11. Droits d'exécution : jamais anon ; service_role seul
-- ---------------------------------------------------------------------------
revoke all on function public.start_membership_payment(uuid, uuid, int, public.membership_source)
  from public, anon, authenticated;
revoke all on function public.activate_membership(text, text, date, uuid, text) from public, anon, authenticated;
revoke all on function public.renew_membership(text, text, numeric, date) from public, anon, authenticated;
revoke all on function public.set_membership_cancel(text, bool) from public, anon, authenticated;
revoke all on function public.end_membership(text) from public, anon, authenticated;
revoke all on function public.settle_payment_intent(text, text) from public, anon, authenticated;
revoke all on function public.mark_refunded_by_intent(text) from public, anon, authenticated;
revoke all on function public.record_customer(uuid, text) from public, anon, authenticated;
revoke all on function public.process_course_schedule() from public, anon, authenticated;

grant execute on function public.start_membership_payment(uuid, uuid, int, public.membership_source) to service_role;
grant execute on function public.activate_membership(text, text, date, uuid, text) to service_role;
grant execute on function public.renew_membership(text, text, numeric, date) to service_role;
grant execute on function public.set_membership_cancel(text, bool) to service_role;
grant execute on function public.end_membership(text) to service_role;
grant execute on function public.settle_payment_intent(text, text) to service_role;
grant execute on function public.mark_refunded_by_intent(text) to service_role;
grant execute on function public.record_customer(uuid, text) to service_role;
grant execute on function public.process_course_schedule() to service_role;
