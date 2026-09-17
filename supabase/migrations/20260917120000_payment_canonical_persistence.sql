-- Phase F: canonical payment persistence.
-- Financial records are append-only from the application boundary.
-- RLS is enabled; service_role is intended for trusted payment processing.

create table if not exists public.payment_events (
  event_id text primary key,
  event_type text not null,
  provider text not null,
  transaction_id text not null,
  reference text not null,
  idempotency_key text,
  amount numeric(20,8),
  currency text,
  order_id text,
  invoice_id text,
  tenant_id text,
  occurred_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  constraint payment_events_currency_chk check (currency is null or currency ~ '^[A-Z]{3}$')
);

create unique index if not exists payment_events_provider_transaction_type_idx
  on public.payment_events(provider, transaction_id, event_type);

create unique index if not exists payment_events_idempotency_idx
  on public.payment_events(idempotency_key)
  where idempotency_key is not null;

create index if not exists payment_events_reference_idx
  on public.payment_events(reference);

create index if not exists payment_events_occurred_at_idx
  on public.payment_events(occurred_at desc);

create table if not exists public.payment_transactions (
  transaction_id text primary key,
  provider text not null,
  reference text not null,
  order_id text,
  invoice_id text,
  tenant_id text,
  amount numeric(20,8) not null,
  currency text not null,
  status text not null default 'pending',
  payment_method text,
  idempotency_key text,
  provider_transaction_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_transactions_amount_chk check (amount >= 0),
  constraint payment_transactions_currency_chk check (currency ~ '^[A-Z]{3}$'),
  constraint payment_transactions_status_chk check (status in ('pending','succeeded','failed','cancelled','refunded','reversed','settled'))
);

create unique index if not exists payment_transactions_provider_reference_idx
  on public.payment_transactions(provider, reference);

create unique index if not exists payment_transactions_idempotency_idx
  on public.payment_transactions(idempotency_key)
  where idempotency_key is not null;

create table if not exists public.payment_ledger_entries (
  entry_id uuid primary key default gen_random_uuid(),
  transaction_id text not null references public.payment_transactions(transaction_id),
  entry_type text not null,
  direction text not null,
  amount numeric(20,8) not null,
  currency text not null,
  account text not null,
  reference text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint payment_ledger_amount_chk check (amount > 0),
  constraint payment_ledger_direction_chk check (direction in ('debit','credit'))
);

create index if not exists payment_ledger_transaction_idx
  on public.payment_ledger_entries(transaction_id, created_at);

create table if not exists public.payment_settlements (
  settlement_id text primary key,
  provider text not null,
  transaction_id text references public.payment_transactions(transaction_id),
  provider_reference text,
  amount numeric(20,8) not null,
  currency text not null,
  status text not null default 'pending',
  settled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_settlements_amount_chk check (amount >= 0),
  constraint payment_settlements_status_chk check (status in ('pending','matched','settled','failed','disputed'))
);

create index if not exists payment_settlements_provider_reference_idx
  on public.payment_settlements(provider, provider_reference);

create table if not exists public.payment_reconciliation (
  reconciliation_id uuid primary key default gen_random_uuid(),
  transaction_id text references public.payment_transactions(transaction_id),
  settlement_id text references public.payment_settlements(settlement_id),
  expected_amount numeric(20,8) not null,
  actual_amount numeric(20,8),
  currency text not null,
  status text not null default 'unmatched',
  discrepancy numeric(20,8),
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now(),
  constraint payment_reconciliation_status_chk check (status in ('matched','unmatched','partial','disputed'))
);

create index if not exists payment_reconciliation_transaction_idx
  on public.payment_reconciliation(transaction_id);

create table if not exists public.payment_idempotency (
  idempotency_key text primary key,
  operation text not null,
  request_hash text,
  response jsonb,
  status text not null default 'processing',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint payment_idempotency_status_chk check (status in ('processing','completed','failed'))
);

-- Financial tables must never be exposed without explicit policy decisions.
alter table public.payment_events enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.payment_ledger_entries enable row level security;
alter table public.payment_settlements enable row level security;
alter table public.payment_reconciliation enable row level security;
alter table public.payment_idempotency enable row level security;

-- Trusted backend processing uses service_role. No browser-facing policy is added here.
grant select, insert, update, delete on public.payment_events to service_role;
grant select, insert, update, delete on public.payment_transactions to service_role;
grant select, insert, update, delete on public.payment_ledger_entries to service_role;
grant select, insert, update, delete on public.payment_settlements to service_role;
grant select, insert, update, delete on public.payment_reconciliation to service_role;
grant select, insert, update, delete on public.payment_idempotency to service_role;

-- Explicitly deny direct browser access until a narrowly-scoped API policy is designed.
revoke all on public.payment_events from anon, authenticated;
revoke all on public.payment_transactions from anon, authenticated;
revoke all on public.payment_ledger_entries from anon, authenticated;
revoke all on public.payment_settlements from anon, authenticated;
revoke all on public.payment_reconciliation from anon, authenticated;
revoke all on public.payment_idempotency from anon, authenticated;

comment on table public.payment_events is 'Canonical normalized payment events; append-only application contract.';
comment on table public.payment_transactions is 'Canonical payment transaction state.';
comment on table public.payment_ledger_entries is 'Immutable financial ledger entries.';
comment on table public.payment_settlements is 'Provider settlement records.';
comment on table public.payment_reconciliation is 'Expected-vs-actual settlement reconciliation.';
comment on table public.payment_idempotency is 'Cross-request idempotency records for payment operations.';
