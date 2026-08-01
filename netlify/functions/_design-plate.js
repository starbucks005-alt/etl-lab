/* _design-plate — make the client's own photograph into the artwork.
   ─────────────────────────────────────────────────────────────────────────
   WHY THIS EXISTS (2026-07-31)

   Chris generated a room, and the room was fine, and it was not the client's
   room. Dr. O, looking at a piece whose composition she liked: "the art would
   work if it were the real Agents. random graphics ruin it."

   A business that has photographed its own product has already answered the
   question Chris was guessing at. A generated approximation of their world
   is strictly worse than the world, and it costs four cents more.

   So when the brand reader comes back with a photograph big enough to hold a
   band, that photograph becomes the plate and no image is generated at all.
   Chris's job changes from inventing a scene to grading one.

   THE GRADE. A raw site photograph dropped into a piece looks like a
   screenshot of the website rather than an advert. One accent colour out of
   an otherwise monochrome frame is what makes it read as art direction, and
   it is also the client's own accent, so the piece stays on-brand while
   looking nothing like their homepage. Dr. O asked for exactly this: "do the
   same black and white with a blue."

   The blue is never invented. It comes from the palette the brand reader
   pulled off their live site.
*/

const sharp = require('sharp');

/* #rrggbb or #rgb -> {r,g,b}. Anything else is refused rather than guessed,
   because a wrong accent is worse than a neutral one. */
function parseHex(hex) {
  const s = String(hex || '').trim().replace(/^#/, '');
  const full = s.length === 3 ? s.split('').map(c => c + c).join('') : s;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/* Pick the accent to grade toward: the most saturated colour in the palette,
   since a brand's near-blacks and off-whites are grounds, not accents. */
function accentFrom(palette, fallback) {
  let best = null, bestSat = -1;
  for (const entry of (palette || [])) {
    const hex = typeof entry === 'string' ? entry : (entry && entry.hex);
    const c = parseHex(hex);
    if (!c) continue;
    const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b);
    if (max < 40 || max > 245) continue;              // a ground, not an accent
    const sat = max === 0 ? 0 : (max - min) / max;
    if (sat > bestSat) { bestSat = sat; best = c; }
  }
  if (best && bestSat > 0.15) return best;
  return parseHex(fallback) || { r: 76, g: 95, b: 214 };   // ETL Signal Blue
}

/* Grade a photograph to monochrome carrying one accent.
     - greyscale first, so the original colour cast cannot fight the accent
     - contrast raised and blacks pulled down, which is what stops a bright
       site photo from looking like a stock image
     - the accent is a DUOTONE laid over the top at partial strength rather
       than a flat wash, so the picture keeps its full tonal range and the
       colour sits in the midtones and highlights where the faces are

   Returns a PNG buffer sized to cover w x h, matching what a generated plate
   would have been so nothing downstream has to know the difference. */
async function gradePlate(buf, { width, height, accentHex, palette, strength }) {
  const a = accentFrom(palette, accentHex);
  const mix = Math.min(0.95, Math.max(0.05, Number(strength) || 0.34));

  /* A flat tint is NOT a duotone. sharp's tint multiplies every pixel toward
     the accent, so the first attempt came back drowned in blue: the picture
     stopped being black and white and became a blue picture. Dr. O asked for
     "black and white with a blue," which is a duotone: luminance drives a
     ramp from a dark accent-tinted shadow up to clean white, so the frame
     keeps its full tonal range and the colour only lives where the darks are
     (2026-07-31). */
  const mono = await sharp(buf)
    .resize(width, height, { fit: 'cover', position: 'attention' })
    .greyscale()
    .linear(1.14, -20)                      // contrast up, blacks down
    .png()
    .toBuffer();

  // The shadow end of the ramp: the accent, taken well down toward black so
  // it colours the darks instead of shouting over them.
  const sh = { r: Math.round(a.r * 0.22), g: Math.round(a.g * 0.24), b: Math.round(a.b * 0.42) };

  // Inverted luminance becomes the alpha of the shadow layer, so black areas
  // of the photograph are fully accent and white areas are fully white.
  const maskRaw = await sharp(mono).greyscale().negate().raw().toBuffer();
  const shadowLayer = await sharp({ create: { width, height, channels: 3, background: sh } })
    .joinChannel(maskRaw, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();

  const duotone = await sharp({ create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([{ input: shadowLayer, blend: 'over' }])
    .png()
    .toBuffer();

  // Held back against the neutral monochrome, so the accent is a cast rather
  // than a colour scheme.
  return sharp(mono)
    .composite([{ input: duotone, blend: 'over', opacity: mix }])
    .png()
    .toBuffer();
}

/* IS THIS A PHOTOGRAPH OR IS IT A LOGO?
   ─────────────────────────────────────────────────────────────────────────
   The upload field on the form asks for a logo, and clients send both, so
   intent cannot be trusted and the file has to be judged on what it is.
   Plating a logo would blow it up to full bleed and ruin the piece.

   Three signals, all cheap:
     - size, since a mark is usually small and a photograph is not
     - transparency, since logos are cut out and photographs are not
     - entropy, which is high for a photograph's detail and low for the flat
       areas a mark is mostly made of

   Wrong answers fail SAFE: anything uncertain stays a reference for Yuki to
   look at, exactly as before, and Chris draws. */
async function looksLikePhotograph(buf) {
  try {
    const img = sharp(buf);
    const meta = await img.metadata();
    if ((meta.width || 0) < 900 || (meta.height || 0) < 600) return false;
    if (meta.hasAlpha) {
      // A cut-out mark. A photograph saved as RGBA is possible, so only
      // reject when the alpha channel is actually doing something.
      const st = await img.stats();
      const alpha = st.channels[3];
      if (alpha && alpha.min < 250) return false;
    }
    const stats = await img.stats();
    return (stats.entropy || 0) > 4.2;
  } catch (_) {
    return false;
  }
}

/* Which reference, if any, is good enough to be the artwork. The brand
   reader already sorts largest first and marks what it could measure. */
function chooseArtPhoto(references) {
  for (const r of (references || [])) {
    if (r && r.usable_as_art && r.data_url) return r;
  }
  return null;
}

function bufferFromDataUrl(dataUrl) {
  const m = /^data:image\/[a-z+]+;base64,(.+)$/i.exec(String(dataUrl || ''));
  return m ? Buffer.from(m[1], 'base64') : null;
}

module.exports = { gradePlate, chooseArtPhoto, looksLikePhotograph, bufferFromDataUrl, accentFrom, parseHex };
