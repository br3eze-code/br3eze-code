-- Phone verification is separate from Supabase Auth login.
alter table public.profiles add column if not exists phone_verified_at timestamptz;

create table if not exists public.auth_phone_otp_challenges (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  phone text not null,
  purpose text not null check (purpose = 'phone_verification'),
  otp_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  requested_ip_hash text,
  user_agent_hash text
);

create index if not exists auth_phone_otp_user_created_idx on public.auth_phone_otp_challenges (user_id, created_at desc);
create index if not exists auth_phone_otp_expiry_idx on public.auth_phone_otp_challenges (expires_at);

alter table public.auth_phone_otp_challenges enable row level security;
revoke all on table public.auth_phone_otp_challenges from anon, authenticated;
grant select, insert, update, delete on table public.auth_phone_otp_challenges to service_role;

drop policy if exists auth_phone_otp_challenges_deny_client on public.auth_phone_otp_challenges;
create policy auth_phone_otp_challenges_deny_client on public.auth_phone_otp_challenges
  as restrictive for all to anon, authenticated using (false) with check (false);

create or replace function public.consume_phone_otp(p_challenge_id uuid, p_user_id uuid, p_otp_hash text)
returns table (ok boolean, user_id uuid, phone text, purpose text, reason text)
language plpgsql security definer set search_path = public
as $$
declare c public.auth_phone_otp_challenges;
begin
  select * into c from public.auth_phone_otp_challenges
   where id = p_challenge_id and auth_phone_otp_challenges.user_id = p_user_id for update;
  if not found then
    return query select false, null::uuid, null::text, null::text, 'invalid_challenge'::text; return;
  end if;
  if c.consumed_at is not null then
    return query select false, c.user_id, c.phone, c.purpose, 'already_used'::text; return;
  end if;
  if c.expires_at <= now() then
    update public.auth_phone_otp_challenges set consumed_at = now() where id = c.id;
    return query select false, c.user_id, c.phone, c.purpose, 'expired'::text; return;
  end if;
  if c.attempts >= c.max_attempts then
    return query select false, c.user_id, c.phone, c.purpose, 'attempt_limit'::text; return;
  end if;
  if c.otp_hash <> p_otp_hash then
    update public.auth_phone_otp_challenges set attempts = attempts + 1 where id = c.id;
    return query select false, c.user_id, c.phone, c.purpose, 'invalid_code'::text; return;
  end if;
  update public.auth_phone_otp_challenges set consumed_at = now() where id = c.id;
  update public.profiles set phone = c.phone, phone_verified_at = now(), updated_at = now() where id = c.user_id;
  if not found then raise exception 'profile not found for verified account'; end if;
  return query select true, c.user_id, c.phone, c.purpose, 'verified'::text;
end;
$$;

revoke all on function public.consume_phone_otp(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.consume_phone_otp(uuid,uuid,text) to service_role;
