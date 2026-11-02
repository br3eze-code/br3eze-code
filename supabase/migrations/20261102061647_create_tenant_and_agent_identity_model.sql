-- Br3eze AgentOS: separate human, tenant and agent identities.
-- Tenant ownership is authoritative; human creator/owner references are optional
-- attribution/delegation links and never become agent identity themselves.

create table if not exists public.agent_tenants (
 tenant_id text primary key, display_name text not null,
 status text not null default 'active' check(status in ('active','suspended','closed')),
 metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.agent_tenant_memberships (
 tenant_id text not null references public.agent_tenants(tenant_id) on delete restrict,
 user_id uuid not null references auth.users(id) on delete restrict,
 membership_role text not null default 'member' check(membership_role in ('owner','admin','operator','member','auditor')),
 status text not null default 'active' check(status in ('invited','active','suspended','removed')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(tenant_id,user_id)
);
create index if not exists agent_tenant_memberships_user_idx on public.agent_tenant_memberships(user_id,status);
create table if not exists public.agent_identities (
 id uuid primary key default gen_random_uuid(),
 tenant_id text not null references public.agent_tenants(tenant_id) on delete restrict,
 created_by_user_id uuid references auth.users(id) on delete set null,
 owner_user_id uuid references auth.users(id) on delete set null,
 parent_agent_id uuid, agent_key text not null, display_name text not null,
 agent_type text not null default 'autonomous' check(agent_type in ('autonomous','assistant','worker','orchestrator','service')),
 purpose text, status text not null default 'pending' check(status in ('pending','active','restricted','revoked','decommissioned')),
 capabilities text[] not null default '{}',
 resource_scopes jsonb not null default '[]'::jsonb check(jsonb_typeof(resource_scopes)='array'),
 policy_version integer not null default 1 check(policy_version>0),
 host_identity_id text, budget_limit numeric(18,6),
 concurrency_limit integer not null default 1 check(concurrency_limit>0),
 metadata jsonb not null default '{}'::jsonb, expires_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), revoked_at timestamptz,
 unique(tenant_id,agent_key), unique(id,tenant_id),
 foreign key(parent_agent_id,tenant_id) references public.agent_identities(id,tenant_id) on delete restrict,
 check(parent_agent_id is null or parent_agent_id<>id)
);
create index if not exists agent_identities_tenant_status_idx on public.agent_identities(tenant_id,status);
create index if not exists agent_identities_owner_idx on public.agent_identities(owner_user_id) where owner_user_id is not null;
create index if not exists agent_identities_parent_idx on public.agent_identities(parent_agent_id) where parent_agent_id is not null;

create or replace function public.enforce_agent_identity_ownership()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.owner_user_id is not null and not exists(select 1 from public.agent_tenant_memberships m where m.tenant_id=new.tenant_id and m.user_id=new.owner_user_id and m.status='active') then
  raise exception 'agent owner must be an active member of its tenant';
 end if;
 if new.created_by_user_id is not null and not exists(select 1 from public.agent_tenant_memberships m where m.tenant_id=new.tenant_id and m.user_id=new.created_by_user_id and m.status='active') then
  raise exception 'agent creator must be an active member of its tenant';
 end if;
 if new.parent_agent_id is not null and not exists(select 1 from public.agent_identities p where p.id=new.parent_agent_id and p.tenant_id=new.tenant_id and p.status in ('active','restricted')) then
  raise exception 'parent agent must exist in the same tenant and be active or restricted';
 end if;
 new.updated_at=now(); return new;
end $$;
drop trigger if exists enforce_agent_identity_ownership on public.agent_identities;
create trigger enforce_agent_identity_ownership before insert or update of tenant_id,owner_user_id,created_by_user_id,parent_agent_id on public.agent_identities for each row execute function public.enforce_agent_identity_ownership();

create table if not exists public.agent_policies (
 id uuid primary key default gen_random_uuid(), tenant_id text not null references public.agent_tenants(tenant_id) on delete restrict,
 agent_id uuid, policy_key text not null, version integer not null default 1 check(version>0),
 effect text not null default 'deny' check(effect in ('allow','deny')), capabilities text[] not null default '{}',
 resource_scopes jsonb not null default '[]'::jsonb check(jsonb_typeof(resource_scopes)='array'),
 approval_required boolean not null default false, active boolean not null default true,
 created_by_user_id uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
 unique(tenant_id,policy_key,version),
 foreign key(agent_id,tenant_id) references public.agent_identities(id,tenant_id) on delete cascade
);
create index if not exists agent_policies_lookup_idx on public.agent_policies(tenant_id,agent_id,active);

create table if not exists public.agent_credentials (
 id uuid primary key default gen_random_uuid(), tenant_id text not null, agent_id uuid not null,
 credential_type text not null default 'bearer' check(credential_type in ('bearer','mtls','workload')),
 key_id text not null unique, token_hash text,
 status text not null default 'active' check(status in ('active','rotated','revoked','expired')),
 issued_at timestamptz not null default now(), expires_at timestamptz not null, last_used_at timestamptz, revoked_at timestamptz,
 metadata jsonb not null default '{}'::jsonb,
 foreign key(agent_id,tenant_id) references public.agent_identities(id,tenant_id) on delete cascade
);
create index if not exists agent_credentials_agent_status_idx on public.agent_credentials(tenant_id,agent_id,status);

create table if not exists public.agent_sessions (
 id uuid primary key default gen_random_uuid(), tenant_id text not null, agent_id uuid not null,
 initiated_by_user_id uuid references auth.users(id) on delete set null,
 parent_session_id uuid references public.agent_sessions(id) on delete set null,
 status text not null default 'running' check(status in ('running','completed','failed','cancelled','revoked')),
 correlation_id text, started_at timestamptz not null default now(), ended_at timestamptz,
 metadata jsonb not null default '{}'::jsonb,
 foreign key(agent_id,tenant_id) references public.agent_identities(id,tenant_id) on delete restrict
);
create index if not exists agent_sessions_agent_started_idx on public.agent_sessions(tenant_id,agent_id,started_at desc);

create table if not exists public.agent_events (
 id uuid primary key default gen_random_uuid(), tenant_id text not null,
 agent_id uuid, session_id uuid references public.agent_sessions(id) on delete set null,
 actor_user_id uuid references auth.users(id) on delete set null,
 event_type text not null, outcome text not null default 'recorded' check(outcome in ('recorded','allowed','denied','failed')),
 reason text, correlation_id text, event_data jsonb not null default '{}'::jsonb, occurred_at timestamptz not null default now(),
 foreign key(agent_id,tenant_id) references public.agent_identities(id,tenant_id) on delete restrict
);
create index if not exists agent_events_tenant_time_idx on public.agent_events(tenant_id,occurred_at desc);
create index if not exists agent_events_agent_time_idx on public.agent_events(agent_id,occurred_at desc) where agent_id is not null;

alter table public.agent_tenants enable row level security;
alter table public.agent_tenant_memberships enable row level security;
alter table public.agent_identities enable row level security;
alter table public.agent_policies enable row level security;
alter table public.agent_credentials enable row level security;
alter table public.agent_sessions enable row level security;
alter table public.agent_events enable row level security;

drop policy if exists agent_tenants_member_select on public.agent_tenants;
create policy agent_tenants_member_select on public.agent_tenants for select to authenticated using(exists(select 1 from public.agent_tenant_memberships m where m.tenant_id=agent_tenants.tenant_id and m.user_id=(select auth.uid()) and m.status='active'));
drop policy if exists agent_memberships_self_select on public.agent_tenant_memberships;
create policy agent_memberships_self_select on public.agent_tenant_memberships for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists agent_identities_member_select on public.agent_identities;
create policy agent_identities_member_select on public.agent_identities for select to authenticated using(exists(select 1 from public.agent_tenant_memberships m where m.tenant_id=agent_identities.tenant_id and m.user_id=(select auth.uid()) and m.status='active'));
drop policy if exists agent_policies_member_select on public.agent_policies;
create policy agent_policies_member_select on public.agent_policies for select to authenticated using(exists(select 1 from public.agent_tenant_memberships m where m.tenant_id=agent_policies.tenant_id and m.user_id=(select auth.uid()) and m.status='active'));
drop policy if exists agent_sessions_member_select on public.agent_sessions;
create policy agent_sessions_member_select on public.agent_sessions for select to authenticated using(exists(select 1 from public.agent_tenant_memberships m where m.tenant_id=agent_sessions.tenant_id and m.user_id=(select auth.uid()) and m.status='active'));
drop policy if exists agent_events_member_select on public.agent_events;
create policy agent_events_member_select on public.agent_events for select to authenticated using(exists(select 1 from public.agent_tenant_memberships m where m.tenant_id=agent_events.tenant_id and m.user_id=(select auth.uid()) and m.status='active'));
drop policy if exists agent_credentials_deny_client on public.agent_credentials;
create policy agent_credentials_deny_client on public.agent_credentials as restrictive for all to anon,authenticated using(false) with check(false);

comment on table public.agent_tenants is 'Organization/tenant ownership boundary for AgentOS identities.';
comment on table public.agent_tenant_memberships is 'Human membership and role within an AgentOS tenant.';
comment on table public.agent_identities is 'Persistent workload identity; distinct from human auth UUID and role definitions.';
comment on table public.agent_credentials is 'Credential metadata only; never store reusable bearer secrets in plaintext.';
comment on table public.agent_events is 'Tenant-scoped audit events for agent identity and execution lifecycle.';
