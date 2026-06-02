/* ─────────────────────────────────────────────────────────────────────────────
   newswire-podcast-rss — RSS 2.0 feed for "Above the Fold" so Spotify,
   Apple Podcasts, Overcast, Pocket Casts, etc. can ingest it.

   GET /press/above-the-fold.xml

   For now we expose the LATEST briefing as a single episode. Future work:
   store a rolling history of briefings (mp3 + metadata) and list multiple
   episodes in the feed.

   Submit this URL to:
   - Spotify for Podcasters: https://podcasters.spotify.com/
   - Apple Podcasts Connect: https://podcasts.apple.com/
   - Pocket Casts: auto-discovers most feeds
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const SITE = 'https://emerging-tech-lab.com';
const SHOW = {
  title: 'Above the Fold from ETL Newswire',
  author: 'ETL Newswire',
  owner_name: 'Emerging Technologies Laboratory',
  owner_email: 'press@emerging-tech-lab.com',
  description: 'A daily wire-service audio briefing from the ETL Newswire desk. Marcus Reyes anchors; each staff reporter speaks their own story. The top stories worth your morning, above the fold.',
  link: SITE + '/press',
  image: SITE + '/agents/newswire_logo.png',
  language: 'en-us',
  category: 'News',
  subcategory: 'Daily News',
  explicit: 'false',
  copyright: 'Copyright Emerging Technologies Laboratory',
};

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

function rfc2822(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(+d)) return new Date(0).toUTCString();
    return d.toUTCString();
  } catch (_) { return new Date(0).toUTCString(); }
}

exports.handler = async (event) => {
  try { connectLambda(event); } catch (_) {}

  let meta = null;
  try {
    const store = getStore('newswire_briefings_meta');
    meta = await store.get('latest', { type: 'json' });
  } catch (err) {
    console.error('[podcast-rss] meta read failed', err && err.message);
  }

  const lastBuild = meta && meta.generated_at ? rfc2822(meta.generated_at) : new Date().toUTCString();

  let items = '';
  if (meta && meta.audio_url && meta.generated_at) {
    const episodeTitle = `Above the Fold - ${new Date(meta.generated_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`;
    const audioFull = SITE + meta.audio_url;
    // GUID has to be stable per episode. Use generated_at timestamp.
    const guid = `etl-newswire-atf-${meta.generated_at}`;
    const piecesList = (meta.pieces || [])
      .map(p => `- ${(p.desk_label || p.desk || '').toString()}: ${p.title}`)
      .join('\n');
    const episodeDescription = `Today's top stories on the ETL Newswire, briefed in under five minutes by Marcus Reyes and the desk reporters.\n\nIn this briefing:\n${piecesList}\n\nMore at ${SITE}/press`;

    items = `
    <item>
      <title>${esc(episodeTitle)}</title>
      <description>${esc(episodeDescription)}</description>
      <pubDate>${rfc2822(meta.generated_at)}</pubDate>
      <enclosure url="${esc(audioFull)}" type="audio/mpeg" length="0"/>
      <guid isPermaLink="false">${esc(guid)}</guid>
      <link>${esc(SITE + '/press')}</link>
      <itunes:author>${esc(SHOW.author)}</itunes:author>
      <itunes:summary>${esc(episodeDescription)}</itunes:summary>
      <itunes:explicit>${SHOW.explicit}</itunes:explicit>
      <itunes:episodeType>full</itunes:episodeType>
    </item>`;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(SHOW.title)}</title>
    <link>${esc(SHOW.link)}</link>
    <description>${esc(SHOW.description)}</description>
    <language>${esc(SHOW.language)}</language>
    <copyright>${esc(SHOW.copyright)}</copyright>
    <lastBuildDate>${lastBuild}</lastBuildDate>
    <atom:link href="${esc(SITE + '/press/above-the-fold.xml')}" rel="self" type="application/rss+xml"/>
    <itunes:author>${esc(SHOW.author)}</itunes:author>
    <itunes:summary>${esc(SHOW.description)}</itunes:summary>
    <itunes:owner>
      <itunes:name>${esc(SHOW.owner_name)}</itunes:name>
      <itunes:email>${esc(SHOW.owner_email)}</itunes:email>
    </itunes:owner>
    <itunes:image href="${esc(SHOW.image)}"/>
    <itunes:category text="${esc(SHOW.category)}">
      <itunes:category text="${esc(SHOW.subcategory)}"/>
    </itunes:category>
    <itunes:explicit>${SHOW.explicit}</itunes:explicit>
    <itunes:type>episodic</itunes:type>${items}
  </channel>
</rss>`;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=900',
    },
    body: xml,
  };
};
