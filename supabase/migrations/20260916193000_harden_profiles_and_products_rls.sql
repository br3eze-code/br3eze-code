alter table public.profiles add column if not exists address text;
alter table public.profiles alter column role set default 'user';
alter table public.profiles add constraint profiles_role_check check (role in ('user','admin','partner','cashier'));

create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and new.id = auth.uid() then
      new.role := 'user';
    elsif new.role is null then
      new.role := 'user';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if auth.uid() is not null and new.role is distinct from old.role then
      raise exception 'profile role is managed by the server';
    end if;
    return new;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role before insert or update on public.profiles for each row execute function public.protect_profile_role();

drop policy if exists profiles_update_own_safe on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

revoke all on table public.profiles from anon;
grant select, insert, update on table public.profiles to authenticated;

revoke insert, update, delete, truncate, references, trigger on table public.products from anon, authenticated;
drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products for select to anon, authenticated using (active = true);
grant select on table public.products to anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id,email,full_name,username,phone,role)
  values (new.id,new.email,new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'username',new.raw_user_meta_data->>'phone','user')
  on conflict (id) do update set email=excluded.email, updated_at=now();
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
