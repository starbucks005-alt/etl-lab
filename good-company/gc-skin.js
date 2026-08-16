/* ═══════════════════════════════════════════════════════════════════════════
   GOOD COMPANY — SKIN RESOLUTION AND THE PICKER
   Loaded by every page, after gc-friend.js where a friend exists.

   THIRD EXTRACTION, SAME REASON AS THE FIRST TWO. Four pages were about to
   carry four copies of "which skin am I and how do I change it", two of them
   already drifting (room.html grew a proper picker while build.html and
   album.html cycled blindly through the list). One file, one behaviour.

   Adding a skin: one block in gc-skin.css, one entry in SKINS below. Nothing
   else, on any page.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Named as places and weather, never as "light" and "dark". Somebody choosing
   a room they want to sit in is doing something human; somebody choosing a
   color scheme is configuring software. The brightness comes along for free,
   and the third swatch is the room's own background, so the dark skins LOOK
   dark in the list. That matters for anyone who needs dark for light
   sensitivity rather than for taste, since they can no longer ask for it by
   name. */
var GC_SKINS = [
  { key:'harvest',  label:'Harvest',  swatch:['#9E4E27','#5C6B3F','#EFE5D3'] },
  { key:'seaside',  label:'Seaside',  swatch:['#2F6B62','#9A4630','#E1EFF1'] },
  { key:'snowline', label:'Snowline', swatch:['#3A6355','#8B97A6','#EAEEF3'] },
  { key:'fireside', label:'Fireside', swatch:['#E08A4E','#8FA86A','#221C17'] }
];

/* Which skin the page opens on:
     1. an explicit choice, which wins forever once made
     2. the friend's own room, if this page has a friend on it
     3. the system preference, so a dark machine never eats a white flash
   That chain is what replaced the light/dark toggle. Nobody has to know the
   words "light" and "dark" to land on the brightness they wanted. */
var GC_SKIN = (function () {
  var ok = {}, chosen = null;
  GC_SKINS.forEach(function (s) { ok[s.key] = 1; });

  try { chosen = localStorage.getItem('gc-skin'); } catch (e) { /* storage off */ }
  if (ok[chosen]) return chosen;

  var friend = (typeof GC_FRIEND !== 'undefined') ? GC_FRIEND : null;
  if (friend && ok[friend.skin]) return friend.skin;

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'fireside' : 'harvest';
})();

/* Applied immediately, before the stylesheet paints anything. */
document.documentElement.setAttribute('data-skin', GC_SKIN);

function gcSetSkin(key) {
  document.documentElement.setAttribute('data-skin', key);
  try { localStorage.setItem('gc-skin', key); } catch (e) {}
  document.querySelectorAll('.skin-opt').forEach(function (el) {
    el.classList.toggle('on', el.dataset.key === key);
  });
}

/* Builds the picker into `host`, which must be a positioned wrapper holding a
   button. Same control on every page: a cycle button hides the fact that there
   are four rooms, and the front door in particular should show the choice
   rather than bury it behind repeated clicking. */
function gcMountSkinPicker(host, button) {
  var menu = document.createElement('div');
  menu.className = 'skins';
  menu.setAttribute('role', 'menu');

  GC_SKINS.forEach(function (s) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'skin-opt' + (s.key === document.documentElement.getAttribute('data-skin') ? ' on' : '');
    b.dataset.key = s.key;
    b.setAttribute('role', 'menuitem');

    var sw = document.createElement('span');
    sw.className = 'swatch';
    s.swatch.forEach(function (c) {
      var i = document.createElement('i');
      i.style.background = c;
      sw.appendChild(i);
    });

    b.appendChild(sw);
    b.appendChild(document.createTextNode(s.label));
    b.addEventListener('click', function () { gcSetSkin(s.key); shut(); });
    menu.appendChild(b);
  });

  host.appendChild(menu);

  function shut() { menu.classList.remove('open'); button.setAttribute('aria-expanded', 'false'); }

  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', function (e) {
    e.stopPropagation();
    button.setAttribute('aria-expanded', menu.classList.toggle('open') ? 'true' : 'false');
  });
  menu.addEventListener('click', function (e) { e.stopPropagation(); });
  document.addEventListener('click', shut);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') shut(); });
}
