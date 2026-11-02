-- Defense in depth: authenticated users cannot supply or mutate authority fields.
REVOKE INSERT (role, tenant_id, site_id, domain, credits, phone_verified_at)
  ON TABLE public.profiles FROM authenticated;
REVOKE UPDATE (role, tenant_id, site_id, domain, credits, phone_verified_at)
  ON TABLE public.profiles FROM authenticated;

COMMENT ON COLUMN public.profiles.role IS
  'Authorization role. Managed only by trusted server/service-role workflows.';
COMMENT ON COLUMN public.profiles.tenant_id IS
  'Tenant scope. Managed only by trusted server/service-role workflows.';
