/* ==========================================================
   06.supabase.js — canonical PWA data boundary
   Supabase is the default datastore. Firebase is not required.
   The small db facade exists only to keep legacy callers from
   coupling the application back to a vendor SDK.
   ========================================================== */
'use strict';

const runtime = window.ENV || {};
const SUPABASE_URL = String(runtime.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = runtime.SUPABASE_PUBLISHABLE_KEY || runtime.SUPABASE_ANON_KEY || '';

function session() {
    try { return JSON.parse(localStorage.getItem('agentos_supabase_session') || 'null'); } catch { return null; }
}
function headers() {
    const s = session();
    const h = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
    if (s?.access_token) h.Authorization = 'Bearer ' + s.access_token;
    return h;
}
async function request(path, options = {}) {
    if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase datastore is not configured.');
    const response = await fetch(SUPABASE_URL + path, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.message || body?.msg || body?.hint || body?.error || 'Supabase datastore request failed.');
    return body;
}

const TABLES = {
    users: 'profiles',
    plans: 'app_plans',
    tickets: 'app_tickets',
    replies: 'app_ticket_replies',
    settings: 'app_settings',
    vouchers: 'app_vouchers',
    transactions: 'app_transactions',
    products: 'products',
    partners: 'app_partner_networks'
};
const ID_FIELDS = { users:'id', plans:'id', tickets:'id', replies:'id', settings:'key', vouchers:'code', transactions:'id', products:'id', partners:'user_id' };

function tableFor(name) { return TABLES[name] || name; }
function idField(name) { return ID_FIELDS[name] || 'id'; }
function encode(value) { return encodeURIComponent(String(value)); }
function cleanUser(row) {
    if (!row) return null;
    return { id: row.id, uid: row.id, email: row.email || null, fullname: row.full_name || row.fullname || '', full_name: row.full_name || '', username: row.username || '', phone: row.phone || '', role: row.role || 'user', tenantId: row.tenant_id || null, siteId: row.site_id || null, domain: row.domain || null, address: row.address || null, credits: Number(row.credits || 0), ...row };
}
function mapRow(name, row) { return name === 'users' ? cleanUser(row) : row; }

window.currentUser = window.currentUser || null;

class Query {
    constructor(name, filters = [], order = null, max = null) { this.name = name; this.filters = filters; this.order = order; this.max = max; }
    where(field, op, value) { return new Query(this.name, [...this.filters, [field, op, value]], this.order, this.max); }
    orderBy(field, direction = 'asc') { return new Query(this.name, this.filters, [field, direction], this.max); }
    limit(max) { return new Query(this.name, this.filters, this.order, max); }
    async get() {
        const params = new URLSearchParams({ select: '*' });
        for (const [field, op, value] of this.filters) {
            const operator = op === '==' ? 'eq' : op === '!=' ? 'neq' : op;
            params.set(field, operator + '.' + value);
        }
        if (this.order) params.set('order', this.order[0] + '.' + this.order[1]);
        if (this.max) params.set('limit', String(this.max));
        const rows = await request('/rest/v1/' + tableFor(this.name) + '?' + params);
        return { empty: !rows?.length, size: rows?.length || 0, docs: (rows || []).map(row => new DocSnapshot(this.name, row)) };
    }
}
class DocSnapshot {
    constructor(name, row) { this.name = name; this._row = row; this.id = row?.[idField(name)]; this.exists = !!row; }
    data() { return this._row; }
}
class DocRef {
    constructor(name, id) { this.name = name; this.id = id; }
    async get() {
        const rows = await request('/rest/v1/' + tableFor(this.name) + '?' + idField(this.name) + '=eq.' + encode(this.id) + '&select=*');
        return new DocSnapshot(this.name, rows?.[0] || null);
    }
    collection(child) { return new CollectionRef(child === 'replies' ? 'replies' : child, this.id, this.name); }
    async set(data, options = {}) { return write(this.name, this.id, data, options.merge); }
    async update(data) { return write(this.name, this.id, data, true); }
    async delete() { await request('/rest/v1/' + tableFor(this.name) + '?' + idField(this.name) + '=eq.' + encode(this.id), { method:'DELETE' }); }
}
class CollectionRef extends Query {
    constructor(name, parentId = null, parentName = null) { super(name); this.parentId = parentId; this.parentName = parentName; }
    doc(id) { return new DocRef(this.name, id); }
    add(data) { const id = crypto.randomUUID(); return new DocRef(this.name, id).set({ id, ...data }); }
}
function collection(name) { return new CollectionRef(name); }

async function write(name, id, data, merge = false) {
    const payload = { ...data };
    const field = idField(name);
    if (name === 'users') delete payload.id;
    if (name === 'settings') payload.key = id;
    else payload[field] = id;
    for (const [key, value] of Object.entries(payload)) {
        if (value && value.__op === 'increment') {
            const current = await new DocRef(name, id).get();
            payload[key] = Number(current.data()?.[key] || 0) + Number(value.value || 0);
        }
        if (value && value.__op === 'serverTimestamp') payload[key] = new Date().toISOString();
    }
    await request('/rest/v1/' + tableFor(name) + (merge ? '?' + field + '=eq.' + encode(id) : ''), {
        method: merge ? 'PATCH' : 'POST',
        headers: { Prefer: merge ? 'return=minimal' : 'return=representation' },
        body: JSON.stringify(payload)
    });
    return payload;
}

class Batch {
    constructor() { this.ops = []; }
    set(ref, data, options) { this.ops.push(() => ref.set(data, options)); return this; }
    update(ref, data) { this.ops.push(() => ref.update(data)); return this; }
    delete(ref) { this.ops.push(() => ref.delete()); return this; }
    async commit() { for (const op of this.ops) await op(); }
}

window.firebase = window.firebase || {};
window.firebase.firestore = window.firebase.firestore || {};
window.firebase.firestore.FieldValue = {
    serverTimestamp: () => ({ __op:'serverTimestamp' }),
    increment: value => ({ __op:'increment', value })
};

window.db = {
    collection,
    batch: () => new Batch(),
    runTransaction: async fn => fn({
        get: ref => ref.get(),
        update: (ref, data) => ref.update(data),
        set: (ref, data, options) => ref.set(data, options)
    })
};

window.DataStore = {
    provider: 'supabase',
    isAvailable: () => Boolean(SUPABASE_URL && SUPABASE_KEY),
    getCurrentUserId: () => window.currentUser?.id || session()?.user?.id || null,

    async getUser(uid) {
        const id = uid || this.getCurrentUserId();
        if (!id) return null;
        const snap = await new DocRef('users', id).get();
        return snap.exists ? cleanUser(snap.data()) : null;
    },
    async getAllUsers() {
        const rows = await request('/rest/v1/profiles?select=*&order=created_at.desc');
        return (rows || []).map(cleanUser);
    },
    async getUserByUsername(username) {
        const rows = await request('/rest/v1/profiles?username=eq.' + encode(username) + '&select=*');
        return rows?.[0] ? cleanUser(rows[0]) : null;
    },
    async resolveLoginEmail(identifier) {
        const value = String(identifier || '').trim();
        if (value.includes('@')) return { email: value };
        const rows = await request('/rest/v1/app_login_lookups?lookup=eq.' + encode(value.toLowerCase()) + '&select=email,user_id');
        return rows?.[0] || null;
    },
    async writeLoginLookups(user) {
        const values = [user.username, user.phone, user.email].filter(Boolean).map(v => ({ lookup:String(v).toLowerCase(), user_id:user.id || user.uid, email:user.email }));
        for (const value of values) await request('/rest/v1/app_login_lookups?on_conflict=lookup', { method:'POST', headers:{ Prefer:'resolution=merge-duplicates,return=minimal' }, body:JSON.stringify(value) });
    },
    async updateUser(uid, updates) {
        const mapped = { ...updates };
        if ('fullname' in mapped) { mapped.full_name = mapped.fullname; delete mapped.fullname; }
        if ('tenantId' in mapped) { mapped.tenant_id = mapped.tenantId; delete mapped.tenantId; }
        if ('siteId' in mapped) { mapped.site_id = mapped.siteId; delete mapped.siteId; }
        await request('/rest/v1/profiles?id=eq.' + encode(uid), { method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify(mapped) });
        return this.getUser(uid);
    },
    async getPlans() {
        const rows = await request('/rest/v1/app_plans?active=eq.true&order=price.asc');
        return rows || [];
    },
    async getTickets() {
        const uid = this.getCurrentUserId();
        const rows = await request('/rest/v1/app_tickets?select=*&order=last_update.desc');
        return (rows || []).filter(t => window.currentUser?.role === 'admin' || t.user_id === uid).map(t => ({ id:t.id, userId:t.user_id, userEmail:t.user_email, subject:t.subject, body:t.body, status:t.status, lastUpdate:t.last_update, timestamp:t.created_at }));
    },
    async getTicketReplies(tid) {
        const rows = await request('/rest/v1/app_ticket_replies?ticket_id=eq.' + encode(tid) + '&select=*&order=created_at.asc');
        return (rows || []).map(r => ({ id:r.id, senderId:r.sender_id, message:r.message, timestamp:r.created_at }));
    },
    async createTicket(data) {
        return request('/rest/v1/app_tickets', { method:'POST', headers:{Prefer:'return=representation'}, body:JSON.stringify({ user_id:this.getCurrentUserId(), user_email:window.currentUser?.email || null, subject:data.subject, body:data.body }) });
    },
    async updateTicketStatus(tid, status) {
        return request('/rest/v1/app_tickets?id=eq.' + encode(tid), { method:'PATCH', headers:{Prefer:'return=minimal'}, body:JSON.stringify({status,last_update:new Date().toISOString()}) });
    },
    async sendTicketReply(tid, data) {
        return request('/rest/v1/app_ticket_replies', { method:'POST', headers:{Prefer:'return=minimal'}, body:JSON.stringify({ticket_id:tid,sender_id:this.getCurrentUserId(),message:data.message}) });
    },
    async getNetworkSettings() {
        const rows = await request('/rest/v1/app_settings?key=eq.network&select=value');
        return rows?.[0]?.value || { ssid:'', password:'' };
    },
    async setNetworkSettings(value) {
        return request('/rest/v1/app_settings?on_conflict=key', { method:'POST', headers:{Prefer:'resolution=merge-duplicates,return=minimal'}, body:JSON.stringify({key:'network',value,updated_at:new Date().toISOString()}) });
    },
    async redeemVoucher(code) {
        const rows = await request('/rest/v1/rpc/redeem_app_voucher', { method:'POST', body:JSON.stringify({p_code:code}) });
        return rows;
    },
    async transferCredit(recipientId, amount, recipientEmail) {
        return request('/rest/v1/rpc/transfer_app_credit', { method:'POST', body:JSON.stringify({p_recipient_id:recipientId,p_amount:amount,p_recipient_email:recipientEmail}) });
    },
    async findUserByEmail(email) {
        const rows = await request('/rest/v1/profiles?email=eq.' + encode(email) + '&select=id,email,full_name,username,phone,role,tenant_id,site_id,domain,credits&limit=1');
        return rows?.[0] ? cleanUser(rows[0]) : null;
    }
};
