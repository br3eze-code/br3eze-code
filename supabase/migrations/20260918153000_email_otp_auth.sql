-- Canonical email OTP challenges.
-- OTP values are never stored; the backend stores a peppered digest.
create table if not exists public.auth_otp_challenges (
  id uuid primary key,
  email text not null,
  purpose text not null check (purpose in ('login','signup','email_change','password_reset')),
  otp_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  requested_ip_hash text,
  user_agent_hash text
);

create index if not exists auth_otp_challenges_email_purpose_created_idx
  on public.auth_otp_challenges (lower(email), purpose, created_at desc);

create index if not exists auth_otp_challenges_expiry_idx
  on public.auth_otp_challenges (expires_at);

alter table public.auth_otp_challenges enable row level security;

revoke all on table public.auth_otp_challenges from anon, authenticated;
grant select, insert, update, delete on table public.auth_otp_challenges to service_role;

create or replace function public.consume_email_otp(
  p_challenge_id uuid,
  p_otp_hash text
)
returns table (
  ok boolean,
  email text,
  purpose text,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.auth_otp_challenges;
begin
  select *
    into c
    from public.auth_otp_challenges
   where id = p_challenge_id
   for update;

  if not found then
    return query select false, null::text, null::text, 'invalid_challenge'::text;
    return;
  end if;

  if c.consumed_at is not null then
    return query select false, c.email, c.purpose, 'already_used'::text;
    return;
  end if;

  if c.expires_at <= now() then
    update public.auth_otp_challenges
       set consumed_at = now()
     where id = c.id;
    return query select false, c.email, c.purpose, 'expired'::text;
    return;
  end if;

  if c.attempts >= c.max_attempts then
    return query select false, c.email, c.purpose, 'attempt_limit'::text;
    return;
  end if;

  if c.otp_hash <> p_otp_hash then
    update public.auth_otp_challenges
       set attempts = attempts + 1
     where id = c.id;
    return query select false, c.email, c.purpose, 'invalid_code'::text;
    return;
  end if;

  update public.auth_otp_challenges
     set consumed_at = now()
   where id = c.id;

  return query select true, c.email, c.purpose, 'verified'::text;
end;
$$;

revoke all on function public.consume_email_otp(uuid,text) from public, anon, authenticated;
grant execute on function public.consume_email_otp(uuid,text) to service_role;
