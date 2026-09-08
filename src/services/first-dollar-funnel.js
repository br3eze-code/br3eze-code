import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = process.env.AGENTOS_SALES_DATA_DIR || path.join(process.cwd(), 'state');
const LEADS_FILE = path.join(DATA_DIR, 'sales-leads.json');

const OFFER = Object.freeze({
  id: 'managed-wifi-assessment',
  name: 'Br3eze Managed Wi-Fi Assessment',
  currency: (process.env.SALES_CURRENCY || 'USD').toUpperCase(),
  amount: Number(process.env.SALES_ASSESSMENT_PRICE || 20),
});

async function readLeads() {
  try {
    const raw = await fs.readFile(LEADS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function appendLead(lead) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const leads = await readLeads();
  leads.push(lead);
  await fs.writeFile(LEADS_FILE, JSON.stringify(leads.slice(-5000), null, 2));
  return lead;
}

function clean(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

export function getFirstDollarOffer() {
  return { ...OFFER };
}

export async function createSalesLead(input = {}, request = {}) {
  const name = clean(input.name, 120);
  const business = clean(input.business, 160);
  const phone = clean(input.phone, 40);
  const email = clean(input.email, 160).toLowerCase();
  const type = clean(input.businessType || 'business', 80);
  const problem = clean(input.problem, 500);

  if (!name || !business || !phone) {
    const error = new Error('Name, business and phone are required');
    error.status = 400;
    throw error;
  }

  const lead = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: 'new',
    name,
    business,
    phone,
    email,
    businessType: type,
    problem,
    source: clean(input.source || 'website', 40),
    ip: request.ip ? clean(request.ip, 80) : undefined,
  };

  return appendLead(lead);
}

export async function listSalesLeads() {
  return readLeads();
}

export { OFFER };
