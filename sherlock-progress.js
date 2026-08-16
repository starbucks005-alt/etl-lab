/* ─────────────────────────────────────────────────────────────────────────────
   sherlock-progress.js

   The detective record. Local, per-device, no account required.

   Everything the game layer knows about a player lives in one localStorage key.
   Both the front door (sherlock.html) and the casebook (sherlock-casebook.html)
   read and write through this file, so there is exactly one definition of what
   a rank is and what closing a case is worth.

   Deliberate: naming the right person is worth very little. The engine already
   weights it small on purpose, and the game must not undo that by handing out
   points for a lucky guess. Rank comes from the reasoning scores.
   ───────────────────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  var KEY = 'sherlock_record_v1';

  /* Case roster, in the order they unlock. Difficulty is the label shown on the
     card; `requires` is the case that must be closed before this one opens. */
  var CASES = [
    { id: 'webster', num: '01', name: 'The Webster Station Ledger', difficulty: 'Introductory', requires: null },
    { id: 'wayne',   num: '02', name: 'The Wayne Avenue ID',        difficulty: 'Intermediate', requires: 'webster' },
    { id: 'third',   num: '03', name: 'The Third Street Fire',      difficulty: 'Advanced',     requires: 'wayne' }
  ];

  /* Rank ladder. `cases` is how many must be closed, `avg` the average case
     score required across them. Both conditions have to hold, so a player
     cannot rush the ladder by closing cases badly. */
  var RANKS = [
    { key: 'irregular',  name: 'Baker Street Irregular', cases: 0, avg: 0,  blurb: 'You have not opened a file yet.' },
    { key: 'constable',  name: 'Constable',              cases: 1, avg: 0,  blurb: 'You closed a case. Not well, but you closed it.' },
    { key: 'sergeant',   name: 'Sergeant',               cases: 1, avg: 55, blurb: 'You are reading evidence instead of collecting impressions.' },
    { key: 'inspector',  name: 'Inspector',              cases: 2, avg: 60, blurb: 'You caught what the file wanted you to miss.' },
    { key: 'chief',      name: 'Chief Inspector',        cases: 3, avg: 65, blurb: 'Three files closed and the reasoning held up in all three.' },
    { key: 'consulting', name: 'Consulting Detective',   cases: 3, avg: 80, blurb: 'You see what everyone else walked past.' }
  ];

  /* A case score is the reasoning, halved and halved. The name is a nudge, not
     a prize: five points, and only if the reasoning was already sound enough to
     be worth crediting. */
  var NAME_BONUS = 5;

  function blank() {
    return { cases: {}, streak: 0, best_streak: 0, opened: 0, first_seen: null, last_seen: null };
  }

  function load() {
    try {
      var raw = global.localStorage.getItem(KEY);
      if (!raw) return blank();
      var r = JSON.parse(raw);
      if (!r || typeof r !== 'object' || !r.cases) return blank();
      return r;
    } catch (e) {
      /* Private mode, disabled storage, or a corrupt value. The game still
         runs, it just will not remember. Never let this throw into the page. */
      return blank();
    }
  }

  function save(rec) {
    try { global.localStorage.setItem(KEY, JSON.stringify(rec)); } catch (e) { /* no-op */ }
    return rec;
  }

  function clampPct(n) {
    n = Number(n);
    if (!isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  /* Turn one verdict from the engine into a single 0-100 case score. */
  function scoreVerdict(v) {
    if (!v) return 0;
    var d = clampPct(v.deduction_score);
    var p = clampPct(v.procedure_score);
    var base = (d + p) / 2;
    if (v.named_correctly && base >= 40) base += NAME_BONUS;
    return clampPct(base);
  }

  /* A case counts as closed when the reasoning holds up, whatever the name.
     Getting the name right on bad reasoning is exactly the failure the cases
     are built to punish, so it does not close a file. */
  function isClosed(score) { return score >= 50; }

  function record(caseId, verdict) {
    var rec = load();
    var score = scoreVerdict(verdict);
    var closed = isClosed(score);
    var prior = rec.cases[caseId] || { attempts: 0, best: 0, closed: false, named: false, first_closed: null };

    prior.attempts += 1;
    prior.named = prior.named || !!(verdict && verdict.named_correctly);
    prior.last_score = score;
    prior.last_deduction = clampPct(verdict && verdict.deduction_score);
    prior.last_procedure = clampPct(verdict && verdict.procedure_score);
    if (score > prior.best) prior.best = score;
    if (closed && !prior.closed) {
      prior.closed = true;
      prior.first_closed = new Date().toISOString();
    }

    rec.cases[caseId] = prior;

    if (closed) {
      rec.streak += 1;
      if (rec.streak > rec.best_streak) rec.best_streak = rec.streak;
    } else {
      rec.streak = 0;
    }

    rec.last_seen = new Date().toISOString();
    if (!rec.first_seen) rec.first_seen = rec.last_seen;
    save(rec);

    return { score: score, closed: closed, best: prior.best, attempts: prior.attempts, improved: score >= prior.best };
  }

  function closedCases(rec) {
    rec = rec || load();
    return CASES.filter(function (c) { return rec.cases[c.id] && rec.cases[c.id].closed; });
  }

  function averageBest(rec) {
    rec = rec || load();
    var closed = closedCases(rec);
    if (!closed.length) return 0;
    var sum = closed.reduce(function (t, c) { return t + rec.cases[c.id].best; }, 0);
    return Math.round(sum / closed.length);
  }

  function rank(rec) {
    rec = rec || load();
    var n = closedCases(rec).length;
    var avg = averageBest(rec);
    var earned = RANKS[0];
    for (var i = 0; i < RANKS.length; i++) {
      if (n >= RANKS[i].cases && avg >= RANKS[i].avg) earned = RANKS[i];
    }
    return earned;
  }

  function nextRank(rec) {
    rec = rec || load();
    var current = rank(rec);
    var idx = RANKS.findIndex(function (r) { return r.key === current.key; });
    return idx >= 0 && idx < RANKS.length - 1 ? RANKS[idx + 1] : null;
  }

  /* What a player still has to do to reach the next rank, in plain words. */
  function nextRankHint(rec) {
    rec = rec || load();
    var next = nextRank(rec);
    if (!next) return null;
    var n = closedCases(rec).length;
    var avg = averageBest(rec);
    var needCases = Math.max(0, next.cases - n);
    var needAvg = avg < next.avg;
    if (needCases && needAvg) {
      return 'Close ' + needCases + (needCases === 1 ? ' more case' : ' more cases') + ' and lift your average to ' + next.avg + '.';
    }
    if (needCases) return 'Close ' + needCases + (needCases === 1 ? ' more case.' : ' more cases.');
    if (needAvg) return 'Lift your average to ' + next.avg + '. Reopening a closed case and reasoning it better counts.';
    return null;
  }

  /* A case is open if it has no prerequisite, or its prerequisite is closed.
     Replaying a closed case is always allowed. */
  function isUnlocked(caseId, rec) {
    rec = rec || load();
    var c = CASES.find(function (x) { return x.id === caseId; });
    if (!c) return true;
    if (!c.requires) return true;
    return !!(rec.cases[c.requires] && rec.cases[c.requires].closed);
  }

  function status(caseId, rec) {
    rec = rec || load();
    var entry = rec.cases[caseId];
    if (!isUnlocked(caseId, rec)) return { state: 'locked', label: 'Locked' };
    if (!entry || !entry.attempts) return { state: 'new', label: 'Unopened' };
    if (entry.closed) return { state: 'closed', label: 'Closed', best: entry.best };
    return { state: 'open', label: 'Still open', best: entry.best, attempts: entry.attempts };
  }

  function markOpened() {
    var rec = load();
    rec.opened += 1;
    if (!rec.first_seen) rec.first_seen = new Date().toISOString();
    return save(rec);
  }

  function reset() { return save(blank()); }

  global.SherlockProgress = {
    CASES: CASES,
    RANKS: RANKS,
    load: load,
    record: record,
    scoreVerdict: scoreVerdict,
    isClosed: isClosed,
    closedCases: closedCases,
    averageBest: averageBest,
    rank: rank,
    nextRank: nextRank,
    nextRankHint: nextRankHint,
    isUnlocked: isUnlocked,
    status: status,
    markOpened: markOpened,
    reset: reset
  };
})(window);
