/* ─────────────────────────────────────────────────────────────────────────────
   newswire-podcast-rss — RSS 2.0 feed for "Above the Fold" so Spotify,
   Apple Podcasts, Overcast, Pocket Casts, etc. can ingest it.

   GET /press/above-the-fold.xml

   Enumerates the rolling episode index (newswire_briefings_meta/index)
   and emits one <item> per episode, newest first. Each <item>'s audio
   URL resolves to the per-episode blob via ?episode=<key>.

   Submit this URL to:
   - Spotify for Podcasters: https://podcasters.spotify.com/
   - Apple Podcasts Connect: https://podcasts.apple.com/
   - Pocket Casts: auto-discovers most feeds
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');
const { readEpisodeIndex } = require('./_briefing-helpers');

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

function buildItemXml(meta) {
  if (!meta || !meta.episode_key || !meta.generated_at) return '';
  const episodeTitle = `Above the Fold - ${new Date(meta.generated_at).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })}`;
  const audioFull = SITE + (meta.audio_url || `/.netlify/functions/newswire-briefing-audio?episode=${encodeURIComponent(meta.episode_key)}`);
  const guid = `etl-newswire-atf-${meta.episode_key}`;
  const piecesList = (meta.pieces || [])
    .map(p => `- ${(p.desk_label || p.desk || '').toString()}: ${p.title}`)
    .join('\n');
  const episodeDescription = `Today's top stories on the ETL Newswire, briefed in under five minutes by Marcus Reyes and the desk reporters.\n\nIn this briefing:\n${piecesList}\n\nMore at ${SITE}/press`;
  const durationStr = meta.duration_label
    ? `<itunes:duration>${esc(meta.duration_label)}</itunes:duration>`
    : '';
  // length attribute on enclosure: byte size if we know it, else 0. Apple
  // Podcasts uses this for download progress estimates. 0 is allowed.
  const byteSize = meta.byte_size ? String(meta.byte_size) : '0';

  return `
    <item>
      <title>${esc(episodeTitle)}</title>
      <description>${esc(episodeDescription)}</description>
      <pubDate>${rfc2822(meta.generated_at)}</pubDate>
      <enclosure url="${esc(audioFull)}" type="audio/mpeg" length="${byteSize}"/>
      <guid isPermaLink="false">${esc(guid)}</guid>
      <link>${esc(SITE + '/press')}</link>
      <itunes:author>${esc(SHOW.author)}</itunes:author>
      <itunes:summary>${esc(episodeDescription)}</itunes:summary>
      <itunes:explicit>${SHOW.explicit}</itunes:explicit>
      <itunes:episodeType>full</itunes:episodeType>
      ${durationStr}
    </item>`;
}

exports.handler = async (event) => {
  try { connectLambda(event); } catch (_) {}

  const metaStore = getStore('newswire_briefings_meta');

  // Read the index. Fall back to legacy 'latest'-only behavior if the
  // index is missing or empty (e.g. very first deploy before any
  // backdate run, but after the live cron has fired).
  let index = [];
  try {
    index = await readEpisodeIndex();
  } catch (err) {
    console.error('[podcast-rss] index read failed', err && err.message);
  }

  let items = '';
  let lastBuild = null;

  if (index.length) {
    // Fetch each episode's meta in parallel. The index is capped at 60
    // entries (INDEX_MAX in _briefing-helpers), so worst case ~60 blob
    // reads per RSS request. Aggressive Cache-Control below keeps actual
    // requests rare.
    const metas = await Promise.all(index.map(entry =>
      metaStore.get(entry.key, { type: 'json' }).catch(err => {
        console.error('[podcast-rss] meta read failed for', entry.key, err && err.message);
        return null;
      })
    ));
    const itemXmls = metas.filter(Boolean).map(buildItemXml).filter(Boolean);
    items = itemXmls.join('');
    // Most-recent episode timestamp is the channel-level lastBuild.
    const newest = metas.find(Boolean);
    if (newest && newest.generated_at) lastBuild = rfc2822(newest.generated_at);
  } else {
    // Legacy fallback: pre-index meta only had 'latest'. Keep the feed
    // alive with one item rather than empty.
    try {
      const latest = await metaStore.get('latest', { type: 'json' });
      if (latest) {
        // Older 'latest' entries may not have episode_key. Synthesize one.
        if (!latest.episode_key && latest.generated_at) {
          latest.episode_key = 'latest';
        }
        items = buildItemXml(latest);
        if (latest.generated_at) lastBuild = rfc2822(latest.generated_at);
      }
    } catch (err) {
      console.error('[podcast-rss] legacy latest read failed', err && err.message);
    }
  }

  if (!lastBuild) lastBuild = new Date().toUTCString();

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
