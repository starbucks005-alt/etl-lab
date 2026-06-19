/* gym-im.js — shared IM overlay for The Gym.
   Loaded by gym.html and gym-profile.html.
   Exposes window.openGymChat(charId) and window.closeGymChat().
   Delegated click handler wires any [data-gym-char] button automatically.
   Posts to /.netlify/functions/gym-chat for responses.
*/
(function () {
  'use strict';

  var GYM_CAST = {
    dom: {
      firstName: 'Coach Dom', fullName: 'Coach Dom Castellanos',
      credential: 'CSCS',
      role: 'Strength & Conditioning Coach',
      tagline: 'He believes most people do not need a new program. They need to run the old one for twelve more weeks.',
      bio: 'Anti-hype, pro-consistency, allergic to program-hopping. Former college linebacker who coaches the basics because the basics work. Short sentences. Add five pounds. Come back Thursday.',
      color: '#e0552e', bg: '#fff3f0',
      portrait: { open: '/agents/Coach_Dom_Eyes_open.png', closed: '/agents/Coach_Dom_Eyes_closed.png' },
      visitHref: '/workout-library', visitLabel: 'Workout Library',
    },
    lena: {
      firstName: 'Dr. Lena', fullName: 'Dr. Lena Brandt, DPT',
      credential: 'DPT, Licensed',
      role: 'Physical Therapist',
      tagline: 'The licensed authority on the floor. The brake on everyone else\'s enthusiasm.',
      bio: 'German-American sports-rehab clinician. Precise, composed, dryly funny. She does not raise her voice because she does not need to. "No. Next question." Then, a beat later, the actual help.',
      color: '#3a7fa0', bg: '#eef5fa',
      portrait: { open: '/agents/Dr_Lena_eyes_open.png', closed: '/agents/Dr_Lena_eyes_closed.png' },
      visitHref: null, visitLabel: null,
    },
    noor: {
      firstName: 'Noor', fullName: 'Noor Haddad, RYT-500',
      credential: 'RYT-500',
      role: 'Yoga & Breathwork Instructor',
      tagline: 'The breath-first voice that down-regulates the room without seeming to try.',
      bio: 'Levantine, found movement through her own recovery when breath was the only thing she could train. Leads guided yoga, breathwork audio, and the sleep sessions. Hard to rattle. Leaves silence on purpose.',
      color: '#7a6a4a', bg: '#f5f0e8',
      portrait: { open: '/agents/Noor_eyes_open.png', closed: '/agents/Noor_eyes_closed.png' },
      visitHref: null, visitLabel: null,
    },
    sana: {
      firstName: 'Dr. Sana', fullName: 'Dr. Sana Qureshi, PhD',
      credential: 'PhD, Exercise Physiology',
      role: 'Sleep & Recovery Physiologist',
      tagline: 'The evidence-based antidote to overtraining culture. She argues with Dom about rest days, and she wins, because she brings the paper.',
      bio: 'Pakistani-American physiologist. Calm, evidence-first, citation-ready. "Love the effort. Now show me your sleep from this week." Tracks her own HRV for fun. Never smug, always sourced.',
      color: '#2f8f7f', bg: '#eef7f5',
      portrait: { open: '/agents/Sana_eyes_open.png', closed: '/agents/Sana_eyes_closed.png' },
      visitHref: '/longevity', visitLabel: 'Longevity Checked',
    },
    nadia: {
      firstName: 'Nadia', fullName: 'Nadia Hassan, RD',
      credential: 'RD, Registered Dietitian',
      role: 'Recovery Nutritionist',
      tagline: 'Cross-posts evidence-based fuel guidance from The Dose kitchen to the gym floor.',
      bio: 'Nadia brings The Dose\'s nutrition rigor here. Performance fuel, recovery eating, and every supplement label checked against the research before it gets near the floor.',
      color: '#2e7a50', bg: '#eef7f0',
      portrait: { open: '/agents/Nadia_eyes_open.png', closed: '/agents/Nadia_eyes_closed.png' },
      visitHref: null, visitLabel: null,
    },
    wyatt: {
      firstName: 'Wyatt', fullName: 'Wyatt E. Cooper',
      credential: 'Zero-Proof Bar',
      role: 'Recovery Drinks',
      tagline: 'The bar that does not compromise your recovery to taste good.',
      bio: 'Wyatt cross-posts from The Dose. Zero-proof recovery drinks, electrolyte sourcing checked, and recipes built around what the research actually supports. He also believes sparkling water with lime is underrated.',
      color: '#8a5a1a', bg: '#f7f0e5',
      portrait: { open: '/agents/Wyatt_eyes_open.png', closed: '/agents/Wyatt_eyes_closed.png' },
      visitHref: null, visitLabel: null,
    },
    reece: {
      firstName: 'Reece', fullName: 'Reece Ashford',
      credential: 'Recovery Intern',
      role: 'Dehydrator & Recovery Nutrition',
      tagline: 'Hosts The Recovery Dehydrator. Lives between food science and active recovery.',
      bio: 'Reece bridges the dehydration bench and the gym floor. Checks what the label says against what the study says, and is perpetually in over their head in the best way.',
      color: '#4a6a80', bg: '#ecf3f8',
      portrait: { open: '/agents/Reece_eyes_open.png', closed: '/agents/Reece_eyes_closed.png' },
      visitHref: '/dehydrator', visitLabel: 'Recovery Dehydrator',
    },
    zara: {
      firstName: 'Zara', fullName: 'Zara Cole',
      credential: 'Smoothie Bar',
      role: 'Smoothies & Recovery Fuel',
      tagline: 'Every blend is built for a purpose. No filler, no mystery powders.',
      bio: 'Zara runs the smoothie bar on the gym floor. Post-lift, pre-run, or just getting through the afternoon. She keeps it simple and checks every ingredient before it goes in the blender.',
      color: '#2e7a3a', bg: '#eef7f0',
      portrait: { open: '/agents/Zara_eyes_open.png', closed: '/agents/Zara_eyes_closed.png' },
      visitHref: null, visitLabel: null,
    },
    jax: {
      firstName: 'Jax', fullName: 'Jax Rivera',
      credential: 'SEO Specialist',
      role: 'Trend Verification',
      tagline: 'When a fitness trend starts moving, he maps it. Then he checks it.',
      bio: 'Jax cross-posts from the ETL studio. Tracks what is going viral in fitness, then runs it through the evidence before the crew endorses it. Gen Z with receipts. His cousin Mara is on the Newswire.',
      color: '#3a5aaa', bg: '#eef0fa',
      portrait: { open: '/agents/Jax_eyes_open.png', closed: '/agents/Jax_eyes_closed.png' },
      visitHref: null, visitLabel: null,
    },
    eli: {
      firstName: 'Eli', fullName: 'Eli Adler',
      credential: 'Fact-Checker',
      role: 'Fitness Claim Verification',
      tagline: 'The research pass that clears a claim before the crew endorses it.',
      bio: 'Eli runs the evidence check on fitness claims that look credible but need sourcing. Cross-trained from The Dose, where the same standard applies. If Jax finds a trend, Eli is usually the one pulling the paper.',
      color: '#3a4a5a', bg: '#eceff2',
      portrait: { open: '/agents/Eli_Adler_profile.png', closed: null },
      visitHref: null, visitLabel: null,
    },
  };

  // Expose cast for gym-profile.html to use
  window.GYM_CAST = GYM_CAST;

  // Thread state per character, per page load
  var threads = {};
  var overlayEl = null;
  var activeCharId = null;
  var lastFocused = null;

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function ensureStyles() {
    if (document.getElementById('gym-chat-styles')) return;
    var s = document.createElement('style');
    s.id = 'gym-chat-styles';
    s.textContent = [
      '.gym-chat-overlay{position:fixed;inset:0;background:rgba(16,26,34,0.62);display:flex;align-items:center;justify-content:center;z-index:9000;padding:1rem;}',
      '.gym-chat-overlay[hidden]{display:none;}',
      '.gym-chat-panel{background:#fff;border-radius:10px;width:100%;max-width:540px;max-height:86vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.32);overflow:hidden;font-family:Inter,system-ui,sans-serif;}',
      '.gym-chat-header{display:flex;align-items:center;gap:0.8rem;padding:0.9rem 1.1rem;border-bottom:1px solid #e4eaee;background:var(--gym-chat-bg,#f4f7f9);}',
      '.gym-chat-av{width:44px;height:44px;border-radius:50%;overflow:hidden;flex-shrink:0;border:2px solid #fff;}',
      '.gym-chat-av img{width:100%;height:100%;object-fit:cover;display:block;}',
      '.gym-chat-who{flex:1;}',
      '.gym-chat-name{font-family:Fraunces,Georgia,serif;font-weight:700;font-size:1.05rem;color:var(--gym-chat-color,#16212b);line-height:1.2;}',
      '.gym-chat-role-label{font-size:0.8rem;color:#6a7a8a;}',
      '.gym-chat-close{border:none;background:transparent;font-size:1.5rem;color:#5a6a7a;cursor:pointer;padding:0.2rem 0.5rem;line-height:1;}',
      '.gym-chat-close:hover{color:#16212b;}',
      '.gym-chat-thread{flex:1;overflow-y:auto;padding:1rem 1.1rem;background:#fbfcfd;display:flex;flex-direction:column;gap:0.7rem;}',
      '.gym-chat-seed{font-size:0.85rem;color:#6a7a8a;font-style:italic;padding:0.5rem 0.8rem;background:#f0f3f6;border-radius:6px;align-self:center;max-width:90%;text-align:center;}',
      '.gym-chat-msg{max-width:85%;}',
      '.gym-chat-msg-user{align-self:flex-end;background:var(--gym-chat-color,#e0552e);color:#fff;padding:0.6rem 0.9rem;border-radius:14px 14px 4px 14px;font-size:0.95rem;line-height:1.45;}',
      '.gym-chat-msg-char{align-self:flex-start;background:#fff;border:1px solid #e2e7ec;color:#16212b;padding:0.6rem 0.9rem;border-radius:14px 14px 14px 4px;font-size:0.95rem;line-height:1.45;}',
      '.gym-chat-msg-char.routed{border-color:var(--gym-chat-color,#e0552e);background:var(--gym-chat-bg,#fff3f0);}',
      '.gym-chat-msg-tools{display:flex;gap:0.5rem;margin-top:0.4rem;align-items:center;}',
      '.gym-chat-route-btn{border:1px solid #d4dde2;background:#fff;padding:0.3rem 0.6rem;border-radius:4px;cursor:pointer;font-size:0.8rem;color:var(--gym-chat-color,#e0552e);font-family:Inter,sans-serif;}',
      '.gym-chat-route-btn:hover{background:var(--gym-chat-bg,#fff3f0);}',
      '.gym-chat-typing{align-self:flex-start;color:#6a7a8a;font-size:0.85rem;font-style:italic;padding:0.4rem 0.8rem;}',
      '.gym-chat-typing::after{content:"";display:inline-block;width:3ch;text-align:left;animation:gym-dots 1.4s steps(4,end) infinite;}',
      '@keyframes gym-dots{0%,25%{content:""}50%{content:"."}75%{content:".."}100%{content:"..."}}',
      '.gym-chat-err{align-self:stretch;color:#a8526a;font-size:0.85rem;padding:0.5rem 0.8rem;background:#fbeef2;border-radius:6px;}',
      '.gym-chat-form{display:flex;gap:0.5rem;padding:0.8rem 1rem;border-top:1px solid #e4eaee;background:#fff;}',
      '.gym-chat-input{flex:1;padding:0.55rem 0.8rem;font-size:0.95rem;font-family:Inter,sans-serif;border:1px solid #d4dde2;border-radius:4px;color:#16212b;}',
      '.gym-chat-input:focus{outline:2px solid var(--gym-chat-color,#e0552e);outline-offset:1px;}',
      '.gym-chat-send{padding:0.55rem 1.1rem;background:var(--gym-chat-color,#e0552e);color:#fff;border:none;border-radius:4px;font-weight:600;font-size:0.95rem;cursor:pointer;font-family:Inter,sans-serif;}',
      '.gym-chat-send:disabled{background:#b8c5d0;cursor:wait;}',
      '.gym-chat-disc{font-size:0.75rem;color:#8a98a4;text-align:center;padding:0.4rem 1rem 0.7rem;background:#fff;}',
    ].join('');
    document.head.appendChild(s);
  }

  function ensureOverlay() {
    if (overlayEl) return;
    ensureStyles();
    overlayEl = document.createElement('div');
    overlayEl.className = 'gym-chat-overlay';
    overlayEl.setAttribute('hidden', '');
    overlayEl.setAttribute('role', 'dialog');
    overlayEl.setAttribute('aria-modal', 'true');
    overlayEl.innerHTML = '<div class="gym-chat-panel"></div>';
    overlayEl.addEventListener('click', function (e) {
      if (e.target === overlayEl) closeGymChat();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !overlayEl.hasAttribute('hidden')) closeGymChat();
    });
    document.body.appendChild(overlayEl);
  }

  function renderThread() {
    var ch = GYM_CAST[activeCharId];
    var threadEl = overlayEl.querySelector('.gym-chat-thread');
    var thread = threads[activeCharId] || [];
    if (!thread.length) {
      threadEl.innerHTML = '<div class="gym-chat-seed">You\'re messaging ' + esc(ch.firstName) + '. Say hi, or ask something in their lane.</div>';
      return;
    }
    var html = thread.map(function (m) {
      if (m.role === 'user') {
        return '<div class="gym-chat-msg gym-chat-msg-user">' + esc(m.content) + '</div>';
      }
      var routed = m.kind === 'routed';
      var routeBtn = '';
      if (routed && m.route_to && GYM_CAST[m.route_to]) {
        routeBtn = '<button type="button" class="gym-chat-route-btn" data-route="' + esc(m.route_to) + '">Open chat with ' + esc(GYM_CAST[m.route_to].firstName) + ' →</button>';
      }
      return '<div class="gym-chat-msg gym-chat-msg-char' + (routed ? ' routed' : '') + '">' +
        esc(m.content) +
        (routeBtn ? '<div class="gym-chat-msg-tools">' + routeBtn + '</div>' : '') +
        '</div>';
    }).join('');
    threadEl.innerHTML = html;
    threadEl.scrollTop = threadEl.scrollHeight;
    threadEl.querySelectorAll('.gym-chat-route-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var next = btn.dataset.route;
        if (next && GYM_CAST[next]) {
          closeGymChat();
          setTimeout(function () { openGymChat(next); }, 120);
        }
      });
    });
  }

  function openGymChat(charId) {
    var ch = GYM_CAST[charId];
    if (!ch) { console.warn('[gym-im] unknown char:', charId); return; }
    ensureOverlay();
    activeCharId = charId;
    var panel = overlayEl.querySelector('.gym-chat-panel');
    panel.style.setProperty('--gym-chat-color', ch.color);
    panel.style.setProperty('--gym-chat-bg', ch.bg);
    panel.innerHTML = [
      '<div class="gym-chat-header">',
      '  <div class="gym-chat-av"><img src="' + esc(ch.portrait.open) + '" alt="' + esc(ch.firstName) + '" loading="eager"></div>',
      '  <div class="gym-chat-who">',
      '    <div class="gym-chat-name">' + esc(ch.firstName) + '</div>',
      '    <div class="gym-chat-role-label">' + esc(ch.role) + '</div>',
      '  </div>',
      '  <button type="button" class="gym-chat-close" aria-label="Close">×</button>',
      '</div>',
      '<div class="gym-chat-thread"></div>',
      '<form class="gym-chat-form" autocomplete="off">',
      '  <input type="text" class="gym-chat-input" placeholder="Type a message..." maxlength="800" aria-label="Your message">',
      '  <button type="submit" class="gym-chat-send">Send</button>',
      '</form>',
      '<div class="gym-chat-disc">The Gym is not medical or clinical advice. For personal health concerns, talk to your doctor or physical therapist.</div>',
    ].join('');

    panel.querySelector('.gym-chat-close').addEventListener('click', closeGymChat);
    panel.querySelector('.gym-chat-form').addEventListener('submit', onSubmit);

    renderThread();
    lastFocused = document.activeElement;
    overlayEl.removeAttribute('hidden');
    document.body.style.overflow = 'hidden';
    panel.querySelector('.gym-chat-input').focus();
  }

  function closeGymChat() {
    if (!overlayEl) return;
    overlayEl.setAttribute('hidden', '');
    document.body.style.overflow = '';
    activeCharId = null;
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  async function onSubmit(e) {
    e.preventDefault();
    var inputEl = overlayEl.querySelector('.gym-chat-input');
    var sendBtn = overlayEl.querySelector('.gym-chat-send');
    var threadEl = overlayEl.querySelector('.gym-chat-thread');
    var text = (inputEl.value || '').trim();
    if (!text) return;

    if (!threads[activeCharId]) threads[activeCharId] = [];
    threads[activeCharId].push({ role: 'user', content: text });
    inputEl.value = '';
    inputEl.disabled = true;
    sendBtn.disabled = true;
    renderThread();

    var typingEl = document.createElement('div');
    typingEl.className = 'gym-chat-typing';
    typingEl.textContent = GYM_CAST[activeCharId].firstName + ' is typing';
    threadEl.appendChild(typingEl);
    threadEl.scrollTop = threadEl.scrollHeight;

    var charId = activeCharId;
    try {
      var res = await fetch('/.netlify/functions/gym-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: charId,
          history: threads[charId].map(function (m) { return { role: m.role, content: m.content }; }),
        }),
      });
      typingEl.remove();
      if (!res.ok) {
        var errBody = {}; try { errBody = await res.json(); } catch {}
        throw new Error(errBody.error || 'Server returned ' + res.status);
      }
      var data = await res.json();
      if (data.kind === 'error') throw new Error(data.error || 'Chat failed');
      threads[charId].push({
        role: 'assistant',
        content: data.reply || '(no reply)',
        kind: data.kind || 'answer',
        route_to: data.route_to || null,
      });
      renderThread();
    } catch (err) {
      typingEl.remove();
      var errEl = document.createElement('div');
      errEl.className = 'gym-chat-err';
      errEl.textContent = "Couldn't reach " + GYM_CAST[charId].firstName + '. ' + err.message;
      threadEl.appendChild(errEl);
      threadEl.scrollTop = threadEl.scrollHeight;
    } finally {
      inputEl.disabled = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }
  }

  // Expose globally
  window.openGymChat = openGymChat;
  window.closeGymChat = closeGymChat;

  // Delegated click handler for all [data-gym-char] buttons
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-gym-char]');
    if (!btn) return;
    openGymChat(btn.dataset.gymChar);
  });

})();
