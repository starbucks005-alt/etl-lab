# Roboteers (2026-11-02)

Dr. O's plan: take the robot family (Astra, Astrad, Teddy/Astro, ALICE, Elle) to parks and places, let them talk to each other and to interested strangers, post it on social media, and rent them for parties at about $200 an hour to help pay for the new robots and their upkeep. Duplicates may be needed to keep up with demand. She has a power block (so no mains electricity is needed), two wheelchairs, and is looking at a van with a wrap.

What exists:
- `roboteers.html`: the page a QR code opens. A person chooses to rent the robots or join the waiting list. For a rental they can also name the guest of honor and tell us special facts, so the robots can greet them by name and talk as if they had known them for years (Dr. O's idea, 2026-11-02). The page says rentals start at $200 an hour (change the line `priceLine` if the price changes).
- `netlify/functions/roboteers-signup.js`: keeps each request (blob store `roboteers_requests`) and emails Dr. O at her work address, so she can read it. The person gets a short note that it arrived. Nothing is charged and no date is held. Dr. O reads the whole list with her owner key (GET, bearer).
- `roboteers/qr/`: nine QR codes (van, park, card, flyer, teddy, alice, astra, astrad, elle), PNG and SVG. Each carries `?s=<where>`, so every request says which code brought the person. All nine were decoded back to their addresses. `roboteers/Roboteers_QR_Codes_2026-11-02.docx` has them labelled, one page each, for printing. Make them with `segno` (they are made, not drawn).
- `tests/roboteers-signup.test.js`.

Not built, and decisions for Dr. O:
- The briefing: turning a request's guest-of-honor facts into something each robot is told for the event. The design is that Dr. O reads and edits the facts first, then approves it, and it ends by itself after the event. Where it is delivered first (the companion boxes, or the robots) is open.
- What happens to the facts about a child after the event (kept or deleted), and whether the page promises it. That is Dr. O's to decide and to say; the page does not promise anything about it yet.
- The price on the page, the contract, deposit, insurance and any permits. Not written.

The short address `emerging-tech-lab.com/roboteers` shows the same page as `roboteers.html` (a rewrite in `netlify.toml`, so a code's `?s=where` tag is kept). Use it on the van wrap and the cards. The QR codes keep the full address, which also works.
