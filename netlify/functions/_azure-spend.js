/* ── _azure-spend — read what each Azure service has cost, and say who is at risk, added 2026-10-14, Dr. O ───────────
   For Microsoft for Startups milestone 3 ($25,000): 5+ Azure workloads, each at or above $1 in spend, held for about
   60 days. This reads the subscription's daily cost per service from Azure Cost Management, works out which services are
   counting, which are going quiet, and which have fallen below, and writes a plain summary.

   It only READS. It needs a service principal with the "Cost Management Reader" role on the subscription:
     AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_SUBSCRIPTION_ID
   Optional:
     AZURE_TARGET_WORKLOADS   how many must be counting (default 5; 7 for the $50,000 milestone, 10 for $150,000)
     AZURE_SPEND_WINDOW_DAYS  default 60

   WHAT "AT OR ABOVE $1" MEANS HERE. Microsoft's page says each workload needs at least $1 in spend and must stay above
   it for the 60 days. It does not say whether that is per month or over the whole window, so this tracks the stricter
   reading that is easy to act on: a service is OK if it has spent at least $1 in the last 30 days AND has some spend in
   the last 7. Check the usage view in the Microsoft for Startups portal for how Microsoft itself counts it.
   ─────────────────────────────────────────────────────────────────────────────────────────────────────────────── */

const TIMEOUT_MS = 30000;

function need(name) {
  const v = process.env[name];
  return v ? String(v).trim() : '';
}

function configured() {
  return !!(need('AZURE_TENANT_ID') && need('AZURE_CLIENT_ID') && need('AZURE_CLIENT_SECRET') && need('AZURE_SUBSCRIPTION_ID'));
}

async function getJson(url, opts) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch (_) {}
    if (!r.ok) {
      const msg = (j && (j.error_description || (j.error && (j.error.message || j.error)))) || text.slice(0, 200);
      const err = new Error('HTTP ' + r.status + ': ' + String(msg).slice(0, 240));
      err.status = r.status;
      throw err;
    }
    return j;
  } finally { clearTimeout(t); }
}

async function token() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: need('AZURE_CLIENT_ID'),
    client_secret: need('AZURE_CLIENT_SECRET'),
    scope: 'https://management.azure.com/.default',
  });
  const j = await getJson('https://login.microsoftonline.com/' + encodeURIComponent(need('AZURE_TENANT_ID')) + '/oauth2/v2.0/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
  });
  if (!j || !j.access_token) throw new Error('no access token from Azure');
  return j.access_token;
}

function ymd(d) { return d.toISOString().slice(0, 10); }

/* Daily cost per service for the last `days` days. Returns [{ date: 'YYYY-MM-DD', service, cost }]. */
async function fetchDaily(days) {
  const tok = await token();
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86400000);
  const body = {
    type: 'ActualCost',
    timeframe: 'Custom',
    timePeriod: { from: ymd(from) + 'T00:00:00Z', to: ymd(to) + 'T23:59:59Z' },
    dataset: {
      granularity: 'Daily',
      aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
      grouping: [{ type: 'Dimension', name: 'ServiceName' }],
    },
  };
  let url = 'https://management.azure.com/subscriptions/' + encodeURIComponent(need('AZURE_SUBSCRIPTION_ID')) +
    '/providers/Microsoft.CostManagement/query?api-version=2023-11-01';
  const out = [];
  for (let page = 0; url && page < 10; page++) {
    const j = await getJson(url, {
      method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const p = (j && j.properties) || {};
    const cols = (p.columns || []).map((c) => String(c.name).toLowerCase());
    const iCost = cols.indexOf('cost') >= 0 ? cols.indexOf('cost') : cols.indexOf('pretaxcost');
    const iDate = cols.indexOf('usagedate');
    const iSvc = cols.indexOf('servicename');
    (p.rows || []).forEach((row) => {
      const raw = String(row[iDate]);
      const date = raw.length === 8 ? raw.slice(0, 4) + '-' + raw.slice(4, 6) + '-' + raw.slice(6, 8) : raw.slice(0, 10);
      out.push({ date, service: String(row[iSvc] || 'Unknown'), cost: Number(row[iCost]) || 0 });
    });
    url = p.nextLink || null;
  }
  return out;
}

/* Turn the daily rows into a summary. `now` is injectable so it can be tested. */
function analyze(rows, opts) {
  const o = opts || {};
  const target = o.target || Number(need('AZURE_TARGET_WORKLOADS')) || 5;
  const windowDays = o.windowDays || Number(need('AZURE_SPEND_WINDOW_DAYS')) || 60;
  const now = o.now ? new Date(o.now) : new Date();
  const today = ymd(now);
  const dayN = (n) => ymd(new Date(now.getTime() - n * 86400000));
  const d30 = dayN(29), d7 = dayN(6);

  const by = {};
  rows.forEach((r) => {
    const s = by[r.service] || (by[r.service] = { service: r.service, byDate: {}, total: 0, last30: 0, last7: 0, activeDays: 0 });
    s.byDate[r.date] = (s.byDate[r.date] || 0) + r.cost;
  });
  const services = Object.values(by).map((s) => {
    Object.keys(s.byDate).forEach((d) => {
      const c = s.byDate[d];
      if (c > 0) s.activeDays++;
      s.total += c;
      if (d >= d30) s.last30 += c;
      if (d >= d7) s.last7 += c;
    });
    s.status = s.last30 >= 1 ? (s.last7 > 0 ? 'ok' : 'quiet') : (s.total > 0 ? 'below' : 'none');
    return s;
  }).filter((s) => s.total > 0)
    .sort((a, b) => b.last30 - a.last30);

  const counting = services.filter((s) => s.status === 'ok');
  const quiet = services.filter((s) => s.status === 'quiet');
  const below = services.filter((s) => s.status === 'below');

  // The streak: how many days in a row, ending today, had at least `target` services with 30-day spend of $1 or more.
  // An estimate of Microsoft's 60-day clock, not Microsoft's own number.
  let streak = 0;
  for (let back = 0; back < windowDays; back++) {
    const end = dayN(back);
    const start = ymd(new Date(new Date(end).getTime() - 29 * 86400000));
    const n = services.filter((s) => {
      let sum = 0;
      for (const d of Object.keys(s.byDate)) if (d >= start && d <= end) sum += s.byDate[d];
      return sum >= 1;
    }).length;
    if (n >= target) streak++; else break;
  }

  const gap = Math.max(0, target - counting.length);
  const headline = counting.length >= target && quiet.length === 0
    ? 'On track: ' + counting.length + ' of ' + target + ' workloads counting, ' + streak + ' day' + (streak === 1 ? '' : 's') + ' in a row.'
    : 'ACTION NEEDED: ' + counting.length + ' of ' + target + ' workloads counting' +
      (quiet.length ? ', ' + quiet.length + ' gone quiet this week' : '') + (gap ? ', ' + gap + ' short' : '') + '.';
  return {
    asOf: today, target, windowDays, streak,
    countingNow: counting.length, onTrack: counting.length >= target && quiet.length === 0,
    headline,
    services: services.map((s) => ({
      service: s.service, status: s.status,
      last30: +s.last30.toFixed(2), last7: +s.last7.toFixed(2), total: +s.total.toFixed(2), activeDays: s.activeDays,
    })),
    actions: []
      .concat(quiet.map((s) => s.service + ' has had no spend in 7 days. Use it today, or it may drop out of the count.'))
      .concat(below.map((s) => s.service + ' is under $1 for the last 30 days, so it is not counting.'))
      .concat(gap ? ['You are ' + gap + ' workload' + (gap === 1 ? '' : 's') + ' short of ' + target + '. Start using another Azure service for real work.'] : []),
  };
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function usd(n) { return '$' + Number(n).toFixed(2); }

function renderHtml(sum, extra) {
  const badge = { ok: '#1B7F3B', quiet: '#B26A00', below: '#B3261E' };
  const label = { ok: 'Counting', quiet: 'Gone quiet', below: 'Under $1' };
  const rows = sum.services.map((s) =>
    '<tr><td>' + esc(s.service) + '</td><td><span style="color:#fff;background:' + badge[s.status] + ';padding:2px 8px;border-radius:999px;font-size:12px">' +
    label[s.status] + '</span></td><td style="text-align:right">' + usd(s.last30) + '</td><td style="text-align:right">' + usd(s.last7) +
    '</td><td style="text-align:right">' + usd(s.total) + '</td><td style="text-align:right">' + s.activeDays + '</td></tr>').join('');
  const acts = sum.actions.length ? '<ul>' + sum.actions.map((a) => '<li>' + esc(a) + '</li>').join('') + '</ul>' : '<p>Nothing needs doing.</p>';
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Azure spend tracker</title></head><body style="font:15px system-ui,sans-serif;max-width:860px;margin:24px auto;padding:0 16px;color:#16212B">' +
    '<h1 style="font-size:22px">Azure spend tracker</h1>' +
    '<p style="font-size:18px;font-weight:600;color:' + (sum.onTrack ? '#1B7F3B' : '#B3261E') + '">' + esc(sum.headline) + '</p>' +
    '<p>As of ' + esc(sum.asOf) + '. Target: ' + sum.target + ' workloads, each at or above $1 over the last 30 days with some use this week. ' +
    'The streak is an estimate of Microsoft\'s 60-day clock, not Microsoft\'s own number.</p>' +
    '<h2 style="font-size:17px">What to do</h2>' + acts +
    '<table style="border-collapse:collapse;width:100%"><thead><tr style="text-align:left;border-bottom:2px solid #16212B">' +
    '<th>Service</th><th>Status</th><th style="text-align:right">30 days</th><th style="text-align:right">7 days</th><th style="text-align:right">Total</th><th style="text-align:right">Days used</th></tr></thead><tbody>' +
    rows + '</tbody></table>' + (extra || '') + '</body></html>';
}

/* Returns { sent, to, reason }. Never throws. */
async function emailSummary(sum) {
  const key = need('RESEND_API_KEY');
  const to = (need('ALERT_EMAIL_TO') || need('GC_ORDER_NOTIFY') || 'drterryoroszi@emerging-tech-lab.com');
  if (!key) return { sent: false, to, reason: 'no RESEND_API_KEY' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'ETL Azure Tracker <drterryoroszi@emerging-tech-lab.com>',
        to: [to],
        subject: (sum.onTrack ? '[Azure OK] ' : '[Azure ACTION] ') + sum.headline,
        html: renderHtml(sum),
      }),
    });
    if (!r.ok) return { sent: false, to, reason: 'email service said ' + r.status };
    return { sent: true, to, reason: 'ok' };
  } catch (e) {
    return { sent: false, to, reason: (e && e.message) || 'email failed' };
  }
}

module.exports = { configured, fetchDaily, analyze, renderHtml, emailSummary };
