/* ═══════════════════════════════════════════════════════════════════════════
   GOOD COMPANY — WHO YOU ARE
   The host's identity, and the guest's. Same panel, same store, both modes.

   WHY THIS EXISTS. The friend has to address people correctly, and a room with
   two humans in it has to show which line came from whom. Neither works from a
   name alone.

   PRONOUNS ARE ASKED, NEVER GUESSED. A name does not tell you anybody's
   pronouns, and inferring them from one misgenders a real person in a way the
   neutral default never does. So they/them is the default here, and nothing
   is derived from the name. Chip order (see GC_PRONOUNS below) is a separate
   choice from the default value -- moving they/them to the last chip does
   not change what somebody gets if they never touch the chips at all.

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

/* ORDER CHANGED 2026-08-26, Dr. O direct: they/them moved LAST. It is still
   the default value (see gcLoadYou() below), unrelated to this display
   order -- a person who never touches the chips still gets they/them either
   way. This only changes which chip a reader's eye lands on first. */
var GC_PRONOUNS = ['she / her', 'he / him', 'they / them'];

/* REPLACED 2026-08-26, Dr. O direct: "human avatars." The emoji set that
   used to live here (revised once already, from a pile of hobby objects to
   a set of moods) never solved the actual problem -- at picker size and
   count ANY emoji reads as an emoji, not a picture of a person, which is
   what a "your picture" slot should offer. These are small flat illustrated
   busts instead, in the style of the reference image she sent: a colored
   circle with a simple person in it. Genuine variety in skin tone and hair
   on purpose, same diversity-is-never-remarked-on standard as the cast
   itself [[etl-cast-diversity-theme]]. Each carries a plain-English label,
   not just an id -- see the `avatar` field sent to gc-chat.js below, which
   used to be a raw emoji character and is a real description now, which
   the model can actually do something with. */
var GC_AVATARS = [
  { id: 'a1', label: 'a woman with short curly dark hair',
    svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
         '<rect width="100" height="100" fill="#c1694f"/>' +
         '<path d="M14 100C14 66 30 58 50 58C70 58 86 66 86 100Z" fill="#f0c8a0"/>' +
         '<circle cx="50" cy="40" r="22" fill="#f0c8a0"/>' +
         '<path d="M28 38a22 22 0 0 1 44 0Q72 24 50 22Q28 24 28 38Z" fill="#2b2320"/>' +
         '<circle cx="34" cy="24" r="5" fill="#2b2320"/><circle cx="42" cy="19" r="5" fill="#2b2320"/>' +
         '<circle cx="50" cy="17" r="5" fill="#2b2320"/><circle cx="58" cy="19" r="5" fill="#2b2320"/>' +
         '<circle cx="66" cy="24" r="5" fill="#2b2320"/></svg>' },
  { id: 'a2', label: 'a woman with long wavy brown hair',
    svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
         '<rect width="100" height="100" fill="#7c9473"/>' +
         '<path d="M14 100C14 66 30 58 50 58C70 58 86 66 86 100Z" fill="#d9a066"/>' +
         '<circle cx="50" cy="40" r="22" fill="#d9a066"/>' +
         '<path d="M28 38a22 22 0 0 1 44 0v34c-4-4-6-10-6-18v-8a16 16 0 0 0-32 0v8c0 8-2 14-6 18z" fill="#4a3427"/>' +
         '</svg>' },
  { id: 'a3', label: 'a man with a shaved head',
    svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
         '<rect width="100" height="100" fill="#5b7c99"/>' +
         '<path d="M14 100C14 66 30 58 50 58C70 58 86 66 86 100Z" fill="#5c3a26"/>' +
         '<circle cx="50" cy="40" r="22" fill="#5c3a26"/>' +
         '<ellipse cx="44" cy="30" rx="6" ry="3" fill="#fff" opacity="0.15"/></svg>' },
  { id: 'a4', label: 'a woman with her hair in a bun',
    svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
         '<rect width="100" height="100" fill="#c9a227"/>' +
         '<path d="M14 100C14 66 30 58 50 58C70 58 86 66 86 100Z" fill="#b97a4e"/>' +
         '<circle cx="50" cy="40" r="22" fill="#b97a4e"/>' +
         '<path d="M28 38a22 22 0 0 1 44 0Q72 24 50 22Q28 24 28 38Z" fill="#6b4a30"/>' +
         '<circle cx="50" cy="12" r="9" fill="#6b4a30"/></svg>' },
  { id: 'a5', label: 'a man with an afro',
    svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
         '<rect width="100" height="100" fill="#7d5a7c"/>' +
         '<path d="M14 100C14 66 30 58 50 58C70 58 86 66 86 100Z" fill="#8a5636"/>' +
         '<circle cx="50" cy="34" r="30" fill="#2b2320"/>' +
         '<circle cx="50" cy="40" r="22" fill="#8a5636"/></svg>' },
  { id: 'a6', label: 'a woman in a headscarf',
    svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
         '<rect width="100" height="100" fill="#5c6670"/>' +
         '<path d="M14 100C14 66 30 58 50 58C70 58 86 66 86 100Z" fill="#d9a066"/>' +
         '<circle cx="50" cy="40" r="22" fill="#d9a066"/>' +
         '<path d="M26 70V38a24 24 0 0 1 48 0v32c-4-10-6-20-6-30a18 18 0 0 0-36 0c0 10-2 20-6 30z" fill="#a8542e"/>' +
         '</svg>' },
  { id: 'a7', label: 'a woman with a short bob',
    svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
         '<rect width="100" height="100" fill="#a8542e"/>' +
         '<path d="M14 100C14 66 30 58 50 58C70 58 86 66 86 100Z" fill="#f0c8a0"/>' +
         '<circle cx="50" cy="40" r="22" fill="#f0c8a0"/>' +
         '<path d="M28 46V36a22 22 0 0 1 44 0v10c-3-2-5-8-5-14a17 17 0 0 0-34 0c0 6-2 12-5 14z" fill="#2b2320"/>' +
         '</svg>' },
  { id: 'a8', label: 'a man with a buzz cut',
    svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
         '<rect width="100" height="100" fill="#457f7f"/>' +
         '<path d="M14 100C14 66 30 58 50 58C70 58 86 66 86 100Z" fill="#5c3a26"/>' +
         '<circle cx="50" cy="40" r="22" fill="#5c3a26"/>' +
         '<circle cx="50" cy="40" r="22" fill="none" stroke="#2b2320" stroke-width="4" opacity="0.5"/></svg>' },
  { id: 'a9', label: 'an older woman with long gray hair',
    svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
         '<rect width="100" height="100" fill="#b89b6c"/>' +
         '<path d="M14 100C14 66 30 58 50 58C70 58 86 66 86 100Z" fill="#b97a4e"/>' +
         '<circle cx="50" cy="40" r="22" fill="#b97a4e"/>' +
         '<path d="M27 40a23 23 0 0 1 46 0v32c-3-3-5-9-5-16v-10a18 18 0 0 0-36 0v10c0 7-2 13-5 16z" fill="#8f8f8f"/>' +
         '</svg>' },
  { id: 'a10', label: 'a woman with curly shoulder-length hair',
    svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
         '<rect width="100" height="100" fill="#b06774"/>' +
         '<path d="M14 100C14 66 30 58 50 58C70 58 86 66 86 100Z" fill="#d9a066"/>' +
         '<circle cx="50" cy="40" r="22" fill="#d9a066"/>' +
         '<path d="M28 50V38a22 22 0 0 1 44 0v12c-3-3-5-9-5-16a17 17 0 0 0-34 0c0 7-2 13-5 16z" fill="#7a3b2e"/>' +
         '<circle cx="34" cy="24" r="5" fill="#7a3b2e"/><circle cx="42" cy="19" r="5" fill="#7a3b2e"/>' +
         '<circle cx="50" cy="17" r="5" fill="#7a3b2e"/><circle cx="58" cy="19" r="5" fill="#7a3b2e"/>' +
         '<circle cx="66" cy="24" r="5" fill="#7a3b2e"/></svg>' }
];

/* Looked up by id from a few places (the picker itself, a chat bubble's
   little face, the room's own preview) so nobody hand-copies the fallback
   logic three different ways. Falls back to the first avatar rather than
   rendering nothing if an id does not match -- a guest with an old or
   corrupted save should never end up with a blank circle. */
function gcAvatarById(id) {
  var found = null;
  GC_AVATARS.forEach(function (a) { if (a.id === id) found = a; });
  return found || GC_AVATARS[0];
}
function gcAvatarSvg(id) { return gcAvatarById(id).svg; }
function gcAvatarLabel(id) { return gcAvatarById(id).label; }

function gcLoadYou() {
  var you = null;
  try { you = JSON.parse(localStorage.getItem('gc-you') || 'null'); } catch (e) {}
  if (!you || typeof you !== 'object') you = {};
  return {
    name:     you.name || '',
    saidAs:   you.saidAs || '',
    pronouns: you.pronouns || 'they / them',
    /* RENAMED from `emoji` 2026-08-26 when the picker itself stopped being
       emoji. gcAvatarById() falls back to GC_AVATARS[0] on its own, so an
       old save with no avatarId at all still resolves to something real. */
    avatarId: you.avatarId || GC_AVATARS[0].id,
    photo:    you.photo || null      // data URL, or null when using the avatar
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
      preview.innerHTML = gcAvatarSvg(you.avatarId);
    }
  }
  paintPreview();
  face.appendChild(preview);

  var emojiWrap = document.createElement('div'); emojiWrap.className = 'you-emoji';
  GC_AVATARS.forEach(function (a) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'you-e' + (!you.photo && you.avatarId === a.id ? ' on' : '');
    b.title = a.label;
    b.innerHTML = a.svg;
    b.addEventListener('click', function () {
      you.avatarId = a.id; you.photo = null;    // an avatar replaces a photo
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
  /* Named so the door can put the cursor here. Somebody arriving on an invite
     without filling this in joins the room anonymous, and everything they say
     then goes up under no name at all. */
  name.className = 'you-name-input';
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
  /* WHAT IS TYPED COUNTS, WHETHER OR NOT SAVE WAS PRESSED. There are two ways
     off the doorstep, this button and the big one below it, and only this one
     used to read the fields. Someone who typed their name and then pressed the
     other button walked in as nobody. Hung on the host element so the page can
     take what is in the boxes before it does anything. */
  function commit() {
    you.name = name.value.trim();
    you.saidAs = saidAs.value.trim();
    var typed = other.value.trim();
    if (typed) you.pronouns = typed;
    if (!you.pronouns) you.pronouns = 'they / them';
    gcSaveYou(you);
    return you;
  }
  host.gcCommit = commit;

  var save = document.createElement('button');
  save.type = 'button'; save.className = 'btn go you-save'; save.textContent = 'Save';
  save.addEventListener('click', function () {
    commit();
    if (onSave) onSave(you);
  });
  host.appendChild(save);

  return you;
}
