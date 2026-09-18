-- Canonical commerce persistence.
create table if not exists public.services (
  id text primary key, sku text, name text not null, description text,
  price numeric(20,8) not null default 0, currency text not null default 'USD',
  active boolean not null default true, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint services_currency_chk check (currency ~ '^[A-Z]{3}$'),
  constraint services_price_chk check (price >= 0)
);
create table if not exists public.product_inventory (
  product_id text primary key references public.products(id) on delete cascade,
  quantity integer not null default 0, reserved integer not null default 0, updated_at timestamptz not null default now(),
  constraint product_inventory_quantity_chk check (quantity >= 0),
  constraint product_inventory_reserved_chk check (reserved >= 0 and reserved <= quantity)
);
create table if not exists public.service_inventory (
  service_id text primary key references public.services(id) on delete cascade,
  capacity integer not null default 0, reserved integer not null default 0, updated_at timestamptz not null default now(),
  constraint service_inventory_capacity_chk check (capacity >= 0),
  constraint service_inventory_reserved_chk check (reserved >= 0 and reserved <= capacity)
);
create table if not exists public.carts (
  id text primary key, user_id uuid references auth.users(id) on delete cascade,
  channel text not null default 'web', channel_id text, tenant_id text, site_id text, domain text,
  items jsonb not null default '[]'::jsonb, currency text not null default 'USD',
  updated_at timestamptz not null default now(), created_at timestamptz not null default now(),
  constraint carts_currency_chk check (currency ~ '^[A-Z]{3}$')
);
create unique index if not exists carts_user_channel_idx on public.carts(user_id,channel,channel_id,tenant_id,site_id,domain) where user_id is not null;
create table if not exists public.orders (
  id text primary key, user_id uuid references auth.users(id) on delete set null,
  channel text not null default 'web', channel_id text, tenant_id text, site_id text, domain text,
  items jsonb not null default '[]'::jsonb, subtotal numeric(20,8) not null default 0,
  shipping numeric(20,8) not null default 0, total numeric(20,8) not null default 0,
  currency text not null default 'USD', status text not null default 'pending_payment',
  payment_method text, payment_transaction_id text, invoice_id text, invoice_number text,
  shipping_address jsonb not null default '{}'::jsonb, billing_address jsonb not null default '{}'::jsonb,
  fulfillment_status text not null default 'unfulfilled', stock_reservation_status text not null default 'none',
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint orders_amount_chk check (subtotal >= 0 and shipping >= 0 and total >= 0),
  constraint orders_currency_chk check (currency ~ '^[A-Z]{3}$')
);
create index if not exists orders_user_created_idx on public.orders(user_id,created_at desc);
create index if not exists orders_status_idx on public.orders(status,created_at desc);
create index if not exists orders_payment_transaction_idx on public.orders(payment_transaction_id);
create table if not exists public.invoices (
  id text primary key, order_id text references public.orders(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null, number text not null unique,
  line_items jsonb not null default '[]'::jsonb, subtotal numeric(20,8) not null default 0,
  shipping numeric(20,8) not null default 0, total numeric(20,8) not null default 0,
  currency text not null default 'USD', billing_address jsonb not null default '{}'::jsonb,
  status text not null default 'unpaid', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists invoices_order_idx on public.invoices(order_id);
create index if not exists invoices_user_created_idx on public.invoices(user_id,created_at desc);
insert into public.product_inventory(product_id,quantity)
select id,greatest(quantity,0) from public.products on conflict(product_id) do nothing;
alter table public.services enable row level security;
alter table public.product_inventory enable row level security;
alter table public.service_inventory enable row level security;
alter table public.carts enable row level security;
alter table public.orders enable row level security;
alter table public.invoices enable row level security;
revoke all on public.services,public.product_inventory,public.service_inventory,public.carts,public.orders,public.invoices from anon;
revoke all on public.product_inventory,public.service_inventory from authenticated;
grant select on public.services to anon,authenticated;
grant select,insert,update,delete on public.carts to authenticated;
grant select on public.orders,public.invoices to authenticated;
grant all on public.services,public.carts,public.orders,public.invoices to service_role;
create policy services_public_read on public.services for select to anon,authenticated using(active=true);
create policy carts_select_own on public.carts for select to authenticated using((select auth.uid())=user_id);
create policy carts_insert_own on public.carts for insert to authenticated with check((select auth.uid())=user_id);
create policy carts_update_own on public.carts for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy carts_delete_own on public.carts for delete to authenticated using((select auth.uid())=user_id);
create policy orders_select_own on public.orders for select to authenticated using((select auth.uid())=user_id);
create policy invoices_select_own on public.invoices for select to authenticated using((select auth.uid())=user_id);