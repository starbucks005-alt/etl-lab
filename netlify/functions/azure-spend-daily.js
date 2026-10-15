/* azure-spend-daily — scheduled once a day (see netlify.toml). Reads Azure spend per service, keeps the latest summary,
   and emails it. Added 2026-10-14, Dr. O.
   The email always goes out, so no email is itself the warning that the tracker stopped. The subject says OK or
   ACTION. Does nothing, and says why, until the Azure reader settings exist (see _azure-spend.js). */

const { getStore, connectLambda } = require('@netlify/blobs');
const spend = require('./_azure-spend.js');

exports.handler = async (event) => {
  try { connectLambda(event); } catch (_) {}
  if (!spend.configured()) {
    console.warn('[azure-spend-daily] not configured: needs AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_SUBSCRIPTION_ID');
    return { statusCode: 200, body: 'not configured' };
  }
  let sum;
  try {
    const windowDays = Number(process.env.AZURE_SPEND_WINDOW_DAYS) || 60;
    const rows = await spend.fetchDaily(windowDays);
    sum = spend.analyze(rows);
  } catch (e) {
    console.error('[azure-spend-daily] could not read Azure cost:', e && e.message);
    sum = {
      asOf: new Date().toISOString().slice(0, 10), target: 0, windowDays: 0, streak: 0, countingNow: 0, onTrack: false,
      headline: 'ACTION NEEDED: the tracker could not read Azure cost (' + String((e && e.message) || e).slice(0, 160) + ').',
      services: [], actions: ['Check the tracker settings: tenant, client id, secret and subscription id, and that the principal has Cost Management Reader.'],
    };
  }
  try {
    const store = getStore('azure-spend');
    await store.set('latest', JSON.stringify(sum), { metadata: { asOf: sum.asOf } });
    await store.set('day/' + sum.asOf, JSON.stringify(sum));
  } catch (e) {
    console.error('[azure-spend-daily] could not save the summary:', e && e.message);
  }
  const mail = await spend.emailSummary(sum);
  console.log('[azure-spend-daily]', sum.headline, '| email:', mail.sent ? 'sent' : 'not sent (' + mail.reason + ')');
  return { statusCode: 200, body: sum.headline };
};
