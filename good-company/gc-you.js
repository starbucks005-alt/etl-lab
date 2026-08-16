/* ═══════════════════════════════════════════════════════════════════════════
   GOOD COMPANY — WHO YOU ARE
   The host's identity, and the guest's. Same panel, same store, both modes.

   WHY THIS EXISTS. The friend has to address people correctly, and a room with
   two humans in it has to show which line came from whom. Neither works from a
   name alone.

   PRONOUNS ARE ASKED, NEVER GUESSED. A name does not tell you anybody's
   pronouns, and inferring them from one misgenders a real person in a way the
   neutral default never does. So they/them is the default here, the chips are
   not ordered to lead anywhere, and nothing is derived from the name.

   THE AVATAR NEVER LEAVES THE BROWSER AS A FILE. It is resized to a small
   square on the canvas and kept as a data URL, a few KB, which means:
     * no storage bucket, no CDN, no upload endpoint, no moderation pipeline
     * a guest with no account can still have a face
     * nothing large is ever sent anywhere
   An emoji is the zero-cost option and the default offer, exactly as The Dose
   conference room does it.
   ═══════════════════════════════════════════════════════════════════════════ */

var GC_AVATAR_PX = 96;          // plenty for a 32px circle on a retina screen
var GC_AVATAR_MAX = 60 * 1024;  // refuse anything that will not shrink under this

/* Deliberately unordered as a set of "normal" and "other". They/them sits
   first because it is the default, not because it is preferred. */
var GC_PRONOUNS = ['they / them', 'she / her', 'he / him'];

var GC_EMOJI = ['🙂','🌿','🌙','☕','🐦','🎣','🧶','📚','🎸','🌻','🐈','🍞','⚓','🎬','🧭','🌵'];

function gcLoadYou() {
  var you = null;
  try { you = JSON.parse(localStorage.getItem('gc-you') || 'null'); } catch (e) {}
  if (!you || typeof you !== 'object') you = {};
  return {
    name:     you.name || '',
    saidAs:   you.saidAs || '',
    pronouns: you.pronouns || 'they / them',
    emoji:    you.emoji || '🙂',
    photo:    you.photo || null      // data URL, or null when using the emoji
  };
}

function gcSaveYou(you) {
  try { localStorage.setItem('gc-you', JSON.stringify(you)); } catch (e) {}
  return you;
}

/* Draws the file into a small square and hands back a data URL. Cropped from
   the centre so a portrait does not come out as a stretched face. */
function gcShrinkImage(file, cb) {
  if (!file || !/^image\//.test(file.type)) return cb('not_an_image');
  var reader = new FileReader();
  reader.onerror = function () { cb('unreadable'); };
  reader.onload = function () {
    var img = new Image();
    img.onerror = function () { cb('not_an_image'); };
    img.onload = function () {
      var side = Math.min(img.width, img.height);
      var c = document.createElement('canvas');
      c.width = c.height = GC_AVATAR_PX;
      var g = c.getContext('2d');
      g.drawImage(img,
        (img.width - side) / 2, (img.height - side) / 2, side, side,
        0, 0, GC_AVATAR_PX, GC_AVATAR_PX);
      var url = c.toDataURL('image/jpeg', 0.82);
      if (url.length > GC_AVATAR_MAX) return cb('too_big');
      cb(null, url);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

/* Builds the panel into `host`. onSave fires with the saved object. */
function gcMountYou(host, onSave) {
  var you = gcLoadYou();

  host.innerHTML = '';
  host.className = 'you-panel';

  function row(label) {
    var d = document.createElement('div');
    d.className = 'you-row';
    var l = document.createElement('label');
    l.className = 'you-label'; l.textContent = label;
    d.appendChild(l);
    return d;
  }

  /* ── the face ── */
  var faceRow = row('Your picture');
  var face = document.createElement('div'); face.className = 'you-face';

  var preview = document.createElement('div'); preview.className = 'you-preview';
  function paintPreview() {
    preview.innerHTML = '';
    if (you.photo) {
      var im = document.createElement('img'); im.src = you.photo; im.alt = '';
      preview.appendChild(im);
    } else {
      preview.textContent = you.emoji;
    }
  }
  paintPreview();
  face.appendChild(preview);

  var emojiWrap = document.createElement('div'); emojiWrap.className = 'you-emoji';
  GC_EMOJI.forEach(function (e) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'you-e' + (!you.photo && you.emoji === e ? ' on' : '');
    b.textContent = e;
    b.addEventListener('click', function () {
      you.emoji = e; you.photo = null;          // an emoji replaces a photo
      Array.prototype.forEach.call(emojiWrap.children, function (c) { c.classList.remove('on'); });
      b.classList.add('on');
      paintPreview();
    });
    emojiWrap.appendChild(b);
  });
  face.appendChild(emojiWrap);

  var up = document.createElement('label');
  up.className = 'btn you-upload';
  up.textContent = 'Use a photo';
  var file = document.createElement('input');
  file.type = 'file'; file.accept = 'image/*'; file.hidden = true;
  var err = document.createElement('span'); err.className = 'you-err';
  file.addEventListener('change', function () {
    err.textContent = '';
    gcShrinkImage(file.files && file.files[0], function (problem, url) {
      if (problem) {
        /* Says which problem, rather than failing quietly. */
        err.textContent = problem === 'too_big'
          ? 'That one will not shrink small enough. Try another.'
          : 'That file is not an image I can read.';
        return;
      }
      you.photo = url;
      Array.prototype.forEach.call(emojiWrap.children, function (c) { c.classList.remove('on'); });
      paintPreview();
    });
  });
  up.appendChild(file);
  face.appendChild(up);
  faceRow.appendChild(face);
  faceRow.appendChild(err);
  host.appendChild(faceRow);

  /* ── the name ── */
  var nameRow = row('What should they call you');
  var name = document.createElement('input');
  name.type = 'text'; name.value = you.name; name.placeholder = 'Any name you like';
  name.autocomplete = 'off';
  nameRow.appendChild(name);
  host.appendChild(nameRow);

  /* ── HOW IT SOUNDS ──────────────────────────────────────────────────────────
     Dr. O, 2026-08-16, after hearing Arch say her name out loud. A friend who
     says your name often and says it WRONG every time is worse than one who
     never says it. For a lot of people, having their name mangled IS the
     experience of not being seen, and this product cannot afford to reproduce
     that every few lines.

     Written phonetically by the person themselves, because they are the only
     authority on it. Only the SPOKEN text gets substituted; everything on
     screen keeps the real spelling, which is the entire point. */
  var sayRow = row('How do you say it');
  var sayNote = document.createElement('p');
  sayNote.className = 'you-note';
  sayNote.textContent = 'Only if it gets said wrong a lot. Write it how it sounds, like SHAWN-ay. ' +
                        'Your name stays spelled properly everywhere you can see it.';
  sayRow.appendChild(sayNote);
  var saidAs = document.createElement('input');
  saidAs.type = 'text';
  saidAs.value = you.saidAs || '';
  saidAs.autocomplete = 'off';
  saidAs.placeholder = 'how it sounds';
  sayRow.appendChild(saidAs);
  host.appendChild(sayRow);

  /* ── pronouns ── */
  var pRow = row('Your pronouns');
  var note = document.createElement('p');
  note.className = 'you-note';
  note.textContent = 'So they talk about you correctly. Nothing is guessed from your name.';
  pRow.appendChild(note);
  var chips = document.createElement('div'); chips.className = 'chips';
  var other = document.createElement('input');
  other.type = 'text'; other.className = 'you-other';
  other.placeholder = 'or type your own'; other.autocomplete = 'off';
  if (GC_PRONOUNS.indexOf(you.pronouns) === -1) other.value = you.pronouns;

  GC_PRONOUNS.forEach(function (p) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'chip' + (you.pronouns === p ? ' on' : '');
    b.textContent = p;
    b.addEventListener('click', function () {
      you.pronouns = p; other.value = '';
      Array.prototype.forEach.call(chips.children, function (c) { c.classList.remove('on'); });
      b.classList.add('on');
    });
    chips.appendChild(b);
  });
  pRow.appendChild(chips);
  pRow.appendChild(other);
  host.appendChild(pRow);

  /* ── done ── */
  var save = document.createElement('button');
  save.type = 'button'; save.className = 'btn go you-save'; save.textContent = 'Save';
  save.addEventListener('click', function () {
    you.name = name.value.trim();
    you.saidAs = saidAs.value.trim();
    var typed = other.value.trim();
    if (typed) you.pronouns = typed;
    if (!you.pronouns) you.pronouns = 'they / them';
    gcSaveYou(you);
    if (onSave) onSave(you);
  });
  host.appendChild(save);

  return you;
}
