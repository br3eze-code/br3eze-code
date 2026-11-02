-- Harden payment tables as explicitly server-only and satisfy RLS policy audits.
-- Client roles already lack table grants; these deny-all policies make that
-- intent explicit without granting browser access. service_role bypasses RLS.

create policy payment_events_deny_client
  on public.payment_events
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy payment_idempotency_deny_client
  on public.payment_idempotency
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy payment_ledger_entries_deny_client
  on public.payment_ledger_entries
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy payment_reconciliation_deny_client
  on public.payment_reconciliation
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy payment_settlements_deny_client
  on public.payment_settlements
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy payment_transactions_deny_client
  on public.payment_transactions
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- RLS policies should cache the auth.uid() lookup per statement.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
  on public.profiles
  for insert
  to authenticated
  with check (id = (select auth.uid()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Foreign-key indexes improve reconciliation/settlement joins and deletes.
create index if not exists idx_payment_reconciliation_settlement_id
  on public.payment_reconciliation (settlement_id);

create index if not exists idx_payment_settlements_transaction_id
  on public.payment_settlements (transaction_id);
