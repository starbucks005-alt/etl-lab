/* ETL Agent Embed Widget — v1
   Drop one line on any page to run an ETL agent in a scoped chat bubble.

   Usage:
     <script src="https://emerging-tech-lab.com/embed/agent.js"
             data-agent="auggie-vidal"
             data-key="sk-etl-..."></script>

   The widget inserts itself right after its own <script> tag.
   Shadow DOM keeps the host page's CSS out; the ETL dark palette in.
   No external dependencies. Vanilla JS only.
*/
(function () {
  var script = document.currentScript;
  if (!script) return;

  var AGENT = (script.getAttribute('data-agent') || '').trim();
  var KEY   = (script.getAttribute('data-key')   || '').trim();
  var BASE  = 'https://emerging-tech-lab.com';

  if (!AGENT || !KEY) {
    console.warn('[ETL] embed/agent.js: data-agent and data-key are both required.');
    return;
  }

  /* ── host element ──────────────────────────────────────────────────────── */
  var host = document.createElement('div');
  script.parentNode.insertBefore(host, script.nextSibling);
  var shadow = host.attachShadow({ mode: 'open' });

  /* ── styles (scoped inside shadow root, no leakage) ────────────────────── */
  var css = [
    ':host { display:block; }',
    '.w { font-family: Inter, system-ui, sans-serif; font-size: 14px;',
    '      background: #08111f; color: #dce8f2; border: 1px solid #1d3a56;',
    '      border-radius: 14px; padding: 1.2rem 1.3rem; max-width: 480px; }',
    '.head { display:flex; align-items:center; gap:.5rem; margin-bottom:.9rem; }',
    '.dot  { width:8px; height:8px; border-radius:50%; background:#46d6e6; flex-shrink:0; }',
    '.dot.idle { background:#7c97b0; }',
    '.aname { font-size:.75rem; letter-spacing:.12em; text-transform:uppercase;',
    '         color:#46d6e6; font-family: "IBM Plex Mono",monospace; }',
    '.sub   { font-size:.72rem; color:#7c97b0; margin-left:auto; }',
    '.out   { min-height:72px; line-height:1.7; color:#dce8f2; margin-bottom:.85rem;',
    '         white-space:pre-wrap; word-break:break-word; }',
    '.out .mute { color:#7c97b0; font-style:italic; }',
    '.row  { display:flex; gap:.45rem; }',
    '.inp  { flex:1; background:#0f2236; border:1px solid #1d3a56; border-radius:8px;',
    '        padding:.5rem .75rem; color:#dce8f2; font-size:.88rem; font-family:inherit;',
    '        outline:none; transition:border-color .15s; }',
    '.inp:focus { border-color:#46d6e6; }',
    '.btn  { background:#46d6e6; color:#06101c; border:none; border-radius:8px;',
    '        padding:.5rem 1.1rem; font-size:.78rem; font-weight:700; cursor:pointer;',
    '        letter-spacing:.04em; white-space:nowrap; }',
    '.btn:disabled { opacity:.4; cursor:default; }',
    '.credit { font-size:.65rem; color:#3a5570; margin-top:.65rem; text-align:right; }',
    '.credit a { color:#3a5570; text-decoration:none; }',
    '.credit a:hover { color:#46d6e6; }',
  ].join('\n');

  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  shadow.appendChild(styleEl);

  /* ── markup ─────────────────────────────────────────────────────────────── */
  var wrap = document.createElement('div');
  wrap.className = 'w';
  wrap.innerHTML =
    '<div class="head">' +
      '<div class="dot idle" id="dot"></div>' +
      '<span class="aname" id="aname">ETL Agent</span>' +
      '<span class="sub">emerging-tech-lab.com</span>' +
    '</div>' +
    '<div class="out" id="out"><span class="mute">Ask me anything.</span></div>' +
    '<div class="row">' +
      '<input class="inp" id="inp" placeholder="Type a question..." />' +
      '<button class="btn" id="btn">Ask</button>' +
    '</div>' +
    '<div class="credit"><a href="https://emerging-tech-lab.com" target="_blank" rel="noopener">Powered by ETL</a></div>';
  shadow.appendChild(wrap);

  var dotEl   = shadow.getElementById('dot');
  var nameEl  = shadow.getElementById('aname');
  var outEl   = shadow.getElementById('out');
  var inpEl   = shadow.getElementById('inp');
  var btnEl   = shadow.getElementById('btn');

  /* ── helpers ─────────────────────────────────────────────────────────────── */
  function setOut(text) {
    outEl.textContent = text;
  }
  function setLoading(on) {
    btnEl.disabled = inpEl.disabled = on;
    btnEl.textContent = on ? '...' : 'Ask';
    dotEl.className = 'dot' + (on ? '' : ' idle');
  }

  function poll(jobId, tries) {
    tries = tries || 0;
    if (tries > 72) {
      setOut('No response yet — please try again.');
      setLoading(false);
      return;
    }
    setTimeout(function () {
      fetch(BASE + '/.netlify/functions/agent-status' +
            '?job_id=' + encodeURIComponent(jobId) +
            '&agent='  + encodeURIComponent(AGENT), {
        headers: { 'Authorization': 'Bearer ' + KEY },
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.status === 'done') {
            var text = (d.response && d.response.text) || '(no response)';
            setOut(text);
            if (d.agent) nameEl.textContent = d.agent.toUpperCase();
            setLoading(false);
          } else if (d.status === 'error') {
            setOut('Something went wrong. ' + (d.error || 'Unknown error.'));
            setLoading(false);
          } else {
            poll(jobId, tries + 1);
          }
        })
        .catch(function () { poll(jobId, tries + 1); });
    }, 2500);
  }

  function ask() {
    var q = inpEl.value.trim();
    if (!q) return;
    setLoading(true);
    setOut('Thinking...');
    inpEl.value = '';

    fetch(BASE + '/.netlify/functions/agent-ask', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY },
      body:    JSON.stringify({ agent: AGENT, question: q }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error('http_' + r.status);
        return r.json();
      })
      .then(function (d) {
        if (!d.ok || !d.job_id) throw new Error('no_job_id');
        poll(d.job_id, 0);
      })
      .catch(function (e) {
        setOut('Could not reach the agent. ' + (e && e.message || ''));
        setLoading(false);
      });
  }

  btnEl.addEventListener('click', ask);
  inpEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) ask();
  });
}());
