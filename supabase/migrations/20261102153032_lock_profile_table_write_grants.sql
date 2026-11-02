-- Column revokes do not override broader table-level grants. Revoke the
-- table-level write grants, then grant only harmless self-service profile edits.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.profiles FROM authenticated;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT UPDATE (email, full_name, username, phone, address)
  ON TABLE public.profiles TO authenticated;

COMMENT ON COLUMN public.profiles.role IS
  'Authorization role. Managed only by trusted server/service-role workflows.';
COMMENT ON COLUMN public.profiles.tenant_id IS
  'Tenant scope. Managed only by trusted server/service-role workflows.';
