-- Keep profile authority and credit balances server-managed.
-- Authenticated users may edit their own ordinary profile fields, but cannot
-- assign themselves a tenant/site/domain or mint credits.
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and new.id = auth.uid() then
      new.role := 'user';
      new.tenant_id := null;
      new.site_id := null;
      new.domain := null;
      new.credits := 0;
    elsif new.role is null then
      new.role := 'user';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and auth.uid() is not null then
    if new.role is distinct from old.role then
      raise exception 'profile role is managed by the server';
    end if;

    if new.tenant_id is distinct from old.tenant_id
       or new.site_id is distinct from old.site_id
       or new.domain is distinct from old.domain
       or new.credits is distinct from old.credits then
      raise exception 'profile tenancy and credit fields are managed by the server';
    end if;
  end if;

  return new;
end;
$function$;

-- Login lookup records contain usernames, phone numbers and email addresses.
-- Authenticated users may only read their own records; admins retain support access.
drop policy if exists app_login_lookup_select on public.app_login_lookups;
create policy app_login_lookup_select
  on public.app_login_lookups
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'admin'
    )
  );

-- OTP challenge rows are accessed only by trusted server-side code.
-- Explicit deny policy documents the boundary and satisfies the RLS advisor.
drop policy if exists auth_otp_challenges_deny_client on public.auth_otp_challenges;
create policy auth_otp_challenges_deny_client
  on public.auth_otp_challenges
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);
