/* _fireside-core: the director for a fireside chat, 2026-10-29, Dr. O: "a way to control the room when I have alice the robot, Astra Lite (Elle),
   and the Holopod (Lumvivo) all talking. A fireside chat program we can initiate that stops them from overlapping conversation."

   WHY A DIRECTOR. Until now each of them heard the others through the air and passed the turn by name, and gc-floor.js only stopped two of them
   starting at the same moment. A robot still answered something it overheard, mid sentence. In a fireside chat none of them decides to speak.
   The director (this file, run by fireside.js) gives the turn to exactly one of them at a time, hands it the words to answer with what was said so
   far, and waits until it reports that it has finished speaking. Nobody needs to hear anybody through the air, so nothing is misheard and nothing
   overlaps. While a chat is on, each robot stops listening and greeting by itself.

   THE HOST. Dr. O runs it from good-company/fireside.html on her phone: start, stop now (her turn), hand the floor to one of them, ask a question
   (hers or one from the audience), let them go on, end.

   Pure functions only, no network, so the tests can run every case. fireside.js loads and saves the state.

   NOT TRIED with the real robots when it was written. The first run with ALICE, Elle and Lumvivo in one room is the test. */

const SEAT_DEFAULTS = {
  alice: { name: 'ALICE', calls: ['alice', 'a.l.i.c.e'] },
  elle: { name: 'Elle', calls: ['elle', 'ellie', 'elie', 'astra lite', 'astra-9 lite', 'astra 9 lite'] },     // speech to text often writes Elle as Ellie
  lumvivo: { name: 'Lumvivo', calls: ['lumvivo'] },
};
const ALIVE_MS = 12000;        // during a chat, a robot that has not asked for news in this long is treated as switched off
const ALIVE_IDLE_MS = 50000;   // between chats the robots ask only every 20 seconds, so the website is not called all day
const CUE_MAX_MS = 75000;      // thinking and speaking one turn; after this the director moves on and cuts it off
const GAP_MS = 1500;           // a breath between one finishing and the next starting
const JOIN_MS = 25000;         // at the start, how long to wait for the others to notice it has begun
const RUN_MAX = 12;            // turns in a row on their own before they stop and wait for the host
const LINES_KEPT = 24;
const SEEN_WRITE_MS = 5000;    // how stale "last seen" may get before a poll writes it again, during a chat
const SEEN_WRITE_IDLE_MS = 30000;  // and between chats

const clean = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const seatId = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20);

function fresh() {
  return { on: false, id: '', code: '', topic: '', seats: {}, order: [], auto: true, paused: false, why: '', stop: 0, cue: null, queue: [],
    lines: [], run: 0, run_max: RUN_MAX, gap: GAP_MS, started: 0, last_done: 0, touched: 0, n: 0 };
}

function seatName(st, id) {
  const s = st.seats[id];
  return (s && s.name) || (SEAT_DEFAULTS[id] && SEAT_DEFAULTS[id].name) || id;
}
function alive(st, id, now) {
  const s = st.seats[id];
  return !!(s && now - (s.seen || 0) < (st.on ? ALIVE_MS : ALIVE_IDLE_MS));
}
function callsFor(st, id) {
  const out = new Set(((SEAT_DEFAULTS[id] || {}).calls || []).concat([id]));
  const nm = (st.seats[id] || {}).name;
  if (nm) out.add(nm.toLowerCase().replace(/\.$/, ''));
  return Array.from(out).filter(Boolean);
}

/* The one named LAST in what was just said is the one asked. Never the speaker herself. */
function namedNext(st, text, speaker) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';
  let best = null, bestAt = -1;
  for (const id of st.order) {
    if (id === speaker) continue;
    for (const c of callsFor(st, id)) {
      const re = new RegExp('(^|[^a-z0-9])' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\./g, '\\.?') + '(?=[^a-z0-9]|$)', 'g');
      let m;
      while ((m = re.exec(t))) { if (m.index > bestAt) { bestAt = m.index; best = id; } }
    }
  }
  return best;
}

/* Who a question is for, from the names in it: "Elle, what do you ...", "ALICE and Elle: ...", "Hey Lumvivo, ...", or "..., ALICE?" at the end.
   A name in the middle ("Elle, what do you think of ALICE?") is what the question is about, not who answers. Returns seats in stage order. */
function namedIn(st, text) {
  const t = String(text || '').toLowerCase();
  const find = seg => st.order.filter(id => callsFor(st, id).some(c => new RegExp('(^|[^a-z0-9])' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\./g, '\\.?') + '(?=[^a-z0-9]|$)').test(seg)));
  const lead = t.match(/^\s*([^,:;?!]{1,40})[,:;]/);
  if (lead) {
    const ids = find(lead[1]);
    const rest = lead[1].replace(/\b(hey|hi|okay|ok|so|and|now|you|both|all|of|first|then|over to|to)\b/g, ' ');
    const leftover = st.order.reduce((r, id) => callsFor(st, id).reduce((x, c) => x.split(c).join(' '), r), rest).replace(/[^a-z0-9]+/g, '');
    if (ids.length && !leftover) return ids;
  }
  const tail = t.match(/[,;]\s*([^,;]{1,30})[?.!]*\s*$/);
  if (tail) {
    const ids = find(tail[1]);
    const leftover = st.order.reduce((r, id) => callsFor(st, id).reduce((x, c) => x.split(c).join(' '), r), tail[1].replace(/\b(and|you|both|too)\b/g, ' ')).replace(/[^a-z0-9]+/g, '');
    if (ids.length && !leftover) return ids;
  }
  return [];
}

/* What the robot is given to answer. Everything it needs is in here, so each robot does the same thing: think, speak, report. */
function buildAsk(st, id, item) {
  const me = seatName(st, id);
  const others = st.order.filter(x => x !== id).map(x => seatName(st, x));
  const recent = st.lines.slice(-6).map(l => l.who + ': "' + l.text + '"').join(' ');
  const host = 'Dr. Oroszi';
  let now;
  const p = clean(item.prompt, 400);
  if (item.kind === 'open') now = 'Open the chat: welcome everyone in one short sentence, then say one thing of your own about the topic.';
  else if (item.kind === 'host') now = host + ' asks you: "' + p + '" Answer her.';
  else if (item.kind === 'guest') now = 'Someone in the audience asks you: "' + p + '" Answer them.';
  else if (item.kind === 'also') now = (item.from === 'guest' ? 'Someone in the audience' : host) + ' asked all of you: "' + p + '" Give your own answer, and do not repeat what the others said.';
  else now = 'It is your turn. Answer what was just said, or add something new about the topic.' + (st.auto && others.length ? ' You may end by asking one of the others a question, using their name.' : '');
  return '[Fireside chat, live on stage in front of an audience. ' + host + ' is the host. You are ' + me + '.' +
    (others.length ? ' On stage with you: ' + others.join(', ') + '.' : '') +
    (st.topic ? ' The topic: ' + st.topic + '.' : '') +
    (recent ? ' Said so far, most recent last: ' + recent : '') + ']\n\n' + now + '\n\n' +
    '[Speak only as yourself, in two or three short sentences, because people are listening, not reading. Never write a line for anyone else and never answer for them. ' +
    'Do not start by saying your name, because the audience can see who is talking. If you are asked about yourself and it is not written down for you, say you don\'t know that one.]';
}

function cueSeat(st, id, item, now, rand) {
  st.n += 1;
  st.cue = { id: 'c' + st.n + '-' + rand(), seat: id, kind: item.kind || 'turn', prompt: clean(item.prompt, 400), from: item.from || '',
    ask: buildAsk(st, id, item), at: now, speaking: 0 };
}

/* Called on every request: moves the chat on when nothing else will. Returns true if anything changed. */
function tick(st, now, rand) {
  if (!st.on) return false;
  if (st.cue) {
    const late = now - st.cue.at > CUE_MAX_MS, gone = !alive(st, st.cue.seat, now);
    if (!late && !gone) return false;
    st.why = seatName(st, st.cue.seat) + (gone ? ' went offline' : ' took too long') + ', so the floor moved on';
    st.cue = null; st.stop += 1; st.last_done = now;
    return true;
  }
  if (st.paused || now - st.last_done < st.gap) return false;
  // At the start, wait (up to JOIN_MS) for any on stage that were switched on before it began: between chats they look only every 20 seconds.
  if (!st.lines.length && now - st.started < JOIN_MS) {
    const coming = st.order.filter(id => !alive(st, id, now) && st.seats[id] && now - (st.seats[id].seen || 0) < ALIVE_IDLE_MS);
    if (coming.length) {
      const w = 'waiting for ' + coming.map(id => seatName(st, id)).join(' and ') + ' to join';
      if (st.why === w) return false;
      st.why = w; return true;
    }
    if (/^waiting for /.test(st.why)) st.why = '';
  }
  let skipped = false;
  while (st.queue.length) {
    const item = st.queue.shift();
    if (alive(st, item.seat, now)) { cueSeat(st, item.seat, item, now, rand); st.why = ''; return true; }
    st.why = seatName(st, item.seat) + ' is not connected, so that one was skipped';
    skipped = true;
  }
  if (!st.auto) return skipped;
  const up = st.order.filter(id => alive(st, id, now));
  if (!st.lines.length) {
    if (!up.length) return skipped;
    cueSeat(st, up[0], { kind: 'open' }, now, rand);
    return true;
  }
  if (up.length < 2) return skipped;           // one robot alone would only talk to herself
  if (st.run >= st.run_max) { st.paused = true; st.why = st.run + ' turns in a row, so they are waiting for you'; return true; }
  const last = st.lines[st.lines.length - 1];
  let next = namedNext(st, last.text, last.seat);
  if (!next || !alive(st, next, now)) {
    const i = st.order.indexOf(last.seat);
    for (let k = 1; k <= st.order.length; k++) {
      const c = st.order[(i + k + st.order.length) % st.order.length];
      if (c !== last.seat && alive(st, c, now)) { next = c; break; }
    }
  }
  if (!next) return skipped;
  cueSeat(st, next, { kind: 'turn' }, now, rand);
  return true;
}

const HOST_ACTIONS = ['start', 'end', 'hold', 'hold_after', 'resume', 'next', 'give', 'ask', 'set', 'clear_queue'];

/* apply(state, body, now, {isHost, codeHash, rand}) -> { state, changed, reply, error? }. state is copied, never changed in place. */
function apply(state0, body, now, opts) {
  const st = JSON.parse(JSON.stringify(state0 || fresh()));
  const o = opts || {};
  const rand = o.rand || (() => Math.random().toString(36).slice(2, 8));
  const action = String(body.action || 'state');
  let changed = false;
  const out = r => ({ state: st, changed: changed || r.changed || false, reply: r.reply || {}, error: r.error, status: r.status });

  if (HOST_ACTIONS.includes(action)) {
    if (action === 'start') {
      const stale = now - (st.touched || 0) > 4 * 3600 * 1000;
      if (st.on && !stale && !o.isHost) return out({ error: 'A fireside chat is already running. End it first, with its host code.', status: 403 });
      if (!o.codeHash) return out({ error: 'Choose a host code first.', status: 400 });
      const seats = st.seats;
      const order = (Array.isArray(body.order) ? body.order : ['alice', 'elle', 'lumvivo']).map(seatId).filter(Boolean)
        .filter((x, i, a) => a.indexOf(x) === i).slice(0, 6);
      if (!order.length) return out({ error: 'Choose who is on stage.', status: 400 });
      Object.assign(st, fresh(), { on: true, id: 's' + now.toString(36), code: o.codeHash, topic: clean(body.topic, 200), seats, order,
        auto: body.auto !== false, run_max: Math.max(2, Math.min(40, Number(body.run_max) || RUN_MAX)), started: now, last_done: now - GAP_MS,
        stop: (state0 && state0.stop || 0) + 1, n: (state0 && state0.n) || 0 });
      for (const id of order) st.seats[id] = Object.assign({ name: seatName(st, id), seen: 0 }, st.seats[id] || {});
      if (body.opener && order.includes(seatId(body.opener))) st.queue.push({ seat: seatId(body.opener), kind: 'open' });
      changed = true;
    } else {
      if (!st.on) return out({ error: 'No fireside chat is running.', status: 409 });
      if (!o.isHost) return out({ error: 'That needs the host code.', status: 403 });
      changed = true;
      st.run = 0;                                         // the host has spoken, so the count of turns on their own starts again
      if (action === 'end') { st.on = false; st.cue = null; st.queue = []; st.stop += 1; st.why = 'ended'; }
      else if (action === 'hold') { st.paused = true; st.why = 'your turn'; if (st.cue) { st.cue = null; st.stop += 1; } }
      else if (action === 'hold_after') { st.paused = true; st.why = 'your turn after this one'; }
      else if (action === 'resume') { st.paused = false; st.why = ''; st.last_done = now - st.gap; }
      else if (action === 'next') { if (st.cue) { st.cue = null; st.stop += 1; } st.paused = false; st.why = ''; st.last_done = now - st.gap; }
      else if (action === 'clear_queue') st.queue = [];
      else if (action === 'set') {
        if (typeof body.auto === 'boolean') st.auto = body.auto;
        if (body.topic != null) st.topic = clean(body.topic, 200);
        if (body.run_max != null) st.run_max = Math.max(2, Math.min(40, Number(body.run_max) || RUN_MAX));
      } else if (action === 'give') {
        const id = seatId(body.seat);
        if (!st.order.includes(id)) return out({ error: 'That one is not on stage.', status: 400 });
        const p = clean(body.prompt, 400);
        st.queue.unshift(p ? { seat: id, kind: body.from === 'guest' ? 'guest' : 'host', prompt: p } : { seat: id, kind: 'turn' });
        st.paused = false; st.why = ''; st.last_done = Math.min(st.last_done, now - st.gap);
      } else if (action === 'ask') {
        const p = clean(body.prompt, 400);
        if (!p) return out({ error: 'Type the question first.', status: 400 });
        const from = body.from === 'guest' ? 'guest' : 'host';
        // 2026-10-29, Dr. O: the host asks the questions and cues them by name ("Elle, ...", "ALICE, ..."). A question that names one of them
        // at the start (or at the very end, "..., Elle?") goes only to the one named; the menu choice is used only when nobody is named.
        const named = namedIn(st, p);
        const to = named.length ? '' : seatId(body.seat);
        if (named.length) {
          named.forEach((id, i) => st.queue.push({ seat: id, kind: i === 0 ? from : 'also', from, prompt: p }));
        } else if (to === 'named') {
          return out({ error: 'Nobody was named at the start of that question, so it was not sent. Add a name ("Elle, ...") or pick who answers.', status: 400 });
        } else if (to && to !== 'all') {
          if (!st.order.includes(to)) return out({ error: 'That one is not on stage.', status: 400 });
          st.queue.push({ seat: to, kind: from, prompt: p });
        } else {
          st.order.forEach((id, i) => st.queue.push({ seat: id, kind: i === 0 ? from : 'also', from, prompt: p }));
        }
        st.paused = false; st.why = ''; st.last_done = Math.min(st.last_done, now - st.gap);
      }
    }
  } else if (action === 'poll' || action === 'speaking' || action === 'done') {
    const id = seatId(body.seat);
    if (!id) return out({ error: 'Say which robot this is.', status: 400 });
    const s = st.seats[id] || (st.seats[id] = { name: seatName(st, id), seen: 0 });
    const nm = clean(body.name, 30);
    if (nm && nm !== s.name) { s.name = nm; changed = true; }
    if (now - (s.seen || 0) > (st.on ? SEEN_WRITE_MS : SEEN_WRITE_IDLE_MS)) changed = true;
    s.seen = now;
    if (action === 'speaking' && st.cue && st.cue.id === body.cue && st.cue.seat === id && !st.cue.speaking) { st.cue.speaking = now; changed = true; }
    if (action === 'done' && st.cue && st.cue.id === body.cue && st.cue.seat === id) {
      const said = clean(body.said, 600);
      if (said) { st.lines.push({ seat: id, who: s.name, text: said, at: now }); st.lines = st.lines.slice(-LINES_KEPT); st.run += 1; }
      else st.why = s.name + ' had nothing to say that time';
      st.cue = null; st.last_done = now; changed = true;
    }
  } else if (action !== 'state') {
    return out({ error: 'Unknown action.', status: 400 });
  }

  if (tick(st, now, rand)) changed = true;
  if (changed) st.touched = now;
  return out({ reply: body.seat && action !== 'state' && !HOST_ACTIONS.includes(action) ? robotView(st, seatId(body.seat)) : hostView(st, now) });
}

/* What a robot sees: whether a chat is on, the stop count, and its own turn if it has one. */
function robotView(st, id) {
  const mine = st.on && st.cue && st.cue.seat === id ? { id: st.cue.id, ask: st.cue.ask } : null;
  return { on: !!st.on, session: st.id, stop: st.stop, paused: !!st.paused, cue: mine, floor: st.cue ? st.cue.seat : '', every: st.on ? 1 : 20 };
}

/* What the host page sees. Never the host code. */
function hostView(st, now) {
  return {
    on: !!st.on, session: st.id, topic: st.topic, auto: st.auto, paused: !!st.paused, why: st.why, run: st.run, run_max: st.run_max,
    order: st.order,
    seats: Object.keys(st.seats).map(id => ({ id, name: seatName(st, id), alive: alive(st, id, now), on_stage: st.order.includes(id) })),
    cue: st.cue ? { seat: st.cue.seat, name: seatName(st, st.cue.seat), kind: st.cue.kind, prompt: st.cue.prompt, speaking: !!st.cue.speaking, for_s: Math.round((now - st.cue.at) / 1000) } : null,
    queue: st.queue.map(q => ({ seat: q.seat, name: seatName(st, q.seat), kind: q.kind, prompt: q.prompt || '' })),
    lines: st.lines.slice(-12),
  };
}

module.exports = { fresh, apply, tick, buildAsk, namedNext, namedIn, robotView, hostView, SEAT_DEFAULTS, ALIVE_MS, ALIVE_IDLE_MS, CUE_MAX_MS, GAP_MS, RUN_MAX, JOIN_MS };
