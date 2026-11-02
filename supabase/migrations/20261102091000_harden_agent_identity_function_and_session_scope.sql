-- The ownership trigger is invoked by table writes only, never as a client RPC.
revoke all on function public.enforce_agent_identity_ownership() from public, anon, authenticated;

-- Keep an audit event's session inside the same tenant as the event.
alter table public.agent_sessions
  add constraint agent_sessions_id_tenant_unique unique (id, tenant_id);

alter table public.agent_events
  drop constraint if exists agent_events_session_id_fkey;

alter table public.agent_events
  add constraint agent_events_session_tenant_fk
  foreign key (session_id, tenant_id)
  references public.agent_sessions (id, tenant_id)
  on delete set null (session_id);
