/* ─────────────────────────────────────────────────────────────────────────────
   etl-banter-feed — returns the live agency floor banter messages.

   GET /.netlify/functions/etl-banter-feed
   Returns: { messages: [{agent, role, time, ts, message}] }

   Messages are newest-first. The cron (etl-banter-cron) writes here every
   2 minutes. broadcast.html polls this every 10 seconds and appends any
   message with ts > lastSeen to the chat feed.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(status, obj) {
  return {
    statusCode: status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(obj),
  };
}

/* ── Canonical agent -> portrait map ──────────────────────────────────────────
   SINGLE SOURCE OF TRUTH for chat avatars. Every surface that shows this feed
   (broadcast.html, studio.html The Floor, etl-staffing.html) renders the
   `image` field this function attaches, with its own initials fallback. Add an
   agent or fix a portrait HERE and every surface updates. Filenames resolve to
   /agents/<file> on the site / CDN. Lifted from broadcast.html's proven map.
   Jen Lopez rotates her outfit by weekday, so she is resolved dynamically. */
const CAST_IMG = {
  'Auggie': 'Auggie_zoom_eyes_open.jpg',
  'Jax Rivera': 'Jax_Rivera_eyes_open.jpg',
  'Yuki Mendel': 'Yuki_Mendel_eyes_open.jpg',
  'Leo Vance': 'Leo_Vance_eyes_open.jpg',
  'Iris': 'Iris_Chat_Eyes_Open.jpg',
  'Alicia James': 'Alicia_James_eyes_open.jpg',
  'Sasha Moreno': 'Sasha_Moreno_eyes_open.jpg',
  'Rowan Tate': 'Rowan_Tate_eyes_open.jpg',
  'Mara Rivera': 'Mara_Rivera.jpg',
  'Wren Calloway': 'Wren_eyes_open.jpg',
  'Carol Haynes': 'Carol_eyes_open.jpg',
  'Matthew Vance': 'Matthew_eyes_open.jpg',
  'Arjun Mehta': 'Arjun_eyes_open.jpg',
  'Zara Cole': 'Zara_eyes_open.jpg',
  'Reid Callum': 'Reid_eyes_open.jpg',
  'Grant Ellis': 'Grant_eyes_open.jpg',
  'Jules Hartley': 'Jules_eyes_open.jpg',
  'Imani Brooks': 'Imani_Brooks.jpg',
  'Mateo Rivera': 'Mateo_Zoom_Eyes_Open.jpg',
  'Mei Sato': 'Mei_Zoom_Call_Eyes_Open.jpg',
  'Dr. O': 'Dr_O_Eyes_Open.jpg',
  'Selene Voss': 'Selene_eyes_open.jpg',
  'Astrid Lund': 'Astrid_eyes_open.jpg',
  'Osei Mensah': 'Osei_eyes_open.jpg',
  'Cassidy Mercer': 'Cassidy_eyes_open.jpg',
  'Devon Sloane': 'Devon_eyes_open.jpg',
  'Nadia Hassan': 'nutritionist_eyes_open.jpg',
  'Silas Hill': 'forager_eyes_open.jpg',
  'Amara Nwosu': 'herbalist_eyes_open.jpg',
  'Reece Ashford': 'Reece_eyes_open.jpg',
  'Coach Dom Castellanos': 'Coach_Dom_Eyes_open.png',
  'Dr. Lena Brandt DPT': 'Dr_Lena_eyes_open.png',
  'Noor Haddad': 'Noor_eyes_open.png',
  'Dr. Sana Qureshi': 'Sana_eyes_open.png',
  'Wyatt Cooper': 'mixologist_eyes_open.jpg',
  'Sasha Park': 'Sasha_Park.jpg',
  'Marceline Smith': 'Marceline_Smith_Profile.jpg',
  'Simone Beaumont': 'Simone_Beaumont_Profile.jpg',
  'Dilan Wolf': 'Dilan_Wolf_Profile.jpg',
  'Bea Vega': 'Bea_Open.png',
  'The Professor': 'The_Professor_eyes_open.jpg',
  'Pri Nanduri': 'Priya_eyes_open.jpg',
  'Priya Anand': 'Priya_eyes_open.jpg',
  'Eli': 'fact_checker_eyes_open.jpg',
  'Ms. Ivy': 'Ivy_profile.jpg',
  'Maeve MJ Johnson': 'gardner_eyes_open.jpg',
  'Jaque': 'Jaque_Tremblay_eyes_open.jpg',
  'Dr. Henry': 'dr_chen_eyes_open.png',
  'Dr. Henry Chen, RPh': 'dr_chen_eyes_open.png',
  'Arun': 'Arun_eyes_open.jpg',
  'Dr. Claire': 'dr_eyes_open.jpg',
  'Grey': 'Grey_Open.jpg',
  'Marcus Holt': 'Marcus_eyes_open.jpg',
  'Raymond Chen': 'Raymond_eyes_open.jpg',
  'Chris': 'Chris_Artist_Eyes_Open.jpg',
  'Margo': 'Margo_fun.jpg',
  'Maddie': 'Interviewer_Maddie_Open.jpg',
  'The Podcast Hosts': 'Podcast_hosts_Open.jpg',
  'Kimberly Pass': 'Kimberly_Pass_eyes_open.jpg',
  'Margaret Applewood': 'margaret_call_blink.png',
  'Mun': 'Mun_Eyes_open.png',
  'Goh Kai-Mun': 'Mun_Eyes_open.png',
  'Jess Ramirez': 'Jess_Ramirez.png',
  'Admiral Grace Nakamura': 'Grace_eyes_open.jpg',
  'Grace': 'Grace_eyes_open.jpg',
  'Delia Marsh': 'Delia_Marsh_Eyes_Open.png',
  'Antonio Crosby': 'Antonio_Crosby_Profile.png',
  'Amelie Griffith': 'Amelie_Griffith_Profile.png',
  'Ezra Doyle': 'Ezra_Doyle_Profile.png',
  'Annika Bender': 'Annika_Bender_Profile.png',
  'Walt Brenner': 'Walt_Brenner_profile.png',
  'Elke Vogel': 'Elke_Vogel.png',
  'Theo Okafor': 'Theo_Okafor.png',
  'Renee Kovac': 'Renee_Kovac.png',
  'Karen Bishop': 'Karen_Bishop.png',
  'Frank Donovan': 'Frank_Donovan.png',
  'Sneha Desai': 'Sneha_Desai_eyes_open.jpg',
  'Ayanna Cole': 'Ayanna_Cole_eyes_open.jpg',
  'Benjamin Reed': 'Benjamin_Reed_Eyes_Open.jpg',
  'Eli Adler': 'Eli_Adler_profile.png',
  'Ruben Hart': 'Ruben_Hart_eyes_open.png',
  'Camille Lefèvre': 'Camille_Lefevre_eyes_open.png',
  'Luca Brunner': 'Luca_Brunner_eyes_open.png',
  'Von Gupta': 'Von_eyes_open.png',
};

function jenFile() { return 'Jen' + ((new Date().getDay() % 7) + 1) + '_profile.jpg'; }

// Exact match, then first-name fallback (mirrors broadcast.html's avatar()).
function resolveImage(name) {
  if (!name) return null;
  if (name === 'Jen Lopez' || name === 'Jen') return jenFile();
  if (CAST_IMG[name]) return CAST_IMG[name];
  const first = String(name).split(/\s+/)[0];
  for (const k in CAST_IMG) { if (k.split(/\s+/)[0] === first) return CAST_IMG[k]; }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'method not allowed' });

  try { connectLambda(event); } catch (_) {}
  const store = getStore('etl_banter');

  try {
    const msgs = await store.get('messages', { type: 'json' });
    // Attach the canonical portrait so every surface renders the same avatar.
    const list = (Array.isArray(msgs) ? msgs : []).map((m) => {
      if (!m) return m;
      const image = m.image || resolveImage(m.agent) || null;
      return image ? { ...m, image } : m;
    });
    return json(200, { messages: list });
  } catch (_) {
    return json(200, { messages: [] });
  }
};
