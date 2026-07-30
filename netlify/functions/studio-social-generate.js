/* ─────────────────────────────────────────────────────────────────────────────
   studio-social-generate

   Social post engine. Takes a business + agent voice + platform + subject and
   returns one platform-formatted post with character count and a suggested
   posting time. Owner-agnostic: any caller describes its own business, so this
   backs both Dr. O's Studio Social Posts tool and anything sold to a buyer.

   POST body:
     agent      'zara' | 'sneha' | 'ayanna'          (required)
     platform   'x' | 'bluesky' | 'linkedin' | 'facebook' | 'instagram' | 'threads'
     subject    what the post is about               (required)
     site_name / site_url / site_context             describe your own business
     site          alternatively, a preset key from your OWN voice profile
     voice_profile id of a file in data/voice-profiles/. Optional. Supplies
                   voice_core, agent_prompts, required_hashtags, site_presets
                   and closers. Omit it and you get the generic voice built
                   from ownerName + companyName. This engine has no default
                   owner and no built-in identity of its own.
     ownerName / companyName                          whose voice, generically
     cta           optional closer key, resolved from your profile's closers
   Returns: { post, hashtags, notes, charCount, charLimit, platform, agent, suggestedTime }

   Auth: this endpoint is called from the Studio (which is already auth-gated
   by Supabase). No additional auth layer here yet; relies on the Studio's
   client-side login wall. When abuse becomes a concern, add a server-side
   JWT check against the Supabase project.
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;

const MODEL = 'claude-sonnet-4-6';

/* JWT validation against Supabase. Inline so we don't add a new dependency.
   Anon key is safe to embed (public by design); Supabase does the actual
   signature/expiration check when we call /auth/v1/user with the token. */
const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

async function validateRequest(event) {
  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return { ok: false, reason: 'no_bearer' };
  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false, reason: 'empty_token' }; { const _ok = require('./_owner-auth.js').ownerUser(token); if (_ok) return { ok: true, user: _ok }; }
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token, 'apikey': SUPABASE_ANON_KEY },
    });
    if (!r.ok) return { ok: false, reason: 'supabase_rejected_' + r.status };
    const user = await r.json();
    if (!user || !user.id) return { ok: false, reason: 'no_user' };
    return { ok: true, user };
  } catch (e) {
    return { ok: false, reason: 'fetch_failed', error: e && e.message };
  }
}




/* Voice profiles. THIS ENGINE HAS NO OWNER.
   ─────────────────────────────────────────────────────────────────────────
   Until 2026-07-30 it did. Dr. Oroszi's Forbes voice corpus, her three
   personal hashtags, a map of her 25 platforms, and three agent personas
   written as "AS Dr. Terry Oroszi" all lived in this file, with an isTerry
   fork through the middle and everyone else routed to a generic fallback.
   That is Founder Studio's mistake: the owner as a code branch and the
   buyer as the exception. It does not survive being sold.

   Now every one of those lives in data/voice-profiles/<id>.json, and Dr. O
   loads hers exactly the way a buyer loads theirs. A caller names a profile
   or names none. Naming none is normal and gives the generic owner-aware
   voice built below, which needs nothing but a name and a company.

   A profile supplies: voice_core, agent_prompts{}, required_hashtags[],
   site_presets{}, closers{}. Every field is optional; a missing one falls
   through to the generic path rather than to anybody's personal data. */
const path = require('path');

function loadVoiceProfile(id) {
  // Same candidate-path + BOM-strip pattern the other functions use: editors
  // and PowerShell's -Encoding utf8 prepend EF BB BF, and JSON.parse throws
  // on it, which is exactly how provisioned buyers once silently fell back
  // to a default config.
  if (!id || !/^[a-z0-9._-]+$/i.test(id)) return null;   // no path traversal
  const file = id + '.json';
  const candidates = [
    path.join(__dirname, 'data', 'voice-profiles', file),
    path.join(__dirname, '..', '..', 'data', 'voice-profiles', file),
    path.join(process.cwd(), 'data', 'voice-profiles', file),
  ];
  const fs = require('fs');
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        return JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
      }
    } catch (_) {}
  }
  console.warn('[social-generate] voice profile not found: ' + id + ' (falling back to the generic voice)');
  return null;
}

/* The generic voice and the three writers now live in _social-voice.js so
   the ETL Design relay and this tool share one copy. A second copy is how a
   persona quietly drifts into two different people (2026-07-30). Nothing in
   that module belongs to any owner; personal voice data stays in
   data/voice-profiles/<id>.json. */
const { AGENTS, buyerVoiceCore, buyerAgentPrompt } = require('./_social-voice.js');

const PLATFORMS = {
  x: {
    name: 'X (Twitter)', charLimit: 280, idealLength: 240,
    format: '280 character hard maximum. Single post, no threads. Conversational. 1 to 3 hashtags maximum, fitted to the post.',
    bestTime: { day: 'Tuesday through Thursday', window: '8 to 10am OR 6 to 9pm local time', reason: 'peak X engagement windows are morning commute and after-dinner scroll' },
  },
  bluesky: {
    name: 'Bluesky', charLimit: 300, idealLength: 260,
    format: '300 character hard maximum. Single post. More substantive than X, Bluesky audience reads carefully. 0 to 2 hashtags only (Bluesky uses them less). No threading.',
    bestTime: { day: 'Weekdays', window: '9 to 11am local time', reason: 'Bluesky audience is most active mornings; algorithm is less aggressive so timing matters less than on commercial platforms' },
  },
  linkedin: {
    name: 'LinkedIn', charLimit: 3000, idealLength: 1300,
    format: 'Long-form professional. 1300 characters ideal. Lead with a hook line that earns the click-to-expand. Use line breaks for breathability, every 1 or 2 sentences. End with a question or invitation to engage. 3 to 5 hashtags at the bottom, professional categories not vibes.',
    bestTime: { day: 'Tuesday through Thursday', window: '8 to 10am OR 12pm local time', reason: 'professionals check LinkedIn during morning coffee or lunch breaks; B2B engagement peaks midweek' },
  },
  facebook: {
    name: 'Facebook', charLimit: 5000, idealLength: 250,
    format: 'Conversational. 80 characters gets best engagement but 250 is ideal for substance. Friendly tone, Facebook audience is broader and less professional than LinkedIn. 0 to 2 hashtags. A question or invitation at the end works well.',
    bestTime: { day: 'Wednesday or Thursday', window: '1 to 4pm local time', reason: 'Facebook engagement peaks midweek afternoons; mornings get buried in the algorithm' },
  },
  instagram: {
    name: 'Instagram', charLimit: 2200, idealLength: 150,
    format: 'Caption-style. First 125 characters show in feed without a "more" tap, so put the hook there. Hashtags are critical: 5 to 15, mix broad and niche. Line breaks help. Emojis acceptable where they fit the voice.',
    bestTime: { day: 'Tuesday through Friday', window: '11am to 1pm OR 7 to 9pm local time', reason: 'Instagram peak engagement at lunch break and after-dinner scroll' },
  },
  threads: {
    name: 'Threads', charLimit: 500, idealLength: 400,
    format: '500 character hard maximum. Casual, conversation-starter tone. Hashtags less critical than IG, use 0 to 3. Threads audience leans toward discussion, end with a hook for replies.',
    bestTime: { day: 'Tuesday through Friday', window: '11am to 1pm OR 7 to 9pm local time', reason: 'Threads audience mirrors Instagram timing; mid-day and evening are peak' },
  },
};

function extractJson(raw) {
  let s = (raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(s); } catch (_) {}
  const first = s.indexOf('{'); const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch (_) {}
  }
  throw new Error('Could not parse model response as JSON');
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'method not allowed' };

  // Auth gate: must have valid Supabase JWT or we reject before spending
  // Anthropic API credits on anonymous requests.
  const auth = await validateRequest(event);
  if (!auth.ok) {
    return {
      statusCode: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'unauthorized', reason: auth.reason }),
    };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'invalid json' }) }; }

  const { site, agent, platform, subject, cta, customUrl, customContext, ownerName, companyName,
          site_name, site_url, site_context } = body;

  // Whose voice this post is in. A named profile, or nobody's.
  //
  // This used to read:
  //   isTerry = !ownerNameTrimmed || ownerNameTrimmed === 'Dr. Terry Oroszi'
  // Two faults: tenancy decided by matching a name string, and a MISSING
  // name defaulting to the owner. Any caller that forgot to pass ownerName,
  // or passed it before config finished loading, got a post written "AS Dr.
  // Terry Oroszi" in her Forbes voice, stamped with her personal hashtags.
  // Sold to a buyer, that is the whole ballgame.
  //
  // There is no owner branch now. voice_profile names a file; no file means
  // the generic voice. Unknown fails to generic, which is wrong-but-harmless,
  // never to a real person's identity, which is not (2026-07-30).
  const ownerNameTrimmed = (ownerName || '').trim();
  const companyNameTrimmed = (companyName || '').trim();
  const profile = loadVoiceProfile((body.voice_profile || '').trim()) || null;

  // What this post is about. Order matters, and it is: the caller's OWN site
  // first, then the legacy 'custom' shape, then a named preset.
  //
  // SITES below is a list of Dr. O's ~25 platforms. It used to be the only
  // real path, with a buyer's own site handled as the 'custom' special case.
  // That is backwards for an engine being sold: a buyer would open it and be
  // asked which of the landlord's platforms they are posting about. SITES is
  // now what it should always have been, the owner's saved presets, reachable
  // by key and never required. Any caller can just describe its own site
  // (2026-07-30). Follow-up: move SITES into owner config so the shared
  // engine carries no one's platform list at all.
  function hostOf(u) {
    return String(u || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/\/$/, '');
  }
  const explicitUrl  = (site_url || '').trim();
  const explicitName = (site_name || '').trim();
  let siteData;
  if (explicitUrl || explicitName) {
    const normalizedUrl = explicitUrl
      ? (/^https?:\/\//i.test(explicitUrl) ? explicitUrl : 'https://' + explicitUrl)
      : '';
    siteData = {
      // Name never falls back to the context paragraph. That was a real bug
      // on the old custom path: a whole sentence of context became the site's
      // NAME and the model dutifully wrote it into the post.
      name: explicitName || hostOf(normalizedUrl) || 'the business',
      url: normalizedUrl,
      context: (site_context || '').trim()
        || 'No further context was provided, so keep claims general and grounded only in the subject matter given.',
      fallbackImage: '/site-thumbs/ETL_Lab.png',
    };
  } else if (site === 'custom') {
    const url = (customUrl || '').trim();
    if (!url) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'customUrl is required when site is "custom"' }) };
    }
    const normalizedUrl = /^https?:\/\//i.test(url) ? url : 'https://' + url;
    siteData = {
      name: hostOf(normalizedUrl),
      url: normalizedUrl,
      context: (customContext || '').trim() || 'A site the client owns outside the ETL campus. No further context was provided, so keep claims general and grounded only in the subject matter given.',
      fallbackImage: '/site-thumbs/ETL_Lab.png',
    };
  } else {
    // Named preset out of the caller's OWN profile. The engine ships no
    // preset list; an owner's platforms travel with their profile file.
    siteData = (profile && profile.site_presets && profile.site_presets[site]) || null;
  }

  const agentData = AGENTS[agent];
  const platformData = PLATFORMS[platform];

  if (!siteData || !agentData || !platformData) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'missing or invalid: site, agent, or platform' }) };
  }
  if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'subject is required' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }) };
  }
  const client = new Anthropic({ apiKey });

  // Profile first, generic second, per field. A profile carrying a voice_core
  // but no agent_prompts still gets generic personas rather than none.
  const profileAgentPrompt = profile && profile.agent_prompts && profile.agent_prompts[agent];
  const voiceCore = (profile && profile.voice_core) || buyerVoiceCore(ownerNameTrimmed, companyNameTrimmed);
  const agentPromptText = profileAgentPrompt || buyerAgentPrompt(agent, ownerNameTrimmed, companyNameTrimmed);
  const requiredHashtags = (profile && Array.isArray(profile.required_hashtags)) ? profile.required_hashtags : [];
  const closer = (profile && profile.closers && cta && profile.closers[cta]) || '';

  const sys = voiceCore + '\n\n' +
    '---\n\n' +
    'STYLE TILT for this post (your job is to apply this tilt ON TOP OF the baseline voice above, not to replace it):\n\n' +
    agentPromptText + '\n\n' +
    'CONTEXT, the platform this post is about:\n' +
    'Name: ' + siteData.name + '\n' +
    (siteData.url ? ('URL: ' + siteData.url + '\n') : '') +
    'Context: ' + siteData.context + '\n\n' +
    'PLATFORM RULES, write for ' + platformData.name + ':\n' +
    platformData.format + '\n' +
    'Character limit: ' + platformData.charLimit + ' hard max, ' + platformData.idealLength + ' target.\n\n' +
    (siteData.url
      ? 'URL RULE, HARD: if you include a web link in the post, use EXACTLY the URL given above (' + siteData.url + '), character for character. Do not paraphrase it, shorten it, change the domain, drop the https, swap netlify.app for .com, or invent a different URL. If you are not sure of the URL, omit it from the post entirely. Inventing or misquoting a URL is the single worst thing you can do here.\n\n'
      // No URL supplied. Say so explicitly: left unsaid, the model invents a
      // plausible domain for the business and the post ships with a dead link.
      : 'URL RULE, HARD: no web link was supplied for this business. Do NOT include any URL in the post, and do NOT guess or construct one from the name. Write the post without a link.\n\n') +
    // Closers are a profile's own standing CTAs (Dr. O's point at Above the
    // Fold and Deskline). A caller with no profile asks for a cta and simply
    // gets none, rather than being handed someone else's daily promo.
    closer +
    'EM-DASH RULE: do not use em dashes or en dashes anywhere in the post or hashtags. Use commas or periods instead.\n\n' +
    (requiredHashtags.length
       ? 'REQUIRED HASHTAGS, HARD RULE: the hashtags string MUST always include these, exactly as written, in addition to whatever others fit the voice or platform: ' + requiredHashtags.join(' ') + '. Never omit them, and never let a platform\'s usual low hashtag count (e.g. X, Bluesky) push them out, they take priority over stylistic hashtags if space is tight.\n\n'
       : '') +
    'Return ONLY valid JSON, no markdown, no prose around it, in this exact shape: {"post": "the post text without hashtags", "hashtags": "the hashtags as a single space-separated string or empty string if none fit the voice or platform", "notes": "one short sentence on why this post works for this platform and this audience"}';

  const user = 'SUBJECT MATTER: ' + subject.trim() + '\n\nWrite the post for ' + platformData.name + ' in your voice.';

  try {
    const resp = await client.messages.create({
      model: MODEL, max_tokens: 1500, system: sys,
      messages: [{ role: 'user', content: user }],
    });
    const raw = (resp.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n').trim();
    let data;
    try { data = extractJson(raw); }
    catch (e) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Could not parse model response as JSON', raw: raw.slice(0, 500) }) };
    }

    const post = (data.post || '').trim();
    let hashtags = (data.hashtags || '').trim();

    // Belt-and-suspenders: guarantee the profile's required tags regardless
    // of model compliance with the prompt rule above. Driven by the profile,
    // so a caller without one can never have another owner's tags appended.
    if (requiredHashtags.length) {
      const hashtagsLower = hashtags.toLowerCase();
      const missing = requiredHashtags.filter((h) => hashtagsLower.indexOf(String(h).toLowerCase()) === -1);
      if (missing.length) {
        hashtags = (hashtags ? hashtags + ' ' : '') + missing.join(' ');
      }
    }

    const fullText = hashtags ? (post + '\n\n' + hashtags) : post;
    const charCount = fullText.length;

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        post: post,
        hashtags: hashtags,
        notes: data.notes || '',
        charCount: charCount,
        charLimit: platformData.charLimit,
        platform: platformData.name,
        agent: agentData.fullName,
        agentVoice: agentData.voice,
        suggestedTime: platformData.bestTime,
        site: siteData.name,
        siteUrl: siteData.url,
        fallbackImage: siteData.fallbackImage || '/site-thumbs/ETL_Lab.png',
      }),
    };
  } catch (err) {
    console.error('[studio-social-generate] failed', err && err.message);
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: (err && err.message) || 'generation failed' }),
    };
  }
};
