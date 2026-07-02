#!/usr/bin/env node
'use strict';
/**
 * AgentOS Accounting Report Generator
 * Fetches transaction data from Firestore and generates revenue reports.
 *
 * Usage:
 *   node scripts/accounting-report.js \
 *     --from 2026-05-01 --to 2026-05-31 \
 *     --mode daily --out reports/accounting [--verbose]
 */

const fs = require('fs');
const path = require('path');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const get = (flag, def = '') => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};

const FROM = get('--from', new Date(Date.now() - 86400000 * 30).toISOString().slice(0, 10));
const TO = get('--to', new Date().toISOString().slice(0, 10));
const MODE = get('--mode', 'daily');
const OUT_DIR = get('--out', 'reports/accounting');
const VERBOSE = args.includes('--verbose');

const log = (...a) => console.log('[accounting]', ...a);
const vlog = (...a) => VERBOSE && console.log('[accounting:verbose]', ...a);

// ── Firebase init (optional — gracefully skip in CI without credentials) ──────
let db = null;
async function initFirebase() {
  try {
    const admin = require('firebase-admin');
    if (admin.apps.length === 0) {
      const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      if (credPath && fs.existsSync(credPath)) {
        admin.initializeApp({
          credential: admin.credential.applicationDefault(),
          projectId: process.env.FIREBASE_PROJECT_ID,
        });
      } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
          credential: admin.credential.cert(sa),
          projectId: process.env.FIREBASE_PROJECT_ID,
        });
      } else {
        log('⚠  No Firebase credentials — running in offline/mock mode');
        return false;
      }
    }
    db = admin.firestore();
    log('✓ Firebase connected');
    return true;
  } catch (err) {
    log('⚠  Firebase init failed (offline mode):', err.message);
    return false;
  }
}

// ── Fetch transactions from Firestore ─────────────────────────────────────────
async function fetchTransactions(from, to) {
  if (!db) return getMockTransactions(from, to);

  const collections = ['vouchers', 'payments', 'sessions', 'transactions'];
  const fromTs = new Date(from);
  const toTs = new Date(`${to}T23:59:59Z`);
  const all = [];

  for (const col of collections) {
    try {
      vlog(`Querying ${col}...`);
      const q = db
        .collection(col)
        .where('createdAt', '>=', fromTs)
        .where('createdAt', '<=', toTs)
        .orderBy('createdAt', 'desc')
        .limit(10000);

      const snap = await q.get();
      let page = snap;
      while (!page.empty) {
        page.docs.forEach(d => all.push({ id: d.id, collection: col, ...d.data() }));
        vlog(`  ${col}: fetched ${page.size} docs (total ${all.length})`);
        if (page.size < 10000) break;
        const last = page.docs[page.docs.length - 1];
        page = await q.startAfter(last).get();
      }
    } catch (e) {
      vlog(`  ${col}: skip (${e.message})`);
    }
  }

  log(`✓ Fetched ${all.length} records from Firestore`);
  return all;
}

function getMockTransactions(from, to) {
  log('📦 Using mock transactions (offline mode)');
  const days = Math.ceil((new Date(to) - new Date(from)) / 86400000) + 1;
  const txns = [];
  for (let d = 0; d < days; d++) {
    const date = new Date(from);
    date.setDate(date.getDate() + d);
    const count = Math.floor(Math.random() * 20) + 5;
    for (let i = 0; i < count; i++) {
      txns.push({
        id: `mock-${d}-${i}`,
        collection: 'vouchers',
        createdAt: date,
        amount: [1, 2, 5, 10, 20][Math.floor(Math.random() * 5)],
        currency: 'USD',
        status: Math.random() > 0.1 ? 'completed' : 'failed',
        plan: ['daily', 'weekly', 'monthly'][Math.floor(Math.random() * 3)],
      });
    }
  }
  return txns;
}

// ── Compute report ────────────────────────────────────────────────────────────
function computeReport(txns, from, to, mode) {
  const completed = txns.filter(t => t.status === 'completed' || !t.status);
  const failed = txns.filter(t => t.status === 'failed');
  const revenue = completed.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const failRate = txns.length ? ((failed.length / txns.length) * 100).toFixed(2) : '0.00';

  // Daily breakdown
  const byDay = {};
  txns.forEach(t => {
    const d = (t.createdAt?.toDate?.() || new Date(t.createdAt || Date.now()))
      .toISOString()
      .slice(0, 10);
    if (!byDay[d]) byDay[d] = { date: d, count: 0, revenue: 0, failures: 0 };
    byDay[d].count++;
    if (t.status === 'completed' || !t.status) byDay[d].revenue += Number(t.amount) || 0;
    if (t.status === 'failed') byDay[d].failures++;
  });

  // Anomaly detection — days with revenue < 50% of average
  const days = Object.values(byDay);
  const avgRev = days.length ? days.reduce((s, d) => s + d.revenue, 0) / days.length : 0;
  const anomalies = [];
  days.forEach(d => {
    if (d.revenue < avgRev * 0.5 && avgRev > 0) {
      anomalies.push({
        date: d.date,
        severity: 'high',
        message: `Revenue $${d.revenue.toFixed(2)} is <50% of daily avg $${avgRev.toFixed(2)}`,
        actual: d.revenue,
        expected: avgRev,
      });
    }
    if (d.failures > d.count * 0.3) {
      anomalies.push({
        date: d.date,
        severity: 'high',
        message: `Failure rate ${((d.failures / d.count) * 100).toFixed(0)}% exceeds 30%`,
        actual: d.failures,
        expected: d.count * 0.3,
      });
    }
  });

  return {
    summary: {
      period: `${from} to ${to}`,
      mode,
      total_transactions: txns.length,
      completed_transactions: completed.length,
      failed_transactions: failed.length,
      total_revenue_usd: revenue.toFixed(2),
      failure_rate_pct: failRate,
      avg_daily_revenue_usd: avgRev.toFixed(2),
      generated_at: new Date().toISOString(),
    },
    daily: days.sort((a, b) => a.date.localeCompare(b.date)),
    anomalies,
  };
}

// ── Write output files ────────────────────────────────────────────────────────
function writeReports(report, outDir) {
  fs.mkdirSync(outDir, { recursive: true });

  // summary.json
  fs.writeFileSync(
    path.join(outDir, 'summary.json'),
    JSON.stringify({ summary: report.summary, daily_count: report.daily.length }, null, 2)
  );

  // anomalies.json
  fs.writeFileSync(path.join(outDir, 'anomalies.json'), JSON.stringify(report.anomalies, null, 2));

  // report.csv
  const csvHeader = 'date,count,revenue_usd,failures\n';
  const csvRows = report.daily
    .map(d => `${d.date},${d.count},${d.revenue.toFixed(2)},${d.failures}`)
    .join('\n');
  fs.writeFileSync(path.join(outDir, 'report.csv'), csvHeader + csvRows);

  // summary.md
  const s = report.summary;
  const md = [
    `# AgentOS Accounting Report`,
    `**Period:** ${s.period}  **Mode:** ${s.mode}`,
    '',
    '## Summary',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total Transactions | ${s.total_transactions} |`,
    `| Completed | ${s.completed_transactions} |`,
    `| Failed | ${s.failed_transactions} |`,
    `| Total Revenue | $${s.total_revenue_usd} |`,
    `| Failure Rate | ${s.failure_rate_pct}% |`,
    `| Avg Daily Revenue | $${s.avg_daily_revenue_usd} |`,
    '',
    `## Anomalies (${report.anomalies.length})`,
    report.anomalies.length === 0
      ? '_No anomalies detected._'
      : report.anomalies
          .map(a => `- **[${a.severity.toUpperCase()}]** ${a.date}: ${a.message}`)
          .join('\n'),
    '',
    `_Generated: ${s.generated_at}_`,
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'summary.md'), md);

  log(`✓ Reports written to ${outDir}/`);
  log(`  summary.json | anomalies.json | report.csv | summary.md`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  log(`📊 AgentOS Accounting Report`);
  log(`   Period : ${FROM} → ${TO}`);
  log(`   Mode   : ${MODE}`);
  log(`   Output : ${OUT_DIR}`);

  await initFirebase();
  const txns = await fetchTransactions(FROM, TO);
  const report = computeReport(txns, FROM, TO, MODE);
  writeReports(report, OUT_DIR);

  const { summary: s } = report;
  log(
    `✅ Done — Revenue: $${s.total_revenue_usd} | Txns: ${s.total_transactions} | Anomalies: ${report.anomalies.length}`
  );
  process.exit(0);
})().catch(err => {
  console.error('[accounting] Fatal:', err);
  process.exit(1);
});
