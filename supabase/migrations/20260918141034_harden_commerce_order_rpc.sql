-- Canonical commerce order RPC: atomic inventory reservation + order/invoice creation.
create or replace function public.create_commerce_order(
  p_order_id text, p_invoice_id text, p_invoice_number text, p_user_id uuid, p_items jsonb,
  p_subtotal numeric, p_shipping numeric, p_total numeric, p_currency text, p_payment_method text,
  p_payment_transaction_id text default null, p_shipping_address jsonb default '{}'::jsonb,
  p_billing_address jsonb default '{}'::jsonb, p_channel text default 'web', p_channel_id text default null,
  p_tenant_id text default null, p_site_id text default null, p_domain text default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare item jsonb; pid text; qty integer; available integer;
begin
  if auth.uid() is not null then
    if p_user_id is distinct from auth.uid() then raise exception 'not authorized'; end if;
  elsif coalesce(current_setting('request.jwt.claim.role', true),'') <> 'service_role' then
    raise exception 'not authorized';
  end if;
  if p_total < 0 or p_subtotal < 0 or p_shipping < 0 then raise exception 'invalid totals'; end if;
  if p_currency !~ '^[A-Z]{3}$' then raise exception 'invalid currency'; end if;
  for item in select * from jsonb_array_elements(p_items) loop
    pid := item->>'productId'; qty := greatest(1,(item->>'qty')::integer);
    perform 1 from public.product_inventory where product_id=pid for update;
    select quantity-reserved into available from public.product_inventory where product_id=pid;
    if available is null or available < qty then raise exception 'insufficient stock for %',pid; end if;
  end loop;
  for item in select * from jsonb_array_elements(p_items) loop
    pid := item->>'productId'; qty := greatest(1,(item->>'qty')::integer);
    update public.product_inventory set reserved=reserved+qty,updated_at=now() where product_id=pid;
  end loop;
  insert into public.orders(id,user_id,channel,channel_id,tenant_id,site_id,domain,items,subtotal,shipping,total,currency,status,payment_method,payment_transaction_id,invoice_id,invoice_number,shipping_address,billing_address,fulfillment_status,stock_reservation_status)
  values(p_order_id,p_user_id,p_channel,p_channel_id,p_tenant_id,p_site_id,p_domain,p_items,p_subtotal,p_shipping,p_total,p_currency,case when p_payment_method='cod' then 'pending_payment' else 'paid' end,p_payment_method,p_payment_transaction_id,p_invoice_id,p_invoice_number,p_shipping_address,p_billing_address,'unfulfilled','reserved');
  insert into public.invoices(id,order_id,user_id,number,line_items,subtotal,shipping,total,currency,billing_address,status)
  values(p_invoice_id,p_order_id,p_user_id,p_invoice_number,p_items,p_subtotal,p_shipping,p_total,p_currency,p_billing_address,case when p_payment_method='cod' then 'unpaid' else 'paid' end);
  return jsonb_build_object('orderId',p_order_id,'invoiceId',p_invoice_id,'status',case when p_payment_method='cod' then 'pending_payment' else 'paid' end);
end; $$;
revoke all on function public.create_commerce_order(text,text,text,uuid,jsonb,numeric,numeric,numeric,text,text,text,jsonb,jsonb,text,text,text,text,text) from public,anon;
grant execute on function public.create_commerce_order(text,text,text,uuid,jsonb,numeric,numeric,numeric,text,text,text,jsonb,jsonb,text,text,text,text,text) to authenticated,service_role;

create policy product_inventory_deny_client on public.product_inventory as restrictive for all to anon,authenticated using(false) with check(false);
create policy service_inventory_deny_client on public.service_inventory as restrictive for all to anon,authenticated using(false) with check(false);