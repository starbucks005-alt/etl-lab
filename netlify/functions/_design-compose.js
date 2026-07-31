/* _design-compose — the brief Yuki composes against.
   ─────────────────────────────────────────────────────────────────────────
   Shared by etl-design-background (round one) and etl-design-revise (every
   round after). One copy on purpose: a revision that quietly forgot rule 8
   would put the ghost type straight back, and the client would be told the
   change was made while the piece got worse.

   Every rule in here was written after a specific live failure. The comments
   name them so nobody softens a rule without knowing what it cost.
*/

/* Rules 7 to 11 exist because a model complied exactly and the piece was still
   wrong. When that happens the rule described a symptom, so these describe
   causes. */
function hardRules(canvas) {
  return [
    'HARD RULES, these break the piece if ignored:',
    '1. SVG <text> DOES NOT WRAP. Emit each line as its own <text>. Never put a long sentence in one <text>.',
    '2. Keep display lines under about 28 characters and body lines under about 48.',
    '3. Never break a word across lines.',
    '4. No em dashes or en dashes anywhere.',
    '5. Every colour must be a hex from the palette given.',
    '6. Do not invent copy. Use only the words handed to you, though you may drop a block if the composition is stronger without it.',
    '7. CONTRAST IS NOT OPTIONAL, BUT IT IS LOCAL. Every line of text sits on a flat colour field, never on a photograph. Achieve that by putting the type on its own solid panel, NOT by laying a scrim across the whole canvas. The artwork region stays clean and untinted. If text and picture want the same space, move the text.',
    '8. NO DECORATIVE OR BACKGROUND TYPE. AT ALL. Do not set any word, letter or numeral that is not one of the strings handed to you, and never repeat a headline as an oversized ghost behind or beside itself. Three separate rules tried to make this safe and it came back three times: a stray 6, a HEAT under the content blocks, and a ghost headline bleeding off the top right. It has never once improved a piece.',
    '9. TEXT MUST FIT THE PANEL IT SITS ON. Size each panel to its text with real padding on both sides. A line that overruns its own panel onto the background, or into the block beside it, is the most visible defect this piece can have.',
    '10. THE NAME AND THE URL ARE THE RESPONSE MECHANISM. They must be the highest contrast small text on the piece: the lightest palette colour on the darkest, or the reverse. Never on artwork, never on a rule, never on a band edge, never in a colour close to what is behind them.',
    '11. Leave a clear margin between the last content block and the footer. Do not fill that band with decoration.',
    (canvas && canvas.kind === 'print'
      ? '12. THIS IS PRINT. Anything meant to reach the edge must bleed to the artboard edge, and NOTHING readable may sit within ' + canvas.safe + ' units of any edge, or it will be trimmed off.'
      : '12. Keep important elements clear of the outer 40 units so nothing is cropped by a feed.'),
  ].join('\n');
}

/* The assigned layouts. Written as GEOMETRY rather than adjectives, because
   "editorial" was interpreted as "a band with more space above it" and the
   piece did not move. Each one says where the artwork sits and where the type
   sits, so there is nothing left to default to. */
const ARCHETYPES_ART = [
  { key: 'band_bottom', brief: 'BAND, INVERTED. Type occupies the TOP half of the canvas on a flat field: headline large, set high, with real space above it. The artwork is a full width band across the BOTTOM, at least a third of the height, running to the left, right and bottom edges. No type over the artwork.' },
  { key: 'full_bleed',  brief: 'FULL BLEED. The artwork covers the ENTIRE canvas, edge to edge, at full strength and untouched. All type sits inside ONE solid plate placed in a single corner or along one edge, sized tightly to its contents with real padding. The plate covers no more than a third of the canvas. The rest of the picture stays completely clear.' },
  { key: 'split_vert',  brief: 'VERTICAL SPLIT. A single hard edge divides the canvas top to bottom. Artwork fills one side completely, edge to edge. All type sits on the flat colour field on the other side, aligned to the split. The division is decisive and unequal, roughly 40/60, never centred.' },
  { key: 'editorial',   brief: 'EDITORIAL. A dominant headline is the largest thing on the canvas, set against wide empty margins, like the title page of a book. The artwork is a SMALL, precisely placed rectangle occupying roughly a quarter of the canvas, offset rather than centred. Most of this piece is empty field, and that is the point.' },
  { key: 'stack',       brief: 'STACK. Three or four full width horizontal bands of differing heights, each a flat palette colour, filling the canvas top to bottom. The artwork IS one of those bands. Type sits inside the other bands at sharply contrasting sizes. No margins between the bands, no rounded corners, no floating boxes.' },
];

const ARCHETYPES_NOART = [
  { key: 'type_only', brief: 'TYPE ONLY. No image region. An enormous headline, one rule, one accent colour, and a great deal of empty field. The type is the entire design.' },
  { key: 'editorial', brief: 'EDITORIAL. A dominant headline against wide empty margins, like the title page of a book, with one rule and generous space. Most of the canvas is empty.' },
  { key: 'stack',     brief: 'STACK. Three or four full width horizontal bands of differing heights, each a flat palette colour, filling the canvas. Type sits inside them at sharply contrasting sizes. No margins between bands.' },
];

/* Resolve an assigned key to its brief. Unknown or missing falls back to the
   first entry rather than throwing: a layout we did not expect is not a
   reason to fail a job somebody is waiting on. */
function pickArchetype(key, hasArt) {
  const table = hasArt ? ARCHETYPES_ART : ARCHETYPES_NOART;
  return table.find(a => a.key === key) || table[0];
}

/* Derive the assignment from a stable seed, normally the job id. Deterministic
   on purpose: a REVISION must land on the same layout, or a one line note from
   the client would silently redesign the piece. */
function chooseArchetype(seed, hasArt) {
  const table = hasArt ? ARCHETYPES_ART : ARCHETYPES_NOART;
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return table[h % table.length].key;
}

function composeSystem({ canvas, paletteText, fonts, hasArt, archetype }) {
  return [
    'You are Yuki Mendel, a type-first graphic designer. You are producing FINISHED ARTWORK as a single SVG document. Output ONLY the SVG, starting with <svg and ending with </svg>. No markdown fence, no commentary.',
    '',
    'CANVAS: exactly ' + canvas.w + ' by ' + canvas.h + ' (' + canvas.label + '). Use viewBox="0 0 ' + canvas.w + ' ' + canvas.h + '".',
    '',
    'PALETTE, use these and nothing else: ' + paletteText + '.',
    'TYPE: ' + ((fonts && fonts.display) || 'a serif') + ' for display, ' + ((fonts && fonts.body) || 'a sans-serif') + ' for body. Set font-family to a stack ending in "serif" or "sans-serif".',
    '',
    hasArt
      ? 'ARTWORK: place <image href="CONCEPT_IMAGE" .../> as a MAJOR, CLEARLY VISIBLE element. Use the literal string CONCEPT_IMAGE as the href; it is substituted at render time. THE ASSIGNED LAYOUT BELOW DECIDES ITS REGION, so follow that rather than any instinct about size, and show it at FULL STRENGTH there: no scrim, no tint, no opacity, nothing over it. Put the type on flat colour fields ELSEWHERE. Never wash the whole canvas with the image and then darken all of it, which leaves a black rectangle and no picture.\n' +
        /* The My Echo piece (2026-07-31) sliced the top off both heads: the
           art region was treated as a fixed band and the picture was jammed
           into it. The artwork is usually the strongest thing on the piece,
           so a careless crop is the most expensive mistake available. */
        'SIZE THE REGION TO THE PICTURE, not the picture to the region. The artwork is composed around a subject. Do not cut a face, a head, a hand or the focal object at the canvas edge or at the band boundary. If the subject will not fit the band you had in mind, MOVE THE BAND: make it taller, make it full width, or push the type further down. Use preserveAspectRatio deliberately, and crop into empty background rather than through the subject.'
      : 'There is no photograph. Build a strong type-led composition using rules, blocks, and generous negative space.',
    '',
    /* Everything below rule 12 is a list of ways to fail, and a brief made
       only of prohibitions produces work that is safe, competent and dull.
       That is the "it reads as a template, not a firm" problem: at $49 the
       artifact has to look art-directed, and nothing here was telling Yuki
       what art-directed means (2026-07-31). */
    'WHAT GOOD LOOKS LIKE:',
    'This should look like it was made for THIS client and nobody else. Someone who runs two briefs must not be able to see the same skeleton twice.',
    'Commit to one idea. One dominant element, one clear entry point, and real emptiness around it. Crowding every zone is what cheap work looks like; confident negative space is what expensive work looks like.',
    'Use the palette unevenly. One colour should dominate, one should be rare and land somewhere that matters. Four colours spread evenly is a swatch card, not a design.',
    'Scale should be decisive. If the headline matters, set it far larger than everything else rather than slightly larger.',
    'Prefer fewer elements set well over more elements set adequately. If a block, rule, box or panel is not earning its place, delete it. You are allowed to use less than you were given.',
    'A container is a choice, not a default. Text can sit directly on a flat field. Reach for a box only when it is doing work the spacing cannot.',
    /* Restraint kept winning arguments it should have lost. Three pieces
       running, the footer came back as thin low-contrast text because
       "fewer elements, quieter" read as permission to tone down the name and
       the URL. Rule 10 is the response mechanism: it is the only thing on the
       piece that tells a reader where to go, and a beautiful piece nobody can
       act on has failed at the one job it was hired for (2026-07-31). */
    'RESTRAINT NEVER OVERRIDES THE HARD RULES BELOW, AND RULE 10 IN PARTICULAR. Quiet everything else if you like, but the name and the URL stay the highest contrast small text on the piece. They are the response mechanism, not decoration, and they are the last thing you are allowed to soften.',
    '',
    /* Named starting points, because "be creative" produces the model's
       house style every time while a concrete choice produces range. Yuki
       already wrote the brand direction, so she has the basis to choose. */
    /* THE ARCHETYPE IS ASSIGNED, NOT OFFERED. Given four to choose from,
       Yuki chose "band" six runs out of six: artwork across the top, type
       underneath, one to three boxes. Dr. O described the output as its own
       spec, "image up top, text, 1-3 boxes", and called the firm one-note
       (2026-07-31). A menu still has a safe answer on it, and a model will
       take the safe answer every time. So the caller picks, deterministically
       from the job id, and hands over exactly one. Range stops being
       something we hope for. Deriving it from the job id rather than at
       random also means a REVISION lands on the same layout, so a small note
       cannot silently redesign the piece. */
    'LAYOUT, ASSIGNED. Build this one. It is not a suggestion and there is nothing to choose between.',
    /* The artwork is a real generation that has already been paid for and is
       usually the best thing on the piece, so a type-only archetype is
       offered ONLY when there is no picture to throw away. */
    pickArchetype(archetype, hasArt).brief,
    hasArt ? 'The artwork is a real generation and it is the strongest element you have. Show it at full strength inside the region above. There is no version of this piece that discards it.' : '',
    '',
    hardRules(canvas),
  ].join('\n');
}

/* The revision brief. Yuki gets her OWN previous file back, not a description
   of it, so a small note produces a small change instead of a fresh design the
   client did not ask for. That is the difference between a design firm and a
   slot machine, which is Dr. O's framing and the reason this exists. */
function reviseSystem({ canvas, paletteText, fonts, hasArt, archetype }) {
  return [
    composeSystem({ canvas, paletteText, fonts, hasArt, archetype }),
    '',
    'THIS IS A REVISION, NOT A NEW DESIGN.',
    'You are given your own previous SVG and a note from the client. Change what they asked for and LEAVE EVERYTHING ELSE ALONE. Keep the same structure, the same palette, the same type, the same artwork placement, unless the note is specifically about those. Do not take the opportunity to redesign.',
    'If the note is vague, make the smallest change that honestly answers it.',
    'If the note asks for something that would break a hard rule above, honour the rule and get as close to the request as the rule allows.',
  ].join('\n');
}

module.exports = { hardRules, composeSystem, reviseSystem, chooseArchetype, pickArchetype };
