/* HANDS-FREE MICROPHONE for the hologram page and the AR page, added 2026-10-07, Dr. O: "the speakerphone came in
   ... hologram and ar are set where you have to click on mic to speak, that was done because the mics were echoing
   back into the text box. can you make the mic always on so I can use the speakerphone with the hologram for Alice
   and AR for Kevin".

   The same thing room.html already does, ported rather than invented, and for the same reasons (see the long
   comments by rec.onresult in room.html): it stays on, a pause is the send, and anything heard while the character
   is talking, or for three seconds after, is thrown away, because the transcript of her own voice can land two or
   three seconds behind the audio. The window is pushed forward every time something is heard inside it, and again
   when her audio actually stops.

   OFF UNLESS CHOSEN. A visitor on their own phone should not have an open microphone they did not ask for, so the
   switch is off by default, remembered in this browser once it is turned on, and can be set for a booth screen with
   ?mic=on in the address (?mic=off turns it back off).

   THIS REDUCES THE ECHO, IT DOES NOT CLOSE IT. The speech recognition built into the browser gives no control over
   the microphone's own audio. A speakerphone that cancels its own echo is what makes this work well.

   Use:  var hf = gcHandsFree({ input, form, toggle, micButton, isBusy, say });
         hf.setAvailable(true/false)   the page says when there is a character to talk to
         hf.speakingStart(audio)       call with every Audio the character is about to play                       */
(function () {
  var KEY = 'gc-hands-free';
  var TAIL_MS = 3000;

  function words(s) { return String(s).toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(Boolean); }

  /* A final result that begins with the previous final result is the same sentence, longer, not a new one
     (room.html, 2026-09-20: one sentence came out as "this this this is this is this is Charlotte's ..."). */
  function growsFrom(prev, cur) {
    var p = words(prev), c = words(cur);
    if (!p.length || c.length < p.length) return false;
    var same = 0;
    for (var k = 0; k < p.length; k++) { if (p[k] === c[k]) same++; }
    return same >= Math.max(1, Math.ceil(p.length * 0.6)) && p[0] === c[0];
  }

  function store(v) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (_) {} }
  function saved() { try { return localStorage.getItem(KEY) === '1'; } catch (_) { return false; } }

  window.gcHandsFree = function (o) {
    var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    var api = { supported: !!Rec, isOn: function () { return false; }, setAvailable: function () {}, speakingStart: function () {} };
    if (!Rec) { if (o.toggle) o.toggle.style.display = 'none'; return api; }

    var pref = saved(), available = false, running = false, rec = null;
    var speaking = null, quietUntil = 0;
    var pending = '', lastFinal = '', pendingBefore = '', pauseTimer = null;
    var restartAt = 0, quickEnds = 0, netErrors = 0;

    try {
      var q = new URLSearchParams(location.search).get('mic');
      if (q === 'on') { pref = true; store(true); }
      else if (q === 'off') { pref = false; store(false); }
    } catch (_) {}

    function state(t) { if (o.state) { try { o.state(t); } catch (_) {} } }

    function paint() {
      var on = pref && available;
      if (o.toggle) {
        o.toggle.textContent = pref ? 'Mic: always on' : 'Mic: tap to talk';
        o.toggle.classList.toggle('listening', pref);
        o.toggle.setAttribute('aria-pressed', pref ? 'true' : 'false');
        o.toggle.title = pref
          ? 'The microphone stays on. Pause and it sends. She does not hear herself while she talks.'
          : 'Press to keep the microphone on, so you can talk without pressing anything.';
      }
      if (o.micButton) {
        o.micButton.disabled = on;
        o.micButton.title = on ? 'The microphone is always on. Turn that off to use this button.' : '';
      }
    }

    function clearPending() {
      clearTimeout(pauseTimer);
      pending = ''; lastFinal = ''; pendingBefore = '';
      if (o.input) o.input.value = '';
    }

    function send() {
      var text = o.input.value.trim();
      pending = ''; lastFinal = ''; pendingBefore = '';
      if (!text) return;
      if (o.isBusy && o.isBusy()) { o.input.value = ''; return; }     // she is still working on the last thing said
      state('Sent');
      if (o.form.requestSubmit) o.form.requestSubmit(); else o.form.dispatchEvent(new Event('submit', { cancelable: true }));
    }

    function start() {
      if (running || !pref || !available || document.hidden) return;
      rec = new Rec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = navigator.language || 'en-US';
      var taken = 0;

      rec.onresult = function (e) {
        if (speaking) quietUntil = Date.now() + TAIL_MS;
        if (speaking || Date.now() < quietUntil) { state('Quiet while she talks'); return; }       // her own voice, or the tail of it
        if (o.isBusy && o.isBusy()) { state('Waiting for her answer'); return; }
        state('Hearing you');
        var gotFinal = false;
        for (var i = Math.max(e.resultIndex, taken); i < e.results.length; i++) {
          if (e.results[i].isFinal) {
            var chunk = e.results[i][0].transcript.trim();
            taken = i + 1;
            if (chunk) {
              if (lastFinal && growsFrom(lastFinal, chunk) && pending.slice(-lastFinal.length) === lastFinal) pending = pendingBefore;
              else pendingBefore = pending;
              lastFinal = chunk;
              pending = (pending + ' ' + chunk).trim();
              gotFinal = true;
            }
          } else {
            o.input.value = (pending ? pending + ' ' : '') + e.results[i][0].transcript;      // show it forming
          }
        }
        if (gotFinal || pending) {
          o.input.value = pending;
          /* A pause is the send, but not a pause in the middle of a sentence: room.html learned that cutting somebody
             off costs them the sentence, while waiting a moment costs nothing. Shorter than room.html, because this
             is a conversation across a table, not a message to a room. */
          var wait = pending.length < 25 ? 3000 : 2000;
          clearTimeout(pauseTimer);
          pauseTimer = setTimeout(send, wait);
        }
      };

      rec.onend = function () {
        running = false; taken = 0; lastFinal = '';
        if (!(pref && available && !document.hidden)) return;
        /* Chrome ends the session on its own after a while; start it again so "always on" is true. If it keeps ending
           at once, something is wrong (no microphone, blocked), so stop rather than spin. */
        var now = Date.now();
        quickEnds = (now - restartAt < 1500) ? quickEnds + 1 : 0;
        if (quickEnds > 6) {
          pref = false; store(false); paint();
          if (o.say) o.say('The microphone keeps switching itself off, so I turned always on off. Press Mic to try again.');
          return;
        }
        setTimeout(start, 300);
      };

      rec.onerror = function (e) {
        if (e && e.error && e.error !== 'no-speech' && e.error !== 'aborted') state('Microphone problem: ' + e.error);
        if (e && (e.error === 'not-allowed' || e.error === 'service-not-allowed')) {
          pref = false; store(false); paint();
          if (o.say) o.say('The microphone is blocked. Allow it for this site (the icon in the address bar), then press Mic again.');
        } else if (e && e.error === 'network') {
          netErrors++;
          if (netErrors >= 3) {
            pref = false; store(false); paint();
            if (o.say) o.say('The listening service cannot be reached right now, so always on is off. Type instead, or try again in a moment.');
          }
        }
        /* no-speech and aborted are ordinary. onend starts it again. */
      };

      restartAt = Date.now();
      try { rec.start(); running = true; netErrors = 0; state('Listening'); }
      catch (err) { running = false; state('Could not start the microphone: ' + (err && err.name ? err.name : err)); }
    }

    function stop() {
      state(pref ? 'Waiting' : '');
      clearTimeout(pauseTimer);
      if (rec) { try { rec.onend = null; rec.abort(); } catch (_) {} }
      running = false;
    }

    function sync() {
      paint();
      if (pref && available && !document.hidden) start(); else stop();
    }

    api.supported = true;
    api.isOn = function () { return pref && available; };
    api.setAvailable = function (b) {
      available = !!b;
      if (o.toggle) o.toggle.style.display = available ? '' : 'none';
      if (!available) clearPending();
      sync();
    };
    api.speakingStart = function (audio) {
      speaking = audio; quietUntil = Date.now() + TAIL_MS;
      clearTimeout(pauseTimer); pending = ''; lastFinal = ''; pendingBefore = '';
      if (o.input) o.input.value = '';
      var done = function () {
        if (speaking === audio) speaking = null;
        quietUntil = Date.now() + TAIL_MS;                                // counted from when her audio really stops
      };
      audio.addEventListener('ended', done);
      audio.addEventListener('pause', done);
      audio.addEventListener('error', done);
    };

    if (o.toggle) {
      o.toggle.addEventListener('click', function () {
        pref = !pref; store(pref);
        if (!pref) clearPending();
        sync();
      });
    }
    document.addEventListener('visibilitychange', sync);
    if (o.toggle) o.toggle.style.display = 'none';          // shown when the page says there is someone to talk to
    paint();
    return api;
  };
})();
