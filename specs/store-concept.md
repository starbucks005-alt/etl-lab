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

- `astra9.html` waitlist can count sign-ups by where they came from (`?src=`).
- `astra9-handout.html`: a one page handout with a QR code to `/astra9?src=uni-expo`.
- Run `supabase_astra9_waitlist_source_migration.sql` in Supabase for the count.
