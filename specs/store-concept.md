# Store concept (brick and mortar)

Started 2026-10-03, from a conversation with Dr. O. This is a concept, not a plan.
Nothing here is decided unless it says so. Questions she has not answered are
written as questions. No prices yet: she said the thinking is about products first.

## Why it exists

The idea came from the old series The Waltons, and how the family said goodnight
to each other every night. A lonely person could say goodnight to their friends.

## What is sold

**Companions (the main shelf)**
- Each unit is one friend. A person owns as many as they like.
- Collectable means buying one every once in a while and saving up, not buying a
  set at once. Five was only an example number.
- Astra-9 Lite, the bench-top friend, runs on a Raspberry Pi now.
- Good Company friends, one character per unit, from the characters already written
  (The Dose, The Gym, Almost Human, Good Company). The AL panel already lets a unit
  take on any of 74 personalities, which could be how a customer picks which
  friend a unit becomes. That is not the same as one unit holding all of them.
- Bespoke friend: designed online at the Good Company build page, then collected in
  the store or shipped.
- Astra-9 and Astrad, full size: the mannequins arrive in about four weeks (as of
  2026-10-03) and are used to take orders and find funding and backers.

**Things that go with a friend**
- A stand, small shelf or bedside mount.
- Eye colours and accents, shown and chosen in the store.
- A collector's book or case, to record which friends a person owns.
- Gift packaging. The person buying for someone else may be the biggest customer.

**Other robots**
- A kitchen helper, a classroom helper and a workshop helper, matching the use
  cases on the Astra-9 page. Shown as concepts or taken as interest for now, the
  way the waitlist works.

**In the store**
- A meet-a-friend wall, to talk to any character before choosing.
- A design table, to build a bespoke friend with help.
- An AR corner showing a larger Astra-9 or Astrad on a screen.
- Set-up and repair help.

## The life-size A.L.I.C.E.

A life-size A.L.I.C.E. at the front of the store, to advertise making her for the
home if possible.
- She already has an AR video pair (`good-company/video/alice-ar-color.mp4` and
  `alice-ar-matte.mp4`), a portrait and several scene clips.
- Display: the original way, a transparent screen or Pepper's-ghost glass playing
  the color and matte video. Looking Glass and Holobox type displays were looked
  at and set aside for now. A life-size figure likely needs a longer, full-length
  recording than the current clips. That is a guess to check.
- A real unit on a plinth beside her, and a sign with the waitlist QR code.
- If a home version is not ready, the sign says coming, not buy.

## The hologram pod (cardboard mockup, 2026-10-10)

Dr. O made a cardboard mockup of a hologram pod that can hold 5 holograms. Her
photo shows it beside a bust with lit eyes, a chest sensor and speaker holes. The
box is open at the front, has an angled panel inside on the right, and five
squares drawn on the lower front panel.
- What the five squares and the angled panel are for is not written down yet.
- `good-company/hologram.html` plays a companion on black, for a phone under a
  small clear pyramid. It has not been tried on a real pyramid or in this pod.
- Open: does each of the five spaces show a different friend, so a customer sees a
  small collection at once?

## Dolls on a plinth (idea, 2026-10-10)

Dr. O's idea: dolls, something like Barbie dolls, that talk when placed on a plinth
with a Raspberry Pi inside it. Her words: "No, cannot work without plinth."
- The doll is a collectable with no electronics of its own, apart from a small tag.
  The plinth holds the Pi, speaker and power, and reads the tag to know which
  character this is. Take her off and she is silent.
- The plinth is the starter product. Each doll after that is a smaller purchase.
- One friend talks at a time on one plinth, which keeps the running cost down.
  Whether that is true is not known yet and needs the monthly cost measured.
- Children or adults depends on how the doll is designed, in Dr. O's words. A
  suggestion, not a decision: the tag says which line a doll belongs to and the
  plinth sets its behaviour to match, so one plinth can serve both.
  - Children's line: soft, safe and story-led. Does not ask for a name, address or
    school, and keeps no record of a child's voice. A parent can switch it off.
  - Adult line: open conversation with the Good Company personalities, and the
    goodnight ritual.
- The doll needs its own name and look. Barbie is Mattel's trademark and this
  should not copy it.

Open questions for the dolls:
1. Which line first, children's or adult?
2. Does the plinth ship with one doll, or is the first doll chosen at the counter?
3. Does a doll work on any plinth, or is it paired to the buyer's?
4. How long is a plinth supported? Collectors will ask.
5. What stops a doll's tag from being copied, if limited editions matter?
6. A children's doll needs a lawyer to check toy safety rules and the rules on
   collecting information from children (COPPA in the US) before it is sold.

## Open questions

1. Does A.L.I.C.E. greet people, or Astra-9 as the headline product?
2. Does the life-size figure talk live (costs money for every passer-by) or play a
   recorded welcome?
3. Is the store sign clear that A.L.I.C.E. is a written character and not a person?
4. What does one friend unit cost to make, in parts and time? Not known yet.
5. How often can a new character be made, with a voice and a body? Not known yet.
6. If a friend is retired or the company stops, what happens to the owner's friend?
7. Is the Pi in Astra-9 Lite itself, or beside the body?
8. City, budget, and whether a pop-up or a shelf inside another shop comes first.
9. Real-time talking costs: how much does one friend cost to run each month? Not
   known. Log one real week of Astra's use on the Pi to find out.

## Things to keep in mind

- Selling to lonely people is a trust business. Cancelling should be simple, nobody
  should lose their friend over a missed payment, and the owner should keep what
  they have built. These are suggestions, not decisions.
- Anything based on a real person's voice or likeness needs recorded consent first.
- Money taken for something not yet shipped needs clear terms: what, when, and the
  refund rule. A lawyer should check before any deposit is taken.
- Say what exists and what is a mannequin or a concept. The site already labels
  its images that way.

## What is done so far

- Astra-9 Lite had its first public demo at a university AI and Innovation
  exhibition (planned for Tuesday 2026-10-06). Dr. O, 2026-10-10: "Astra light huge
  success the ai event." No numbers are recorded. Sign-ups from the handout's QR
  code are tagged `uni-expo`, so they can be counted once the Supabase step below
  is done.

- `astra9.html` waitlist can count sign-ups by where they came from (`?src=`).
- `astra9-handout.html`: a one page handout with a QR code to `/astra9?src=uni-expo`.
- `good-company/hologram.html`: hologram mode for a phone laid flat.
- Run `supabase_astra9_waitlist_source_migration.sql` in Supabase for the count.
