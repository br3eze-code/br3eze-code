import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let client;
function getClient() {
  if (!url || !serviceKey) throw new Error('Supabase database provider requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  if (!client) client = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return client;
}
const normalizeUser = row => row ? ({
  id: row.id, uid: row.id, email: row.email, username: row.username,
  fullname: row.full_name || '', full_name: row.full_name || '',
  phone: row.phone, role: row.role || 'user', tenantId: row.tenant_id,
  siteId: row.site_id, domain: row.domain, address: row.address,
  credits: Number(row.credits || 0), ...row
}) : null;

const provider = {
  async getDatabase() { return this; },
  async getUser(uid) {
    const { data, error } = await getClient().from('profiles').select('*').eq('id', uid).maybeSingle();
    if (error) throw error;
    return normalizeUser(data);
  },
  async getUserByEmail(email) {
    const { data, error } = await getClient().from('profiles').select('*').eq('email', email).maybeSingle();
    if (error) throw error;
    return normalizeUser(data);
  },
  async getUserByUsername(username) {
    const { data, error } = await getClient().from('profiles').select('*').eq('username', username).maybeSingle();
    if (error) throw error;
    return normalizeUser(data);
  },
  async getUserByPhone(phone) {
    const { data, error } = await getClient().from('profiles').select('*').eq('phone', phone).maybeSingle();
    if (error) throw error;
    return normalizeUser(data);
  },
  async updateUser(uid, updates) {
    const mapped = { ...updates };
    if ('fullname' in mapped) { mapped.full_name = mapped.fullname; delete mapped.fullname; }
    if ('tenantId' in mapped) { mapped.tenant_id = mapped.tenantId; delete mapped.tenantId; }
    if ('siteId' in mapped) { mapped.site_id = mapped.siteId; delete mapped.siteId; }
    const { data, error } = await getClient().from('profiles').update(mapped).eq('id', uid).select('*').maybeSingle();
    if (error) throw error;
    return normalizeUser(data);
  },
  async deleteUser(uid) {
    const { error } = await getClient().from('profiles').delete().eq('id', uid);
    if (error) throw error;
    return true;
  },
  async getPlans(activeOnly = true) {
    let q = getClient().from('app_plans').select('*').order('price', { ascending: true });
    if (activeOnly) q = q.eq('active', true);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },
  async getPlan(id) {
    const { data, error } = await getClient().from('app_plans').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  },
  async createPlan(id, plan) {
    const { data, error } = await getClient().from('app_plans').upsert({ id, name: plan.name || id, description: plan.description || null, price: Number(plan.price || 0), data_limit: plan.dataLimit || null, device_limit: Number(plan.deviceLimit || plan.maxDevices || 1), duration_unit: plan.durationUnit || null, duration_value: plan.durationValue ?? null, duration_days: plan.durationDays ?? null, image_url: plan.imageUrl || null, active: plan.active !== false, metadata: plan.metadata || {} }).select('*').single();
    if (error) throw error;
    return data;
  },
  async updatePlan(id, updates) {
    const mapped = { ...updates };
    if ('dataLimit' in mapped) { mapped.data_limit = mapped.dataLimit; delete mapped.dataLimit; }
    if ('durationUnit' in mapped) { mapped.duration_unit = mapped.durationUnit; delete mapped.durationUnit; }
    if ('durationValue' in mapped) { mapped.duration_value = mapped.durationValue; delete mapped.durationValue; }
    if ('imageUrl' in mapped) { mapped.image_url = mapped.imageUrl; delete mapped.imageUrl; }
    const { error } = await getClient().from('app_plans').update(mapped).eq('id', id);
    if (error) throw error;
  },
  async deletePlan(id) {
    const { error } = await getClient().from('app_plans').delete().eq('id', id);
    if (error) throw error;
  },
  async getVoucher(code) {
    const { data, error } = await getClient().from('app_vouchers').select('*').eq('code', code).maybeSingle();
    if (error) throw error;
    return data ? { id: data.code, ...data } : null;
  },
  async createVoucher(code, data = {}) {
    const row = { code, value: Number(data.value ?? data.amount ?? 0), status: data.status || 'unused', used: Boolean(data.used), plan: data.plan || null, plan_name: data.planName || null, duration_unit: data.durationUnit || null, duration_value: data.durationValue ?? null, device_limit: Number(data.deviceLimit || 1), currency: data.currency || 'USD', expires_at: data.expiresAt || null, metadata: data.metadata || {} };
    const { data: saved, error } = await getClient().from('app_vouchers').upsert(row).select('*').single();
    if (error) throw error;
    return { id: saved.code, ...saved };
  },
  async updateVoucher(code, updates) {
    const mapped = { ...updates };
    if ('usedBy' in mapped) { mapped.used_by = mapped.usedBy; delete mapped.usedBy; }
    if ('usedAt' in mapped) { mapped.used_at = mapped.usedAt; delete mapped.usedAt; }
    if ('expiresAt' in mapped) { mapped.expires_at = mapped.expiresAt; delete mapped.expiresAt; }
    if ('planName' in mapped) { mapped.plan_name = mapped.planName; delete mapped.planName; }
    if ('durationUnit' in mapped) { mapped.duration_unit = mapped.durationUnit; delete mapped.durationUnit; }
    if ('durationValue' in mapped) { mapped.duration_value = mapped.durationValue; delete mapped.durationValue; }
    const { error } = await getClient().from('app_vouchers').update(mapped).eq('code', code);
    if (error) throw error;
  },
  async getStats() {
    const [{ count: vouchers }, { count: users }, { count: plans }] = await Promise.all([
      getClient().from('app_vouchers').select('*', { count:'exact', head:true }),
      getClient().from('profiles').select('*', { count:'exact', head:true }),
      getClient().from('app_plans').select('*', { count:'exact', head:true })
    ]);
    return { total: vouchers || 0, users: users || 0, plans: plans || 0 };
  },
  async logAudit(action, actor, metadata = {}) {
    return { action, actor, metadata, createdAt: new Date().toISOString() };
  },
  async getAuditLog() { return []; },
  async syncUserData(uid, data) { return this.updateUser(uid, data); },
  async close() {}
};

export default provider;
export { provider as supabaseDatabaseProvider };
