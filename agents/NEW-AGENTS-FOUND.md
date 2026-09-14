# New agents found, 2026-09-14 — not yet in roster.json

Requested: an accurate agent count, checking Good Company, ETL Classrooms, and
every ETL site. Method: ran `tools/cast-sync.js` against `roster.json` (the
roster of record per `CLAUDE.md`; the old `ETL_Agent_Roster.xlsx` /
`count_agents.py` pipeline is retired and undercounts). That reported **158**,
all checks passing. Then checked every live product roster.json does not
cover, reading each product's own source (gc-friend.js, the live companion
catalog and room.html "Before you sit down" copy on the Good Company site,
meet-the-faculty.html, cleo-persona.md, intel-persona.md, and the
classrooms.html live-room list) rather than guessing from memory. Then Dr. O
sent her own screenshots of Kronborg 1588 and Leadership (PTX 7006), which
caught two more undercounts that roster.json and this page's first draft
both missed — see the Kronborg and Leadership sections below.

**Total: 223** (159 individuals verified against roster.json's 158 records +
64 found live but not yet entered).

## ETL Classrooms · Kronborg 1588 — Hans and Bodil are 2, not 1
roster.json (and this page's first draft) carry a single record, `"name":
"Hans and Bodil"`, for the last card in the Kronborg 1588 grid. Dr. O's own
screenshot of that room shows two named children, ages nine and seven, each
introduced separately in the room's own copy. This page now reads "The
children of Kronborg, 2 companions" on that card. roster.json itself hasn't
been touched (see Recommendation) — its 158 stays a record count, not a
person count; this page's 159 is the person count once Hans and Bodil are
counted as the two people they are.

## ETL Classrooms · Leadership (PTX 7006) — 11, not 10
First draft of this page got the roster wrong here twice over: it listed
Colin Powell in the 10-leader grid and left out Marie Curie, and it invented
"Dr. O's own AI Twin" as an unlisted 11th figure. Dr. O's own screenshots of
the room correct both: the 10-leader grid is Coretta Scott King, Eleanor
Roosevelt, Ernest Shackleton, Frances Perkins, Harriet Tubman, John Wooden,
Mahatma Gandhi, Martin Luther King Jr., Sojourner Truth, and Marie Curie
(cross-listed with her existing Biology/PTX 4990 card — the same kind of
cross-listing this page already does for Jaque and Jules). Colin Powell is
real, but he's a separate, eleventh figure: the room's own hero copy marks
him "THE CAPSTONE." This page now carries him as his own card, role
"Leadership Classroom — capstone." No AI Twin appears in this room at all;
that was an error in this page's earlier research, not something Dr. O ever
said.

## Good Company — 47 companions (live companion catalog, corrected 2026-09-14)
First pass on this page undercounted Good Company at 8, reading only the
`gc-friend.js` demo set (`GC_DEMO_IDS`). Dr. O corrected this directly: the
live catalog on the Good Company site runs 5 pages, 28 cards, and several
cards bundle more than one companion. Full recount from the catalog and each
card's own room.html intro copy:

**19 single-companion cards** — Arch (general contractor), Sophia (vet
nurse), Nina (retired teacher), Kioko (paramedic), A.L.I.C.E. (synthetic
build), Julian (a vampire, since 1741), Winston (lord of the manor), Viv
(after dark), Aaron (psychologist), Marcus Reyes (on deadline), Theo
(stylist), Lady Cressida (a ghost), Meera (yoga teacher), Dario (pilot),
Nora (unstuck in time), Zoe (influencer), Rin (white hat), Sarah
(mixologist, The Copper Still), Olivia (actress).

**4 paired cards, 2 companions each (8 total)** — Jacob & Wilhelm Grimm;
Tobias & Briar (Larkmere Hall, unsorted); GC, Emerging Tech Lab's own build
(two robots); Astra-9 & Astrad.

**2 cards with named friends, 3 companions each (6 total)** — Reggie, with
friends: Reggie plus his dogs Biscuit and Mochi. Tansy, of the Radiant
Court: Tansy plus fairies Poppy and Blue. (Biscuit, Mochi, Poppy, and Blue
are named via the site's "Spectate" feature in faq.html and in room.html's
spectateWith lists, not on the catalog card itself.)

**3 group cards, all names now confirmed (14 total)**:
- Marion & the Littles — 6 companions, named in room.html's own intro copy:
  Marion, her husband Walter, his parents Sam and Edith, and their two
  children Henry and Daisy. (Earlier draft of this page said "7,"
  double-counting Marion on top of "6 Littles" — the 6 is the whole
  household including Marion, confirmed against both Dr. O directly and the
  room's own text.)
- The Puppet Family — 4 companions, named in room.html's own intro copy:
  Eli and Nell (the parents) and their two children, Jem and Wren.
- The Nursery — 4 companions, named in room.html's own intro copy: Bramble
  the bear, Clover the bunny, Ozzie the dinosaur, and Pearl the ballerina
  doll.

19 + 8 + 6 + 14 = **47**.

Per Dr. O: if Good Company is ever marketed commercially, every one of these
47 needs its own identity — done now that all the group-card names are
sourced from the product's own copy rather than left as bare counts.

Users can also build unlimited custom companions; those aren't campus agents
and aren't counted.

## Mission Possible Spy Academy — 4 Syn Faculty
`meet-the-faculty.html`: the "Syn Faculty, AI" cards are the actual AI agents.
Camille "Cypher" St. Claire, Ji-Soo "Echo" Park, Verity Nasar, Mateo "Rook"
Castillo. The "Bio Faculty" cards on the same page (Dr. Oroszi, Gary Gardner,
Dr. Brian Polkinghorn, Kimberly Pratt, Michael Shannon, Dr. David Ellis) are
real human instructors, not agents, and are excluded.

## Platform guides — 2
Cleo, SLR Studio's research-assistant guide (`cleo-persona.md`). Intel, the
Intel Dashboard's tradecraft concierge (`intel-persona.md`) — codename only,
no real name, "need-to-know" by design.

## Checked and found already fully accounted for (no new agents)
- **Almost Human**: its 10-ish characters (Auggie, Marcus Holt, Jen Lopez,
  Marceline Smith, Chris Avila, Ms. Ivy, Dr. Arthur Pendelton, Noor Haddad,
  Mara Rivera, Coach Dom) are the same people already in roster.json under
  their primary platform — cross-listed, not new headcount.
- **The Harvest Circuit**: 8-partner collective per the cast bible, but 5 are
  cross-listed regulars (Vic Stallion, Wyatt, Silas, Amara, Nadia) and the 3
  new ones (Ruben Hart, Camille Lefèvre, Luca Brunner) are already in
  roster.json.
- **Everly Castle**: already fully in roster.json (10 princesses).

## Also found: 8 people already in roster.json but missing from this page
Jess Ramirez, Imani Brooks, Mona Bahrami MD, Von Gupta, Renee Kovac, Heidi
Kingstone, Vic Stallion, and Judge Roz Okonkwo were in `roster.json` (mostly
compound-platform entries like "ETL Newswire / OPSEC Gauntlet") but weren't on
this page at all. Added under "Also in roster.json, missing above."

## Checked: My Echo's demo roster — excluded, not new agent characters
Dr. O sent screenshots of My Echo's own demo roster: Dr. Terry Oroszi, Rev.
Joel King, Greg & Carolyn Foster, Michael D. Shannon, Harold & Barbara Ellis,
Mary & Betty, Dr. David Ellis, Pookie, and Dr. Kevin Duffy, across two pages
with a few slots still unfilled. Read My Echo's own architecture doc
(`06_DISCLOSURE_AND_AUDIENCE.md`) and its `clients/` folder (terry,
joel-king, foster, mike, ellis, mary-voss, pookie-patti, kevin-duffy, plus
rin, meg, eveblack): each Echo is one real, named, consenting person's own
digital twin, built from their own memories, not a fictional character. Same
category as Mission Possible's "Bio Faculty" real-human instructors, and the
same reason Dr. O's own AI Twin is counted once, under Founder Studio, and
not again anywhere it reappears. None of the nine above are added to the 223
above, and none should be — they were never AI Agent Characters in the sense
this page tracks.

## Recommendation
Add the 64 above to `roster.json` with real bios/portraits so `cast-sync.js`
picks them up and this page never drifts from them again — the same fix
`CLAUDE.md` already applied to the Greylander/City-government drift once
before. Good Company's group-card members (the Littles, Puppet Family, and
Nursery) now have real names sourced from room.html's own copy, so they're
ready to enter roster.json individually rather than as bare group counts.
Two more fixes belong in roster.json itself, not hand-edited here per
`CAST.md`: split its single "Hans and Bodil" record into two people, and add
Colin Powell as his own Leadership Classroom record (capstone) alongside the
Marie Curie cross-listing.
