/* _agent-registry.js — slug -> persona resolver for the generic agent runner.
   Shared by agent-ask, agent-background, and agent-status.
   Loads persona from roster.json (bundled via netlify.toml included_files).
   Falls back to HTTP fetch in dev/preview where the file path may differ.
   Optionally loads a backpack spec from agent-backpacks/agents/<slug>.json
   if one exists; V1 agents without a backpack run prompt-only. */

const fs = require('fs');
const path = require('path');
const { VOICE_LAW_CHAT } = require('./_etl-voice-law.js');

function slugify(name) {
  return String(name || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function loadRosterFs() {
  const candidates = [
    path.join(__dirname, '..', '..', 'roster.json'),
    path.join(process.cwd(), 'roster.json'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {}
  }
  return null;
}

async function loadRosterHttp(event) {
  const base = process.env.URL
    || ((event && event.headers && (event.headers.host || event.headers.Host))
      ? 'https://' + (event.headers.host || event.headers.Host) : '');
  if (!base) return null;
  try {
    const r = await fetch(base + '/roster.json', { cache: 'no-store' });
    if (r.ok) return await r.json();
  } catch (_) {}
  return null;
}

function loadBackpackFs(slug) {
  const candidates = [
    path.join(__dirname, '..', '..', 'agent-backpacks', 'agents', slug + '.json'),
    path.join(process.cwd(), 'agent-backpacks', 'agents', slug + '.json'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {}
  }
  return null;
}

async function findAgent(slug, event) {
  const roster = loadRosterFs() || await loadRosterHttp(event);
  if (!roster) return null;
  const list = Array.isArray(roster) ? roster : (roster.agents || []);
  const s = slugify(slug);
  return list.find(a =>
    slugify(a.name) === s ||
    (a.nickname && slugify(a.nickname) === s)
  ) || null;
}

async function buildPersona(slug, event) {
  const agent = await findAgent(slug, event);
  if (!agent) return null;

  const backpack = loadBackpackFs(slug);

  const lines = [
    'You are ' + agent.name + ', ' + (agent.role || 'an ETL Lab specialist') + '.',
  ];
  if (agent.bio)        lines.push(agent.bio);
  if (agent.background) lines.push('Background: ' + agent.background);
  if (agent.tagline)    lines.push('Your tagline: ' + agent.tagline);
  lines.push('Your home platform: ' + (agent.platform || 'ETL campus') + '.');
  lines.push(
    'You are staff at the Emerging Technologies Laboratory. ' +
    'Dr. Terry Oroszi (Dr. O) is your boss. She is a woman, she/her.'
  );

  if (backpack && backpack.guardrail) {
    lines.push('\n' + backpack.guardrail);
  }

  lines.push(VOICE_LAW_CHAT);

  return {
    name:        agent.name,
    role:        agent.role || '',
    systemPrompt: lines.join('\n'),
    hasBackpack: !!backpack,
  };
}

module.exports = { slugify, findAgent, buildPersona };
