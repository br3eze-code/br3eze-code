-- Cover agent-domain foreign keys reported by Supabase's performance advisor.
-- Additive, idempotent indexes only; no data or authorization policies are changed.

CREATE INDEX IF NOT EXISTS agent_credentials_agent_tenant_idx
  ON public.agent_credentials (agent_id, tenant_id);

CREATE INDEX IF NOT EXISTS agent_events_actor_user_id_idx
  ON public.agent_events (actor_user_id);

CREATE INDEX IF NOT EXISTS agent_events_agent_tenant_idx
  ON public.agent_events (agent_id, tenant_id);

CREATE INDEX IF NOT EXISTS agent_events_session_tenant_idx
  ON public.agent_events (session_id, tenant_id);

CREATE INDEX IF NOT EXISTS agent_identities_created_by_user_id_idx
  ON public.agent_identities (created_by_user_id);

CREATE INDEX IF NOT EXISTS agent_identities_parent_agent_tenant_idx
  ON public.agent_identities (parent_agent_id, tenant_id);

CREATE INDEX IF NOT EXISTS agent_policies_agent_tenant_idx
  ON public.agent_policies (agent_id, tenant_id);

CREATE INDEX IF NOT EXISTS agent_policies_created_by_user_id_idx
  ON public.agent_policies (created_by_user_id);

CREATE INDEX IF NOT EXISTS agent_sessions_agent_tenant_idx
  ON public.agent_sessions (agent_id, tenant_id);

CREATE INDEX IF NOT EXISTS agent_sessions_initiated_by_user_id_idx
  ON public.agent_sessions (initiated_by_user_id);

CREATE INDEX IF NOT EXISTS agent_sessions_parent_session_id_idx
  ON public.agent_sessions (parent_session_id);
