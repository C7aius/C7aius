-- =============================================================================
-- 0010_payments : prix des réservations, essais, paiements et remboursements
-- (Plan 3, tâche 2)
--
--  * bookings : price, free_trial, payment_status, pending_until.
--    Réservation ACTIVE : cancelled_at is null and (payment_status <> 'pending'
--    or pending_until > now()). Appliquée à course_booking_counts,
--    course_participants, cancel_course (notifications), set_attendance,
--    trial_used. Une réservation en attente expirée n'est plus active ; elle
--    garde cancelled_at null jusqu'au passage de process_course_schedule (au
--    plus 5 min). L'index unique bookings_one_active_idx garde son prédicat
--    (cancelled_at is null) : tout chemin qui insère ou réactive une ligne
--    annule d'abord les lignes en attente expirées du même (cours, profil).
--  * Prix (book_course, calcul serveur seul) : adhérent (is_member au jour
--    local du cours) → price_member ; sinon cours gratuit (price_non_member
--    = 0) → 0 sans essai ; sinon trial_used < 10 → 0 et free_trial ; sinon
--    price_non_member. Montant > 0 → pending, 15 min pour payer. Un verrou sur
--    le profil bénéficiaire sérialise ses réservations (compteur d'essais).
--  * Réserver de nouveau : en attente valide → même réservation, délai
--    prolongé ; déjà payée puis désinscrite → la même réservation est
--    réactivée, sans nouveau paiement.
--  * unbook_course : payée → reste paid (pas de remboursement) ; en attente →
--    libérée (payment_status = 'none' : un paiement qui aboutirait ensuite est
--    remboursé, la réservation n'est pas réactivée).
--  * cancel_course : réservations paid encore actives des cours annulés →
--    refund_pending, et leurs paiements succeeded → refund_pending (payée puis
--    désinscrite : pas de remboursement).
--  * set_attendance(present) sur une réservation en attente : présent gratuit
--    (price 0, none) ; attach_payment_intent ne remplace jamais un intent lié.
--  * payments : lecture payeur, bénéficiaire, parent du bénéficiaire, admin ;
--    aucune écriture client.
--  * Fonctions service_role (Edge Functions), idempotentes ; sans auth.uid() :
--    start_course_payment vérifie le payeur explicitement.
--  * Ordre des verrous : cours → réservation → paiement (cancel_course,
--    confirm_payment, mark_refunded) : pas d'interblocage.
--
-- HINTs stables : course_closed (existant), not_pending.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. bookings : colonnes de paiement
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column price numeric(8,2) not null default 0 check (price >= 0),
  add column free_trial bool not null default false,
  add column payment_status text not null default 'none'
    check (payment_status in ('none', 'pending', 'paid', 'refund_pending', 'refunded')),
  add column pending_until timestamptz null,
  add constraint bookings_pending_has_deadline
    check (payment_status <> 'pending' or pending_until is not null);

create index bookings_pending_until_idx on public.bookings (pending_until)
  where payment_status = 'pending' and cancelled_at is null;

-- ---------------------------------------------------------------------------
-- 2. payments
-- ---------------------------------------------------------------------------
create type public.payment_kind as enum ('course', 'membership');
create type public.payment_state as enum ('pending', 'succeeded', 'failed', 'refund_pending', 'refunded');

create table public.payments (
  id                       uuid primary key default gen_random_uuid(),
  receipt_no               bigint generated always as identity unique,
  kind                     public.payment_kind not null,
  payer_profile_id         uuid null references public.profiles (id) on delete set null,
  beneficiary_profile_id   uuid null references public.profiles (id) on delete set null,
  booking_id               uuid null references public.bookings (id) on delete set null,
  membership_id            uuid null references public.memberships (id) on delete set null,
  amount                   numeric(8,2) not null check (amount > 0),
  currency                 text not null default 'chf',
  method                   text null,
  stripe_payment_intent_id text unique null,
  stripe_invoice_id        text unique null,
  status                   public.payment_state not null default 'pending',
  description              text not null,
  created_at               timestamptz not null default now(),
  paid_at                  timestamptz null,
  refunded_at              timestamptz null
);

create index payments_payer_profile_id_idx on public.payments (payer_profile_id);
create index payments_beneficiary_profile_id_idx on public.payments (beneficiary_profile_id);
create index payments_booking_id_idx on public.payments (booking_id);
create index payments_membership_id_idx on public.payments (membership_id);
create index payments_refund_pending_idx on public.payments (created_at) where status = 'refund_pending';

alter table public.payments enable row level security;

create policy payments_select on public.payments
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.current_account_active()
      and (
        payer_profile_id = public.current_profile_id()
        or beneficiary_profile_id = public.current_profile_id()
        or exists (
          select 1 from public.profiles c
           where c.id = payments.beneficiary_profile_id
             and c.parent_profile_id = public.current_profile_id()
        )
      )
    )
  );

-- Pas de policy INSERT / UPDATE / DELETE.
revoke all on public.payments from anon, authenticated;
grant select on public.payments to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Vues et lectures : définition « active »
-- ---------------------------------------------------------------------------
create or replace view public.course_booking_counts as
  select
    c.id as course_id,
    (select count(*) from public.bookings b
      where b.course_id = c.id and b.cancelled_at is null
        and (b.payment_status <> 'pending' or b.pending_until > now()))::int as booked
  from public.courses c
  where public.current_account_active();

revoke all on public.course_booking_counts from anon, authenticated;
grant select on public.course_booking_counts to authenticated;

create or replace function public.course_participants(p_course uuid)
returns table (profile_id uuid, first_name text, last_name text, age int, bjj_belt public.belt, present bool)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_admin() or public.is_active_prof()) then
    raise exception 'course_participants: assigned prof or admin required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.courses where id = p_course) then
    raise exception 'course_participants: course not found' using errcode = 'P0002';
  end if;
  if not public.is_course_staff(p_course) then
    raise exception 'course_participants: assigned prof or admin required' using errcode = '42501';
  end if;

  return query
    select p.id, p.first_name, p.last_name, p.age, p.bjj_belt, a.present
      from public.bookings b
      join public.profiles p on p.id = b.profile_id
      left join public.attendance a on a.course_id = b.course_id and a.profile_id = b.profile_id
     where b.course_id = p_course and b.cancelled_at is null
       and (b.payment_status <> 'pending' or b.pending_until > now())
     order by p.last_name, p.first_name, p.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Essais
-- ---------------------------------------------------------------------------
-- Essais consommés : réservations free_trial actives dont le cours n'est pas
-- annulé. Interne (RPC SECURITY DEFINER, service_role).
create function public.trial_used(p_profile uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int
    from public.bookings b
    join public.courses c on c.id = b.course_id
   where b.profile_id = p_profile
     and b.free_trial
     and b.cancelled_at is null
     and (b.payment_status <> 'pending' or b.pending_until > now())
     and c.status <> 'annule';
$$;

-- Essais de soi (p_profile null) ou de son enfant.
create function public.my_trial_status(p_profile uuid default null)
returns table (used int, trial_limit int)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_profile uuid := coalesce(p_profile, public.current_profile_id());
begin
  if not public.can_pay_for(v_profile) then
    raise exception 'my_trial_status: own profile or own child required' using errcode = '42501';
  end if;
  used := public.trial_used(v_profile);
  trial_limit := 10;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. book_course : prix, essais, attente de paiement
-- ---------------------------------------------------------------------------
drop function public.book_course(uuid, uuid);

create function public.book_course(p_course uuid, p_profile uuid default null)
returns table (booking_id uuid, amount numeric, needs_payment bool)
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.current_profile_id();
  v_profile uuid;
  v_c public.courses;
  v_b public.bookings;
  v_price numeric(8,2);
  v_trial bool := false;
begin
  if v_me is null or not public.current_account_active() then
    raise exception 'book_course: active account required' using errcode = '42501';
  end if;
  v_profile := coalesce(p_profile, v_me);
  if not public.is_self_or_child(v_profile) then
    raise exception 'book_course: only for yourself or your children' using errcode = '42501';
  end if;

  select * into v_c from public.courses where id = p_course for share;
  if v_c.id is null then
    raise exception 'book_course: course not found' using errcode = 'P0002';
  end if;
  if v_c.status = 'annule' or v_c.starts_at <= now() then
    raise exception 'book_course: course is cancelled or has started'
      using errcode = '22023', hint = 'course_closed';
  end if;

  -- sérialise les réservations du bénéficiaire (compteur d'essais)
  perform 1 from public.profiles where id = v_profile for no key update;

  -- réservation active : la même (en attente valide → délai prolongé)
  select * into v_b from public.bookings b
   where b.course_id = p_course and b.profile_id = v_profile and b.cancelled_at is null
     and (b.payment_status <> 'pending' or b.pending_until > now())
   for update;
  if v_b.id is not null then
    if v_b.payment_status = 'pending' then
      update public.bookings set pending_until = now() + interval '15 minutes' where id = v_b.id;
    end if;
    booking_id := v_b.id;
    amount := v_b.price;
    needs_payment := v_b.payment_status = 'pending';
    return next;
    return;
  end if;

  -- en attente expirée (pas encore libérée) : annulée, libère l'index unique
  update public.bookings b set cancelled_at = now()
   where b.course_id = p_course and b.profile_id = v_profile and b.cancelled_at is null
     and b.payment_status = 'pending';

  -- déjà payée puis désinscrite : réactivée, sans nouveau paiement
  select * into v_b from public.bookings b
   where b.course_id = p_course and b.profile_id = v_profile and b.payment_status = 'paid'
   order by b.created_at desc
   limit 1
   for update;
  if v_b.id is not null then
    update public.bookings set cancelled_at = null where id = v_b.id;
    booking_id := v_b.id;
    amount := v_b.price;
    needs_payment := false;
    return next;
    return;
  end if;

  -- adhésion évaluée au jour (local) du cours ; un cours gratuit pour les
  -- non-adhérents ne consomme pas d'essai
  if public.is_member(v_profile, (v_c.starts_at at time zone 'Europe/Zurich')::date) then
    v_price := v_c.price_member;
  elsif v_c.price_non_member = 0 then
    v_price := 0;
  elsif public.trial_used(v_profile) < 10 then
    v_price := 0;
    v_trial := true;
  else
    v_price := v_c.price_non_member;
  end if;

  insert into public.bookings (course_id, profile_id, booked_by, price, free_trial, payment_status, pending_until)
  values (p_course, v_profile, v_me, v_price, v_trial,
          case when v_price > 0 then 'pending' else 'none' end,
          case when v_price > 0 then now() + interval '15 minutes' end)
  on conflict (course_id, profile_id) where cancelled_at is null do nothing
  returning * into v_b;

  if v_b.id is null then
    select * into v_b from public.bookings b
     where b.course_id = p_course and b.profile_id = v_profile and b.cancelled_at is null;
  end if;
  booking_id := v_b.id;
  amount := v_b.price;
  needs_payment := v_b.payment_status = 'pending';
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. unbook_course : payée → reste paid ; en attente → libérée
-- ---------------------------------------------------------------------------
create or replace function public.unbook_course(p_course uuid, p_profile uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.current_profile_id();
  v_profile uuid;
  v_c public.courses;
begin
  if v_me is null or not public.current_account_active() then
    raise exception 'unbook_course: active account required' using errcode = '42501';
  end if;
  v_profile := coalesce(p_profile, v_me);
  if not public.is_self_or_child(v_profile) then
    raise exception 'unbook_course: only for yourself or your children' using errcode = '42501';
  end if;

  select * into v_c from public.courses where id = p_course for update;
  if v_c.id is null then
    raise exception 'unbook_course: course not found' using errcode = 'P0002';
  end if;
  if v_c.starts_at <= now() then
    raise exception 'unbook_course: course has started'
      using errcode = '22023', hint = 'course_closed';
  end if;

  update public.bookings
     set cancelled_at = now(),
         payment_status = case when payment_status = 'pending' then 'none' else payment_status end,
         pending_until = case when payment_status = 'pending' then null else pending_until end
   where course_id = p_course and profile_id = v_profile and cancelled_at is null;
  delete from public.attendance where course_id = p_course and profile_id = v_profile;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. set_attendance (0007) : « inscrit » = réservation active ; une ligne en
-- attente expirée est annulée avant la création d'un présent non inscrit.
-- ---------------------------------------------------------------------------
create or replace function public.set_attendance(p_course uuid, p_profile uuid, p_present bool) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.current_profile_id();
  v_c public.courses;
begin
  if not (public.is_admin() or public.is_active_prof()) then
    raise exception 'set_attendance: assigned prof or admin required' using errcode = '42501';
  end if;
  if p_present is null then
    raise exception 'set_attendance: p_present is required'
      using errcode = '22023', hint = 'missing_field';
  end if;

  select * into v_c from public.courses where id = p_course for update;
  if v_c.id is null then
    raise exception 'set_attendance: course not found' using errcode = 'P0002';
  end if;
  if not public.is_course_staff(p_course) then
    raise exception 'set_attendance: assigned prof or admin required' using errcode = '42501';
  end if;
  if v_c.status = 'annule' then
    raise exception 'set_attendance: course is cancelled'
      using errcode = '22023', hint = 'course_cancelled';
  end if;
  if now() < v_c.starts_at - interval '30 minutes' then
    raise exception 'set_attendance: too early'
      using errcode = '22023', hint = 'too_early';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile) then
    raise exception 'set_attendance: profile not found' using errcode = 'P0002';
  end if;

  -- présent avec une réservation en attente de paiement : devient un présent
  -- gratuit (le planificateur ne pourra plus la libérer ni effacer l'appel ;
  -- un paiement qui aboutirait ensuite est remboursé)
  if p_present then
    update public.bookings
       set price = 0, payment_status = 'none', pending_until = null
     where course_id = p_course and profile_id = p_profile and cancelled_at is null
       and payment_status = 'pending' and pending_until > now();
  end if;

  if not exists (select 1 from public.bookings
                  where course_id = p_course and profile_id = p_profile and cancelled_at is null
                    and (payment_status <> 'pending' or pending_until > now())) then
    if not p_present then
      raise exception 'set_attendance: not booked'
        using errcode = '22023', hint = 'not_booked';
    end if;
    if not exists (select 1 from public.profiles p
                    where p.id = p_profile and public.is_account_active(p)) then
      raise exception 'set_attendance: inactive profile cannot be added'
        using errcode = '22023', hint = 'inactive_profile';
    end if;
    -- en attente expirée (pas encore libérée) : annulée, libère l'index unique
    update public.bookings set cancelled_at = now()
     where course_id = p_course and profile_id = p_profile and cancelled_at is null
       and payment_status = 'pending';
    insert into public.bookings (course_id, profile_id, booked_by)
    values (p_course, p_profile, v_me)
    on conflict (course_id, profile_id) where cancelled_at is null do nothing;
  end if;

  insert into public.attendance (course_id, profile_id, present, marked_by, marked_at)
  values (p_course, p_profile, p_present, v_me, now())
  on conflict (course_id, profile_id) do update
    set present = excluded.present, marked_by = excluded.marked_by, marked_at = excluded.marked_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. cancel_course (0008) : notifications aux réservations actives ;
-- réservations payées → remboursement.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_course(p_course uuid, p_scope text) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_admin bool := public.is_admin();
  v_me uuid := public.current_profile_id();
  v_c public.courses;
  v_ids uuid[];
  v_refund uuid[];
begin
  if not (v_admin or public.is_active_prof()) then
    raise exception 'cancel_course: active prof or admin required' using errcode = '42501';
  end if;

  if p_scope is null or p_scope not in ('one', 'following') then
    raise exception 'cancel_course: p_scope must be one or following'
      using errcode = '22023', hint = 'invalid_field';
  end if;

  select * into v_c from public.courses where id = p_course for update;
  if v_c.id is null then
    raise exception 'cancel_course: course not found' using errcode = 'P0002';
  end if;
  -- created_by null (créateur supprimé) : admin seulement
  if not v_admin and (v_c.created_by is distinct from v_me or v_c.is_private) then
    raise exception 'cancel_course: only the creator of a non-private course or an admin'
      using errcode = '42501';
  end if;
  if v_c.status = 'annule' then
    raise exception 'cancel_course: course is already cancelled'
      using errcode = '22023', hint = 'course_cancelled';
  end if;
  if v_c.starts_at <= now() then
    raise exception 'cancel_course: course has already started'
      using errcode = '22023', hint = 'course_started';
  end if;

  with upd as (
    update public.courses c
       set status = 'annule'
     where c.status <> 'annule'
       and c.starts_at > now()
       and (v_admin or (c.created_by = v_me and not c.is_private))
       and (c.id = v_c.id
            or (p_scope = 'following' and c.series_id = v_c.series_id and c.starts_at >= v_c.starts_at))
    returning c.id
  )
  select array_agg(id) into v_ids from upd;

  delete from public.attendance a
   where a.course_id = any (coalesce(v_ids, '{}'));

  perform public.notify_profile(b.profile_id, 'course_cancelled', b.course_id)
     from public.bookings b
    where b.course_id = any (coalesce(v_ids, '{}'))
      and b.cancelled_at is null
      and (b.payment_status <> 'pending' or b.pending_until > now());

  -- remboursements : réservations payées encore actives (une réservation
  -- payée puis désinscrite n'est pas remboursée)
  with r as (
    update public.bookings b
       set payment_status = 'refund_pending'
     where b.course_id = any (coalesce(v_ids, '{}'))
       and b.payment_status = 'paid'
       and b.cancelled_at is null
    returning b.id
  )
  select array_agg(id) into v_refund from r;

  update public.payments
     set status = 'refund_pending'
   where booking_id = any (coalesce(v_refund, '{}'))
     and status = 'succeeded';

  return coalesce(cardinality(v_ids), 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. process_course_schedule (0008) : libère les réservations en attente
-- expirées (et leur ligne d'appel éventuelle).
-- ---------------------------------------------------------------------------
create or replace function public.process_course_schedule() returns void
language plpgsql security definer set search_path = '' as $$
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
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Paiements des cours (service_role)
-- ---------------------------------------------------------------------------

-- Démarre (ou reprend) le paiement d'une réservation en attente.
-- p_payer : le bénéficiaire ou son parent, compte actif (sinon 42501).
-- Réservation non en attente (ou expirée) → 22023 not_pending ; cours annulé
-- ou commencé → 22023 course_closed. Réutilise le paiement pending existant.
create function public.start_course_payment(p_booking uuid, p_payer uuid)
returns table (payment_id uuid, amount numeric, description text)
language plpgsql security definer set search_path = '' as $$
declare
  v_b public.bookings;
  v_c public.courses;
  v_payer public.profiles;
  v_p public.payments;
begin
  select * into v_b from public.bookings where id = p_booking for update;
  if v_b.id is null then
    raise exception 'start_course_payment: booking not found' using errcode = 'P0002';
  end if;
  select * into v_payer from public.profiles where id = p_payer;
  if v_payer.id is null
     or not public.is_account_active(v_payer)
     or not (v_payer.id = v_b.profile_id
             or exists (select 1 from public.profiles c
                         where c.id = v_b.profile_id and c.parent_profile_id = v_payer.id)) then
    raise exception 'start_course_payment: payer cannot pay for this booking' using errcode = '42501';
  end if;
  if v_b.cancelled_at is not null or v_b.payment_status <> 'pending' or v_b.pending_until <= now() then
    raise exception 'start_course_payment: booking is not awaiting payment'
      using errcode = '22023', hint = 'not_pending';
  end if;
  select * into v_c from public.courses where id = v_b.course_id;
  if v_c.status = 'annule' or v_c.starts_at <= now() then
    raise exception 'start_course_payment: course is cancelled or has started'
      using errcode = '22023', hint = 'course_closed';
  end if;

  select * into v_p from public.payments
   where booking_id = v_b.id and status = 'pending'
   order by created_at desc
   limit 1;
  if v_p.id is not null and v_p.payer_profile_id is distinct from v_payer.id then
    update public.payments set payer_profile_id = v_payer.id where id = v_p.id
    returning * into v_p;
  end if;
  if v_p.id is null then
    insert into public.payments (kind, payer_profile_id, beneficiary_profile_id, booking_id, amount, description)
    values ('course', v_payer.id, v_b.profile_id, v_b.id, v_b.price,
            format('Cours %s du %s', upper(v_c.sport::text),
                   to_char(v_c.starts_at at time zone 'Europe/Zurich', 'DD.MM.YYYY HH24:MI')))
    returning * into v_p;
  end if;
  payment_id := v_p.id;
  amount := v_p.amount;
  description := v_p.description;
  return next;
end;
$$;

-- Lie un PaymentIntent Stripe à un paiement et renvoie l'intent à utiliser.
-- Un intent déjà lié n'est jamais remplacé : il est renvoyé (l'Edge Function
-- le réutilise et abandonne celui qu'elle vient de créer), si bien qu'un
-- intent qui aboutit est toujours connu de confirm_payment. Sans intent lié,
-- le paiement doit être pending (sinon 22023 not_pending).
create function public.attach_payment_intent(p_payment uuid, p_intent text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_p public.payments;
begin
  if p_intent is null or p_intent = '' then
    raise exception 'attach_payment_intent: p_intent is required'
      using errcode = '22023', hint = 'missing_field';
  end if;
  select * into v_p from public.payments where id = p_payment for update;
  if v_p.id is null then
    raise exception 'attach_payment_intent: payment not found' using errcode = 'P0002';
  end if;
  if v_p.stripe_payment_intent_id is not null then
    return v_p.stripe_payment_intent_id;
  end if;
  if v_p.status <> 'pending' then
    raise exception 'attach_payment_intent: payment is not pending'
      using errcode = '22023', hint = 'not_pending';
  end if;
  update public.payments set stripe_payment_intent_id = p_intent where id = p_payment;
  return p_intent;
end;
$$;

-- Paiement de cours réussi (webhook payment_intent.succeeded).
--  'already'     : déjà traité (succeeded / refund_pending / refunded)
--  'confirmed'   : réservation payée (réactivée si elle avait expiré)
--  'late_refund' : la réservation ne peut plus être honorée (cours annulé ou
--                  commencé, désinscrite, déjà payée par un autre paiement,
--                  autre réservation active) → paiement refund_pending
-- Intent inconnu → P0002.
create function public.confirm_payment(p_intent text, p_method text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_p public.payments;
  v_b public.bookings;
  v_c public.courses;
  v_booking uuid;
  v_late bool := false;
begin
  select booking_id into v_booking from public.payments where stripe_payment_intent_id = p_intent;
  if not found then
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
  select * into v_p from public.payments where stripe_payment_intent_id = p_intent for update;

  if v_p.status in ('succeeded', 'refund_pending', 'refunded') then
    return 'already';
  end if;
  if v_p.kind <> 'course' then
    raise exception 'confirm_payment: not a course payment'
      using errcode = '22023', hint = 'invalid_field';
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
         paid_at = now()
   where id = v_p.id;
  return case when v_late then 'late_refund' else 'confirmed' end;
end;
$$;

-- Échec d'un paiement (webhook payment_intent.payment_failed) : pending →
-- failed. Intent inconnu ou paiement déjà traité : sans effet. La réservation
-- reste en attente jusqu'à son expiration.
create function public.fail_payment(p_intent text) returns void
language sql security definer set search_path = '' as $$
  update public.payments set status = 'failed'
   where stripe_payment_intent_id = p_intent and status = 'pending';
$$;

-- Paiements à rembourser (Edge Function process-refunds).
create function public.refunds_to_process(p_limit int) returns setof public.payments
language sql stable security definer set search_path = '' as $$
  select * from public.payments
   where status = 'refund_pending' and stripe_payment_intent_id is not null
   order by created_at, id
   limit greatest(coalesce(p_limit, 20), 0);
$$;

-- Remboursement effectué : paiement refunded ; réservation refunded si elle
-- attendait ce remboursement. Déjà refunded : sans effet. Autre statut → 22023.
create function public.mark_refunded(p_payment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_booking uuid;
  v_p public.payments;
begin
  select booking_id into v_booking from public.payments where id = p_payment;
  if not found then
    raise exception 'mark_refunded: payment not found' using errcode = 'P0002';
  end if;
  if v_booking is not null then
    perform 1 from public.bookings where id = v_booking for update;
  end if;
  select * into v_p from public.payments where id = p_payment for update;
  if v_p.status = 'refunded' then
    return;
  end if;
  if v_p.status <> 'refund_pending' then
    raise exception 'mark_refunded: payment is not awaiting a refund'
      using errcode = '22023', hint = 'not_refundable';
  end if;
  update public.payments set status = 'refunded', refunded_at = now() where id = p_payment;
  update public.bookings set payment_status = 'refunded'
   where id = v_p.booking_id and payment_status = 'refund_pending';
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Droits d'exécution : jamais anon ; service_role seul pour les paiements
-- ---------------------------------------------------------------------------
revoke all on function public.course_participants(uuid) from public, anon;
revoke all on function public.trial_used(uuid) from public, anon, authenticated;
revoke all on function public.my_trial_status(uuid) from public, anon;
revoke all on function public.book_course(uuid, uuid) from public, anon;
revoke all on function public.unbook_course(uuid, uuid) from public, anon;
revoke all on function public.set_attendance(uuid, uuid, bool) from public, anon;
revoke all on function public.cancel_course(uuid, text) from public, anon;
revoke all on function public.process_course_schedule() from public, anon, authenticated;
revoke all on function public.start_course_payment(uuid, uuid) from public, anon, authenticated;
revoke all on function public.attach_payment_intent(uuid, text) from public, anon, authenticated;
revoke all on function public.confirm_payment(text, text) from public, anon, authenticated;
revoke all on function public.fail_payment(text) from public, anon, authenticated;
revoke all on function public.refunds_to_process(int) from public, anon, authenticated;
revoke all on function public.mark_refunded(uuid) from public, anon, authenticated;

grant execute on function public.course_participants(uuid) to authenticated;
grant execute on function public.trial_used(uuid) to service_role;
grant execute on function public.my_trial_status(uuid) to authenticated;
grant execute on function public.book_course(uuid, uuid) to authenticated;
grant execute on function public.unbook_course(uuid, uuid) to authenticated;
grant execute on function public.set_attendance(uuid, uuid, bool) to authenticated;
grant execute on function public.cancel_course(uuid, text) to authenticated;
grant execute on function public.process_course_schedule() to service_role;
grant execute on function public.start_course_payment(uuid, uuid) to service_role;
grant execute on function public.attach_payment_intent(uuid, text) to service_role;
grant execute on function public.confirm_payment(text, text) to service_role;
grant execute on function public.fail_payment(text) to service_role;
grant execute on function public.refunds_to_process(int) to service_role;
grant execute on function public.mark_refunded(uuid) to service_role;
