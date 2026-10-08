/* HANDS-FREE MICROPHONE for the hologram page and the AR page, added 2026-10-07, Dr. O: "the speakerphone came in
   ... hologram and ar are set where you have to click on mic to speak, that was done because the mics were echoing
   back into the text box. can you make the mic always on so I can use the speakerphone with the hologram for Alice
   and AR for Kevin".

   TWO WAYS OF LISTENING, and the page picks one:

   1. THE SITE'S OWN EARS (engine "server"), used when /.netlify/functions/gc-listen says it is switched on. The page
      records the microphone itself, decides when somebody is speaking with the same method that works on Astra
      (a bar that follows the room, judged on the average of three tenths of a second), and sends each sentence as a
      short recording to gc-listen, which sends back the words. This never touches the browser's speech recognition,
      so there is NO CHIME: on an Android phone or tablet the browser's own listening plays the system "listening"
      sound every time it starts, which with always-on is a constant beep that a page cannot silence (Dr. O,
      2026-10-07: "a constant noise ... beeping that stops when I unclick"). It also works on iPhones and Firefox.
      It costs a little speech-to-text credit per sentence, which is why the endpoint has an off switch and caps.

   2. THE BROWSER'S OWN LISTENING (engine "browser"), the room.html approach ported: it stays on, a pause is the send.
      Used when the site's ears are switched off, and it is how this file first worked.

   BOTH share the same echo guard, ported from room.html (see the long comments by rec.onresult there): anything
   heard while the character is talking, or for three seconds after her audio stops, is thrown away, because the
   transcript of her own voice can land two or three seconds behind the audio.

   OFF UNLESS CHOSEN. A visitor on their own phone should not have an open microphone they did not ask for, so the
   switch is off by default, remembered in this browser once it is turned on, and can be set for a booth screen with
   ?mic=on in the address (?mic=off turns it back off). ?listen=browser or ?listen=site forces one way of listening,
   for testing.

   THIS REDUCES THE ECHO, IT DOES NOT CLOSE IT. A speakerphone that cancels its own echo is what makes this work well.

   Use:  var hf = gcHandsFree({ input, form, toggle, micButton, isBusy, say, state, identity });
         hf.setAvailable(true/false)   the page says when there is a character to talk to
         hf.speakingStart(audio)       call with every Audio the character is about to play                       */
(function () {
  var KEY = 'gc-hands-free';
  var TAIL_MS = 3000;
  var LISTEN_URL = '/.netlify/functions/gc-listen';

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

  /* ── the site's own ears ────────────────────────────────────────────────────────────────────────────────────
     Levels are the RMS of the samples, 0 to 1, over each tenth of a second at 16 kHz. Same rules as the Pi's
     hear_one(): the first tenths hold the opening pop and are skipped, the room level is the quietest of the first
     five tenths and then follows the room (down at once, up slowly), speech starts when the average of three tenths
     is 1.6 times the room, ends after 1.1 s of 1.25 times the room or less, the clip starts 0.8 s before the speech,
     a clip with no pause at all is the room having got louder, and a clip with under 0.3 s of real sound is a click. */
  var FRAME = 1600, MIN_LEVEL = 0.006, START_X = 1.6, END_X = 1.25, END_QUIET = 11, MAX_FRAMES = 120, PRE_FRAMES = 8, SKIP = 3;

  function makeEar(h) {
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx = null, stream = null, src = null, proc = null, mute = null, stopped = false;
    var ratio = 1, inBuf = new Float32Array(0), outPos = 0;
    var frame = new Int16Array(FRAME), fill = 0, sumSq = 0, count = 0;
    var floor = null, seed = [], recent = [], pre = [], clip = null, quiet = 0, voiced = 0, lowest = 1e9, started = false;

    function reset() { started = false; clip = null; pre = []; recent = []; quiet = 0; voiced = 0; lowest = 1e9; }

    function onFrame(f, lvl) {
      if (count++ < SKIP) return;
      if (h.gated()) { reset(); return; }                        // she is talking, or the tail of it, or working on an answer
      recent.push(lvl); if (recent.length > 3) recent.shift();
      var avg = recent.length === 3 ? (recent[0] + recent[1] + recent[2]) / 3 : null;
      if (floor === null) {
        seed.push(lvl);
        if (seed.length < 5) return;
        seed.sort(function (a, b) { return a - b; });
        floor = (seed[0] + seed[1] + seed[2]) / 3;
      }
      var thr = Math.max(MIN_LEVEL, floor * START_X), endThr = Math.max(MIN_LEVEL, floor * END_X);
      if (!started) {
        pre.push(f); if (pre.length > PRE_FRAMES) pre.shift();
        if (avg !== null && avg > thr) { started = true; clip = pre.slice(); voiced = 0; quiet = 0; lowest = 1e9; h.state('Hearing you'); }
        else if (lvl < thr) { floor = lvl < floor ? 0.5 * floor + 0.5 * lvl : floor + (lvl - floor) * 0.02; }
      } else {
        clip.push(f);
        var a = avg !== null ? avg : lvl;
        lowest = Math.min(lowest, a);
        if (lvl > thr) voiced++;
        quiet = a < endThr ? quiet + 1 : 0;
        if (quiet >= END_QUIET || clip.length > MAX_FRAMES) {
          var frames = clip, nQuiet = quiet, tooLong = clip.length > MAX_FRAMES, low = lowest, v = voiced;
          reset();
          if (tooLong && low > endThr) { floor = low; h.state('Listening'); return; }     // no pause in 12 s: that was the room
          if (v < 3) { h.state('Listening'); return; }                                    // a click or a cough
          h.onClip(frames.slice(0, frames.length - Math.max(0, nQuiet - 3)));             // keep 0.3 s of the quiet at the end
        }
      }
    }

    function resample(input) {
      var buf = new Float32Array(inBuf.length + input.length);
      buf.set(inBuf, 0); buf.set(input, inBuf.length);
      var out = [];
      while (outPos + 1 < buf.length) {
        var i = Math.floor(outPos), f = outPos - i;
        out.push(buf[i] * (1 - f) + buf[i + 1] * f);
        outPos += ratio;
      }
      var drop = Math.floor(outPos);
      inBuf = buf.slice(drop); outPos -= drop;
      return out;
    }

    function onAudio(e) {
      if (stopped) return;
      var out = resample(e.inputBuffer.getChannelData(0));
      for (var k = 0; k < out.length; k++) {
        var x = Math.max(-1, Math.min(1, out[k]));
        frame[fill++] = x < 0 ? x * 32768 : x * 32767;
        sumSq += x * x;
        if (fill === FRAME) { onFrame(frame.slice(), Math.sqrt(sumSq / FRAME)); fill = 0; sumSq = 0; }
      }
    }

    return {
      start: function () {
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
          .then(function (s) {
            if (stopped) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
            stream = s; ctx = new AC(); ratio = ctx.sampleRate / 16000;
            src = ctx.createMediaStreamSource(s);
            proc = ctx.createScriptProcessor(4096, 1, 1);
            mute = ctx.createGain(); mute.gain.value = 0;                  // the processor only runs while it is connected on
            proc.onaudioprocess = onAudio;
            src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
            var wake = function () { if (ctx && ctx.state !== 'running') ctx.resume(); };
            wake();
            setTimeout(function () {
              if (ctx && ctx.state !== 'running' && !stopped) {
                h.state('Tap the screen once to start listening');
                document.addEventListener('pointerdown', function once() { wake(); document.removeEventListener('pointerdown', once); h.state('Listening'); });
              }
            }, 600);
            h.state('Listening');
          })
          .catch(function (err) { h.fail(err); });
      },
      stop: function () {
        stopped = true;
        try { if (proc) { proc.onaudioprocess = null; proc.disconnect(); } if (src) src.disconnect(); if (mute) mute.disconnect(); } catch (_) {}
        try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_) {}
        try { if (ctx) ctx.close(); } catch (_) {}
      }
    };
  }

  /* 16 kHz mono 16 bit WAV, base64, from the frames of Int16 samples. */
  function wavBase64(frames) {
    var n = frames.length * FRAME, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    function str(at, s) { for (var i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * 2, true);
    var at = 44;
    for (var f = 0; f < frames.length; f++) for (var i = 0; i < FRAME; i++) { v.setInt16(at, frames[f][i], true); at += 2; }
    var bytes = new Uint8Array(buf), bin = '';
    for (var k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
    return btoa(bin);
  }

  window.gcHandsFree = function (o) {
    var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    var canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (window.AudioContext || window.webkitAudioContext));
    var api = { supported: !!Rec || canRecord, isOn: function () { return false; }, setAvailable: function () {}, speakingStart: function () {} };
    if (!Rec && !canRecord) { if (o.toggle) o.toggle.style.display = 'none'; return api; }

    var pref = saved(), available = false, running = false, rec = null, ear = null;
    var engine = null, asking = false, forced = '';
    var speaking = null, quietUntil = 0;
    var pending = '', lastFinal = '', pendingBefore = '', pauseTimer = null;
    var restartAt = 0, quickEnds = 0, netErrors = 0;
    var sending = false, queued = null, sendErrors = 0;

    try {
      var params = new URLSearchParams(location.search);
      var q = params.get('mic');
      if (q === 'on') { pref = true; store(true); }
      else if (q === 'off') { pref = false; store(false); }
      forced = String(params.get('listen') || '').toLowerCase();
    } catch (_) {}

    /* 2026-10-08, Dr. O: the beeping was fixed on the hologram page and not on AR. The code is the same on both, so the status line now
       says which way of listening this page chose: "site ears" (no beep) or "browser ears" (the Android beep). */
    function state(t) {
      if (t && o.state) {
        var tag = engine === 'server' ? ' (site ears)' : engine === 'browser' ? ' (browser ears)' : '';
        try { o.state(t + tag); } catch (_) {}
      } else if (o.state) { try { o.state(t); } catch (_) {} }
    }
    function say(t) { if (o.say) o.say(t); }
    function gated() { return !!speaking || Date.now() < quietUntil || !!(o.isBusy && o.isBusy()); }

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

    function turnOff(message) {
      pref = false; store(false); paint(); stop();
      if (message) say(message);
    }

    /* ── the browser's own listening ─────────────────────────────────────────────────────────────────────── */
    function startBrowser() {
      if (running || !Rec) return;
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
        if (quickEnds > 6) { turnOff('The microphone keeps switching itself off, so I turned always on off. Press Mic to try again.'); return; }
        setTimeout(start, 300);
      };

      rec.onerror = function (e) {
        if (e && e.error && e.error !== 'no-speech' && e.error !== 'aborted') state('Microphone problem: ' + e.error);
        if (e && (e.error === 'not-allowed' || e.error === 'service-not-allowed')) {
          turnOff('The microphone is blocked. Allow it for this site (the icon in the address bar), then press Mic again.');
        } else if (e && e.error === 'network') {
          netErrors++;
          if (netErrors >= 3) turnOff('The listening service cannot be reached right now, so always on is off. Type instead, or try again in a moment.');
        }
        /* no-speech and aborted are ordinary. onend starts it again. */
      };

      restartAt = Date.now();
      try { rec.start(); running = true; netErrors = 0; state('Listening'); }
      catch (err) { running = false; state('Could not start the microphone: ' + (err && err.name ? err.name : err)); }
    }

    /* ── the site's own ears ─────────────────────────────────────────────────────────────────────────────── */
    function handleText(text) {
      sendErrors = 0;
      text = String(text || '').trim();
      if (!text) { state('Listening'); return; }
      if (gated()) { state('Quiet while she talks'); return; }        // arrived while she was talking: her own voice
      pending = (pending + ' ' + text).trim();
      o.input.value = pending;
      state('Heard you');
      clearTimeout(pauseTimer);
      /* The recording already ended on a real pause, so send soon. A very short one may be the start of a longer
         thought split by a breath, so give it a moment to be followed. */
      pauseTimer = setTimeout(send, pending.length < 25 ? 1500 : 300);
    }

    function postClip(b64) {
      if (sending) { queued = b64; return; }                            // one at a time; the newest waits its turn
      sending = true; state('Sending');
      var body = { audio: b64, mime: 'audio/wav', is_demo: true };
      if (o.identity) { try { var id = o.identity() || {}; for (var k in id) body[k] = id[k]; } catch (_) {} }
      fetch(LISTEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json(); })
        .then(function (j) { sending = false; handleReply(j || {}); next(); })
        .catch(function () {
          sending = false; sendErrors++;
          if (sendErrors >= 3) turnOff('The site cannot be reached right now, so always on is off. Type instead, or try again in a moment.');
          else state('Listening');
          next();
        });
    }
    function next() { if (queued && !sending) { var b = queued; queued = null; postClip(b); } }

    function handleReply(j) {
      if (typeof j.text === 'string') { handleText(j.text); return; }
      if (j.listening_off) {
        /* Switched off on the server after this page started: go back to the browser's own listening if there is one. */
        stop(); engine = Rec ? 'browser' : 'none';
        if (engine === 'none') { turnOff('Listening is switched off on the site right now. Type instead.'); return; }
        sync(); return;
      }
      if (j.daily_capped) { turnOff('Listening is used up for today on this device. You can still type.'); return; }
      sendErrors++;
      if (sendErrors >= 3) turnOff('Listening is not working right now, so always on is off. Type instead, or try again in a moment.');
      else state('Listening');
    }

    function startServer() {
      if (running) return;
      running = true;
      ear = makeEar({
        gated: gated,
        state: function (t) { if (!sending) state(t); },
        onClip: function (frames) { postClip(wavBase64(frames)); },
        fail: function (err) {
          running = false; ear = null;
          var name = err && err.name;
          if (name === 'NotAllowedError' || name === 'SecurityError') turnOff('The microphone is blocked. Allow it for this site (the icon in the address bar), then press Mic again.');
          else if (name === 'NotFoundError') turnOff('No microphone was found on this device.');
          else turnOff('Could not start the microphone' + (name ? ' (' + name + ')' : '') + '. Type instead.');
        }
      });
      ear.start();
    }

    /* ── choosing, starting, stopping ────────────────────────────────────────────────────────────────────── */
    function chooseEngine(cb) {
      function browser() { cb(Rec ? 'browser' : 'none'); }
      if (forced === 'browser') { browser(); return; }
      if (!canRecord) { browser(); return; }
      if (forced === 'site') { cb('server'); return; }
      var done = false, t = setTimeout(function () { if (!done) { done = true; browser(); } }, 4000);
      fetch(LISTEN_URL, { method: 'GET' })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (done) return; done = true; clearTimeout(t); if (j && j.enabled) cb('server'); else browser(); })
        .catch(function () { if (done) return; done = true; clearTimeout(t); browser(); });
    }

    function start() {
      if (running || !pref || !available || document.hidden) return;
      if (engine === 'server') { startServer(); return; }
      if (engine === 'browser') { startBrowser(); return; }
      if (engine === 'none') return;
      if (asking) return;
      asking = true; state('Checking how to listen');
      chooseEngine(function (e) {
        asking = false; engine = e;
        if (e === 'none') { turnOff('This browser cannot listen. Type instead.'); return; }
        sync();
      });
    }

    function stop() {
      state(pref ? 'Waiting' : '');
      clearTimeout(pauseTimer);
      if (rec) { try { rec.onend = null; rec.abort(); } catch (_) {} }
      if (ear) { try { ear.stop(); } catch (_) {} ear = null; }
      queued = null;
      running = false;
    }

    function sync() {
      paint();
      if (pref && available && !document.hidden) start(); else stop();
    }

    api.supported = true;
    api.engine = function () { return engine; };
    api.isOn = function () { return pref && available; };
    api.setAvailable = function (b) {
      available = !!b;
      if (o.toggle) o.toggle.style.display = available ? '' : 'none';
      if (!available) clearPending();
      sync();
    };
    api.speakingStart = function (audio) {
      /* 2026-10-07: "she is talking" used to start the moment the audio was made. If the browser then refused to play
         it (or the voice failed), nothing ever said she had stopped, and the microphone stayed deaf for good. It now
         starts when her audio really begins, ends on any way it can stop, and gives up by itself after 90 seconds. */
      quietUntil = Date.now() + TAIL_MS;
      clearTimeout(pauseTimer); pending = ''; lastFinal = ''; pendingBefore = '';
      if (o.input) o.input.value = '';
      var failsafe = null;
      var done = function () {
        clearTimeout(failsafe);
        if (speaking === audio) speaking = null;
        quietUntil = Date.now() + TAIL_MS;                                // counted from when her audio really stops
      };
      audio.addEventListener('playing', function () {
        speaking = audio; quietUntil = Date.now() + TAIL_MS;
        clearTimeout(failsafe); failsafe = setTimeout(done, 90000);
      });
      ['ended', 'pause', 'error', 'abort', 'emptied', 'stalled'].forEach(function (name) { audio.addEventListener(name, done); });
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
