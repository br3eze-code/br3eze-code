create table if not exists public.auth_handoffs (
  id uuid primary key default gen_random_uuid(),
  nonce_hash text not null unique,
  client_id text not null check (client_id in ('device', 'web', 'native', 'cli')),
  action text not null check (action in ('signIn')),
  code_challenge text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  consumed_at timestamptz,
  user_payload jsonb
);

create index if not exists auth_handoffs_expires_idx
  on public.auth_handoffs (expires_at);

alter table public.auth_handoffs enable row level security;
revoke all on public.auth_handoffs from anon, authenticated;

drop policy if exists auth_handoffs_no_client_access on public.auth_handoffs;

create or replace function public.complete_auth_handoff(
  p_nonce_hash text,
  p_user_payload jsonb
)
returns table (
  id uuid,
  client_id text,
  action text,
  expires_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  update public.auth_handoffs
     set status = 'completed',
         consumed_at = now(),
         user_payload = p_user_payload
   where nonce_hash = p_nonce_hash
     and status = 'pending'
     and expires_at > now()
  returning id, client_id, action, expires_at;
$$;

create or replace function public.exchange_auth_handoff(
  p_nonce_hash text,
  p_code_challenge text
)
returns table (
  id uuid,
  client_id text,
  action text,
  user_payload jsonb
)
language sql
security definer
set search_path = public
as $$
  delete from public.auth_handoffs
   where nonce_hash = p_nonce_hash
     and code_challenge = p_code_challenge
     and status = 'completed'
     and expires_at > now()
  returning id, client_id, action, user_payload;
$$;

revoke all on function public.complete_auth_handoff(text, jsonb) from public, anon, authenticated;
revoke all on function public.exchange_auth_handoff(text, text) from public, anon, authenticated;
