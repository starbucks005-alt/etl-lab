/* THE TABLE, front end, slice 1. No model calls. Reads data/*.json and draws it.
   Images are never substituted: a missing portrait stays a blank frame.
   Add ?check to any page to outline missing images in red. */
(function () {
  'use strict';

  var DIRS = { leader: 'Leaders/', host: 'Hosts/' };
  var CHECK = /[?&]check\b/.test(location.search);
  if (CHECK) document.body.classList.add('check');

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function hash(s) { var h = 7; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
  function qs(name) { var m = new RegExp('[?&]' + name + '=([^&]*)').exec(location.search); return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : ''; }
  function get(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }); }

  /* Blink pair. Open is always the base image. Closed sits on top and only
     fades in for a moment. If the open image is missing the frame stays
     blank. If only the closed image is missing the face stays open. */
  function portrait(kind, person) {
    var wrap = el('div', 'portrait');
    var dir = DIRS[kind];
    var open = el('img', 'open');
    var closed = el('img', 'closed');
    open.alt = person.name;
    closed.alt = ''; closed.setAttribute('aria-hidden', 'true');
    /* Lazy by default; eager under ?check so every missing frame reports. */
    open.loading = closed.loading = CHECK ? 'eager' : 'lazy';
    open.addEventListener('error', function () { wrap.classList.add('missing'); wrap.dataset.missing = 'open'; });
    closed.addEventListener('error', function () { closed.remove(); wrap.dataset.missingClosed = '1'; });
    open.src = dir + person.file + '_eyes_open.jpg';
    closed.src = dir + person.file + '_eyes_closed.jpg';
    /* Uneven cycles and negative delays so no two faces blink in step. */
    var h = hash(person.id);
    closed.style.animationDuration = (4.6 + (h % 25) / 10).toFixed(1) + 's';
    closed.style.animationDelay = '-' + (((h >>> 5) % 60) / 10).toFixed(1) + 's';
    wrap.appendChild(open); wrap.appendChild(closed);
    return wrap;
  }

  function personCard(kind, p, tagText) {
    var c = el('article', 'card');
    c.appendChild(portrait(kind, p));
    var b = el('div', 'body');
    b.appendChild(el('span', 'name', p.name));
    if (p.source) b.appendChild(el('span', 'src', p.source));
    if (p.tagline) b.appendChild(el('p', 'tag', p.tagline));
    if (p.title) b.appendChild(el('p', 'tag', p.title));
    if (p.flaw) b.appendChild(el('p', 'flaw', 'Flawed: ' + p.flaw));
    c.appendChild(b);
    c.appendChild(el('div', 'ai-tag', tagText));
    return c;
  }

  function heroFrame(src) {
    var f = el('div', 'hero-frame');
    var im = el('img'); im.alt = '';
    im.addEventListener('error', function () { f.classList.add('missing'); });
    im.src = src;
    f.appendChild(im);
    return f;
  }

  function titleEverywhere(site) {
    document.title = site.title + ' · Emerging Technologies Laboratory';
    var nodes = document.querySelectorAll('[data-site-title]');
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = site.title;
  }

  function load() {
    return Promise.all([get('data/site.json'), get('data/leaders.json'), get('data/hosts.json'),
                        get('data/topics.json'), get('data/segments.json'),
                        get('data/status.json').catch(function () { return null; })])
      .then(function (a) { return { site: a[0], leaders: a[1], hosts: a[2], topics: a[3], segments: a[4], status: a[5] }; });
  }

  /* Progress: stages come from data/status.json; the portrait count is
     measured live from the files that actually exist, never typed in. */
  function renderProgress(d) {
    var ul = document.getElementById('stages');
    if (ul && d.status) {
      var label = { done: 'Done', next: 'Up next', later: 'Later' };
      d.status.stages.forEach(function (s) {
        var li = el('li'); li.dataset.state = s.state;
        li.appendChild(el('span', 'st', label[s.state] || s.state));
        li.appendChild(el('span', null, s.label));
        ul.appendChild(li);
      });
    }
    var meter = document.getElementById('portraitMeter');
    var bar = document.getElementById('portraitBar');
    if (!meter) return;
    var urls = d.leaders.leaders.map(function (p) { return DIRS.leader + p.file + '_eyes_open.jpg'; })
      .concat(d.hosts.map(function (h) { return DIRS.host + h.file + '_eyes_open.jpg'; }));
    Promise.all(urls.map(function (u) {
      return fetch(u, { method: 'HEAD' }).then(function (r) { return r.ok && (r.headers.get('content-type') || '').indexOf('image/') === 0; }).catch(function () { return false; });
    })).then(function (res) {
      var have = res.filter(Boolean).length;
      meter.textContent = 'Portraits ready: ' + have + ' of ' + urls.length;
      bar.style.width = (urls.length ? Math.round(100 * have / urls.length) : 0) + '%';
    });
  }

  /* ---------- pages ---------- */
  function pageHome(d) {
    var hero = document.getElementById('hero');
    hero.appendChild(heroFrame(d.site.heroImage));
    document.getElementById('tagline').textContent = d.site.tagline;
    document.getElementById('intro').textContent = d.site.intro;
    document.getElementById('openingCard').textContent = d.site.openingCard;

    var seg = document.getElementById('segments');
    d.segments.forEach(function (s, i) {
      var li = el('li');
      li.appendChild(el('span', 'n', String(i + 1)));
      li.appendChild(el('span', 't', s.name));
      li.appendChild(el('span', 'w', s.what));
      seg.appendChild(li);
    });

    var holder = document.getElementById('groups');
    d.leaders.groups.forEach(function (g) {
      holder.appendChild(el('h2', null, g.label));
      var grid = el('div', 'grid');
      d.leaders.leaders.filter(function (p) { return p.group === g.id; })
        .forEach(function (p) { grid.appendChild(personCard('leader', p, d.site.disclosureTag)); });
      holder.appendChild(grid);
    });

    var hg = document.getElementById('hosts');
    d.hosts.forEach(function (h) { hg.appendChild(personCard('host', h, d.site.disclosureTag)); });
  }

  function hostSelect(d, current) {
    var sel = el('select'); sel.id = 'hostSel'; sel.setAttribute('aria-label', 'Host');
    d.hosts.forEach(function (h) {
      var o = el('option', null, h.name); o.value = h.id;
      if (h.id === current) o.selected = true;
      sel.appendChild(o);
    });
    return sel;
  }
  function currentHost(d) { var h = qs('host'); return d.hosts.some(function (x) { return x.id === h; }) ? h : d.site.defaultHost; }

  function pageBoard(d) {
    var host = currentHost(d);
    var bar = document.getElementById('hostbar');
    bar.appendChild(el('label', null, 'Host:'));
    var sel = hostSelect(d, host); bar.appendChild(sel);
    var boards = document.getElementById('boards');
    function draw() {
      boards.textContent = '';
      var hid = sel.value;
      d.topics.forEach(function (b, i) {
        var board = el('section', 'board');
        board.appendChild(el('h3', null, 'Board ' + ['One', 'Two', 'Three'][i] + ': ' + b.name));
        var tiles = el('div', 'tiles');
        b.topics.forEach(function (t) {
          var a = el('a', 'tile', t);
          a.href = 'table.html?topic=' + encodeURIComponent(t) + '&host=' + encodeURIComponent(hid);
          tiles.appendChild(a);
        });
        board.appendChild(tiles);
        boards.appendChild(board);
      });
    }
    sel.addEventListener('change', draw);
    draw();
  }

  function pageTable(d) {
    var host = d.hosts.filter(function (h) { return h.id === currentHost(d); })[0];
    var topic = qs('topic') || 'Choose a topic';
    var max = d.site.maxSeats;
    var picked = [];
    var pre = qs('seats'); if (pre) picked = pre.split(',').filter(Boolean).slice(0, max);

    document.getElementById('topicName').textContent = topic;
    var stage = document.getElementById('stage');
    var bg = el('img', 'bg'); bg.alt = '';
    bg.addEventListener('error', function () { stage.classList.add('missing'); });
    bg.src = d.site.heroImage;
    stage.appendChild(bg);
    stage.appendChild(el('div', 'tableTop'));
    stage.appendChild(el('div', 'topic-card', topic));
    var seatsLayer = el('div'); stage.appendChild(seatsLayer);

    document.getElementById('lowerThirdHost').textContent = 'Host: ' + host.name;
    document.getElementById('lowerThirdTag').textContent = d.site.disclosureTag;
    document.getElementById('openingCard').textContent = d.site.openingCard;

    var byId = {}; d.leaders.leaders.forEach(function (p) { byId[p.id] = p; });

    function draw() {
      seatsLayer.textContent = '';
      /* Host chair, head of the table. */
      var hs = el('div', 'seat host'); hs.style.left = '50%'; hs.style.top = '18%';
      hs.appendChild(portrait('host', host)); hs.appendChild(el('span', 'nm', host.name));
      seatsLayer.appendChild(hs);
      /* Leaders on an arc below and around the table. */
      var n = Math.max(picked.length, 1);
      picked.forEach(function (id, i) {
        var p = byId[id]; if (!p) return;
        var t = n === 1 ? 0.5 : i / (n - 1);
        var ang = Math.PI * (0.08 + 0.84 * t);
        var s = el('div', 'seat');
        s.style.left = (50 - 40 * Math.cos(ang)) + '%';
        s.style.top = (46 + 38 * Math.sin(ang)) + '%';
        s.appendChild(portrait('leader', p)); s.appendChild(el('span', 'nm', p.name));
        seatsLayer.appendChild(s);
      });
      var count = document.getElementById('seatCount');
      count.textContent = picked.length + ' at the table, up to ' + max + ' seats';
      chipsRefresh();
      /* Slice 1 has no round engine, so Begin stays disabled on purpose. */
      var q = document.getElementById('beginBtn');
      q.setAttribute('aria-disabled', 'true');
      q.onclick = function (e) { e.preventDefault(); };
      if (CHECK) count.textContent += '  |  round engine not connected (slice 1)';
    }

    var chips = document.getElementById('chips');
    var chipEls = {};
    d.leaders.groups.forEach(function (g) {
      chips.appendChild(el('h3', 'eyebrow', g.label));
      var row = el('div', 'chips');
      d.leaders.leaders.filter(function (p) { return p.group === g.id; }).forEach(function (p) {
        var b = el('button', 'chip', p.name); b.type = 'button';
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', function () {
          var i = picked.indexOf(p.id);
          if (i >= 0) picked.splice(i, 1); else if (picked.length < max) picked.push(p.id);
          draw();
        });
        chipEls[p.id] = b; row.appendChild(b);
      });
      chips.appendChild(row);
    });
    function chipsRefresh() {
      Object.keys(chipEls).forEach(function (id) {
        var on = picked.indexOf(id) >= 0;
        var b = chipEls[id];
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        /* A host who is also a leader sits out this round. */
        var sitsOut = host.alsoLeader === id;
        b.disabled = sitsOut || (!on && picked.length >= max);
        b.title = sitsOut ? 'Hosting this round, so sitting out.' : '';
      });
    }
    /* Drop a pre-picked seat if that leader is hosting. */
    picked = picked.filter(function (id) { return id !== host.alsoLeader; });

    var seg = document.getElementById('segments');
    d.segments.forEach(function (s, i) {
      var li = el('li');
      li.appendChild(el('span', 'n', String(i + 1)));
      li.appendChild(el('span', 't', s.name));
      li.appendChild(el('span', 'w', s.who + ': ' + s.what));
      seg.appendChild(li);
    });
    draw();
  }

  load().then(function (d) {
    titleEverywhere(d.site);
    var page = document.body.dataset.page;
    if (page === 'home') { pageHome(d); renderProgress(d); }
    if (page === 'board') pageBoard(d);
    if (page === 'table') pageTable(d);
  }).catch(function (e) {
    var m = document.getElementById('loadError');
    if (m) { m.hidden = false; m.textContent = 'Could not load the table data: ' + e.message; }
    if (window.console) console.error(e);
  });
})();
