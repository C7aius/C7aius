-- =============================================================================
-- 0012_payment_followups : suites du paiement (Plan 3, tâche 4)
--
--  * Montant différent (confirm_payment / activate_membership →
--    'amount_mismatch') : l'argent reçu est rendu. Le paiement passe en
--    refund_pending (et non plus failed) avec sa note d'erreur ; process-refunds
--    le rembourse automatiquement. Rien n'est confirmé ni activé ; un rejeu
--    renvoie 'already'.
--  * Première facture d'abonnement au mauvais montant : l'abonnement est en
--    plus noté à annuler immédiatement chez Stripe (memberships.
--    stripe_cancel_pending, stripe_subscription_id renseigné) ;
--    process-refunds l'annule (subscriptions_to_cancel → DELETE
--    /v1/subscriptions/<id> → mark_subscription_cancelled : ended).
--  * confirm_payment(…, p_payment) : intent inconnu (Stripe Checkout, l'intent
--    n'existe qu'au paiement) → paiement retrouvé par metadata.payment_id ;
--    encore en attente (sans intent, ou avec un intent non payé) → l'intent
--    reçu y est rattaché et la réservation confirmée ; déjà réglé par un autre
--    intent (payé deux fois, ex. app puis web) → un paiement refund_pending
--    est créé pour ce second intent → 'duplicate_refund' (remboursé
--    automatiquement).
--    apply_stripe_event transmet p_payment.
--  * pg_cron : process-refunds toutes les 5 minutes via pg_net
--    (invoke_process_refunds, mêmes secrets Vault que send-push), seulement
--    s'il y a quelque chose à faire.
--
-- HINTs stables : invalid_field.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Abonnement à annuler chez Stripe
-- ---------------------------------------------------------------------------
alter table public.memberships add column stripe_cancel_pending bool not null default false;

create index memberships_stripe_cancel_pending_idx on public.memberships (created_at)
  where stripe_cancel_pending;

-- ---------------------------------------------------------------------------
-- 2. confirm_payment : montant différent → refund_pending ; p_payment
-- ---------------------------------------------------------------------------
--  'already'          : déjà traité (succeeded / refund_pending / refunded)
--  'confirmed'        : réservation payée
--  'late_refund'      : réservation qui ne peut plus être honorée → refund_pending
--  'amount_mismatch'  : montant ou devise différents → refund_pending (error),
--                       réservation inchangée (elle expire)
--  'duplicate_refund' : second intent payé pour un paiement qui a déjà le sien
--                       → nouveau paiement refund_pending
-- Intent inconnu et p_payment inconnu (ou absent) → P0002.
drop function public.confirm_payment(text, text, bigint, text);

create function public.confirm_payment(
  p_intent text, p_method text, p_amount_cents bigint default null, p_currency text default null,
  p_payment uuid default null
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_p public.payments;
  v_b public.bookings;
  v_c public.courses;
  v_booking uuid;
  v_pid uuid;
  v_late bool := false;
  v_err text;
begin
  select id, booking_id into v_pid, v_booking from public.payments where stripe_payment_intent_id = p_intent;
  if v_pid is null and p_payment is not null then
    select id, booking_id into v_pid, v_booking from public.payments where id = p_payment and kind = 'course';
  end if;
  if v_pid is null then
    raise exception 'confirm_payment: payment not found' using errcode = 'P0002';
  end if;

  -- ordre des verrous : cours → réservation → paiement
  if v_booking is not null then
    select c.* into v_c from public.courses c
      join public.bookings b on b.course_id = c.id
     where b.id = v_booking
       for share of c;
    select * into v_b from public.bookings where id = v_booking for update;
  end if;
  select * into v_p from public.payments where id = v_pid for update;

  if v_p.kind <> 'course' then
    raise exception 'confirm_payment: not a course payment'
      using errcode = '22023', hint = 'invalid_field';
  end if;

  if v_p.stripe_payment_intent_id is distinct from p_intent then
    if v_p.stripe_payment_intent_id is null or v_p.status in ('pending', 'failed') then
      -- intent Checkout (ou autre intent payé en premier) : rattaché au
      -- paiement verrouillé. L'intent remplacé, s'il aboutit plus tard, est
      -- retrouvé par sa metadata.payment_id et remboursé (ci-dessous).
      update public.payments set stripe_payment_intent_id = p_intent where id = v_p.id
      returning * into v_p;
    else
      -- second intent payé pour le même paiement : rendu tel quel
      if exists (select 1 from public.payments where stripe_payment_intent_id = p_intent) then
        return 'already';
      end if;
      insert into public.payments (kind, payer_profile_id, beneficiary_profile_id, booking_id, amount, currency,
                                   method, stripe_payment_intent_id, status, description, error, paid_at)
      values ('course', v_p.payer_profile_id, v_p.beneficiary_profile_id, v_p.booking_id,
              coalesce(round(p_amount_cents / 100.0, 2), v_p.amount), coalesce(lower(p_currency), v_p.currency),
              p_method, p_intent, 'refund_pending', v_p.description, 'duplicate_intent', now());
      return 'duplicate_refund';
    end if;
  end if;

  if v_p.status in ('succeeded', 'refund_pending', 'refunded') then
    return 'already';
  end if;
  v_err := public.amount_mismatch(v_p.amount, p_amount_cents, p_currency);
  if v_err is not null then
    update public.payments
       set status = 'refund_pending', error = v_err, method = p_method, paid_at = now()
     where id = v_p.id;
    return 'amount_mismatch';
  end if;

  if v_b.id is null or v_b.payment_status <> 'pending' then
    -- supprimée, désinscrite pendant l'attente, ou déjà payée autrement
    v_late := true;
  elsif v_c.status = 'annule'
        or ((v_b.cancelled_at is not null or v_b.pending_until <= now()) and v_c.starts_at <= now()) then
    -- cours annulé, ou réservation expirée d'un cours commencé
    update public.bookings
       set payment_status = 'refund_pending', cancelled_at = coalesce(cancelled_at, now())
     where id = v_b.id;
    v_late := true;
  elsif v_b.cancelled_at is null and v_b.pending_until > now() then
    -- en attente valide (même si le cours vient de commencer)
    update public.bookings set payment_status = 'paid' where id = v_b.id;
  else
    -- expirée, cours à venir : réactivée. Une autre réservation en attente
    -- (réservée de nouveau) est libérée ; une autre déjà active → remboursement.
    perform 1 from public.bookings
     where course_id = v_b.course_id and profile_id = v_b.profile_id and id <> v_b.id
       and cancelled_at is null
     for update;
    update public.bookings set cancelled_at = now()
     where course_id = v_b.course_id and profile_id = v_b.profile_id and id <> v_b.id
       and cancelled_at is null and payment_status = 'pending';
    if exists (select 1 from public.bookings
                where course_id = v_b.course_id and profile_id = v_b.profile_id and id <> v_b.id
                  and cancelled_at is null) then
      update public.bookings
         set payment_status = 'refund_pending', cancelled_at = coalesce(cancelled_at, now())
       where id = v_b.id;
      v_late := true;
    else
      update public.bookings set payment_status = 'paid', cancelled_at = null where id = v_b.id;
    end if;
  end if;

  update public.payments
     set status = case when v_late then 'refund_pending' else 'succeeded' end::public.payment_state,
         method = p_method,
         paid_at = now(),
         error = null
   where id = v_p.id;
  return case when v_late then 'late_refund' else 'confirmed' end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. activate_membership (0011) : montant différent → refund_pending ;
-- première facture d'abonnement → abonnement à annuler chez Stripe.
-- ---------------------------------------------------------------------------
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
  v_err := public.amount_mismatch(coalesce(v_p.amount, v_m.amount), p_amount_cents, p_currency);
  if v_err is not null then
    if v_p.id is not null then
      -- argent reçu rendu (process-refunds, par l'intent)
      update public.payments
         set status = 'refund_pending', error = v_err, paid_at = now(),
             method = coalesce(p_method, method),
             stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent)
       where id = v_p.id;
    end if;
    if v_m.source = 'stripe_subscription' and p_subscription is not null then
      -- Stripe ne doit plus facturer : annulation immédiate par process-refunds
      update public.memberships
         set stripe_subscription_id = coalesce(stripe_subscription_id, p_subscription),
             stripe_cancel_pending = true,
             auto_renew = false
       where id = v_m.id;
    end if;
    return 'amount_mismatch';
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
-- 4. Abonnements à annuler immédiatement (process-refunds)
-- ---------------------------------------------------------------------------
create function public.subscriptions_to_cancel(p_limit int)
returns table (membership_id uuid, stripe_subscription_id text)
language sql stable security definer set search_path = '' as $$
  select m.id, m.stripe_subscription_id from public.memberships m
   where m.stripe_cancel_pending and m.stripe_subscription_id is not null
   order by m.created_at, m.id
   limit greatest(coalesce(p_limit, 20), 0);
$$;

-- Annulé chez Stripe : plus rien à faire ; adhésion jamais activée → ended.
-- Adhésion inconnue : sans effet.
create function public.mark_subscription_cancelled(p_membership uuid) returns void
language sql security definer set search_path = '' as $$
  update public.memberships
     set stripe_cancel_pending = false,
         auto_renew = false,
         status = case when status = 'pending' then 'ended'::public.membership_status else status end
   where id = p_membership;
$$;

-- ---------------------------------------------------------------------------
-- 5. apply_stripe_event (0011) : + p_payment pour confirm_payment
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
                                  'mark_refunded_by_intent') then
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
  end case;
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. process-refunds planifié (pg_cron + pg_net, comme send-push)
-- ---------------------------------------------------------------------------
-- invoke_process_refunds() : s'il y a un remboursement ou une annulation
-- d'abonnement à faire et que les secrets Vault functions_url et
-- service_role_key existent, appelle POST <functions_url>/process-refunds.
-- Retourne l'id de requête pg_net, ou null. Ne lève jamais faute de secrets.
create function public.invoke_process_refunds() returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_key text;
begin
  if not exists (select 1 from public.payments where status = 'refund_pending' and stripe_payment_intent_id is not null)
     and not exists (select 1 from public.memberships where stripe_cancel_pending and stripe_subscription_id is not null) then
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

select cron.schedule('process-refunds', '*/5 * * * *', 'select public.invoke_process_refunds()');

-- ---------------------------------------------------------------------------
-- 7. Droits d'exécution : service_role seul
-- ---------------------------------------------------------------------------
revoke all on function public.confirm_payment(text, text, bigint, text, uuid) from public, anon, authenticated;
revoke all on function public.activate_membership(text, text, date, uuid, text, bigint, text)
  from public, anon, authenticated;
revoke all on function public.subscriptions_to_cancel(int) from public, anon, authenticated;
revoke all on function public.mark_subscription_cancelled(uuid) from public, anon, authenticated;
revoke all on function public.apply_stripe_event(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.invoke_process_refunds() from public, anon, authenticated;

grant execute on function public.confirm_payment(text, text, bigint, text, uuid) to service_role;
grant execute on function public.activate_membership(text, text, date, uuid, text, bigint, text) to service_role;
grant execute on function public.subscriptions_to_cancel(int) to service_role;
grant execute on function public.mark_subscription_cancelled(uuid) to service_role;
grant execute on function public.apply_stripe_event(text, text, text, jsonb) to service_role;
grant execute on function public.invoke_process_refunds() to service_role;
