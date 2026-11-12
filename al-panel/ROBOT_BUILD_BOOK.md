# ETL Robot Build Book

Designed and built by Dr. O, Emerging Tech Lab.

This book is laid out the way Dr. O asked on 2026-11-12: first what the book is, what an ETL AI robot is and what it is built on; then the kinds of robots ETL makes; then one chapter for each robot. The twins, Astro and Astri, share one chapter.

The day by day bench notes stay in `al-panel/pi/README.md` (the bench log). Each chapter here lists the bench log sections that belong to that robot, so nothing in the log was moved or rewritten. Where a fact is not known yet, the chapter says so and leaves a line for Dr. O to fill in.

---

## Part 1. Overview

### 1.1 What this book is

A build book for ETL robots: what each robot is, what it is built on, the parts and the 3D printed pieces it needs, the order the build goes in, and what is still open. It is written so somebody who has never built an ETL robot can follow it.

The step by step photo guide for A.L.I.C.E. (one Word document, "ALICE build guide") follows the same build as Chapter 2.

### 1.2 What an ETL AI robot is

An ETL AI robot is a body with a small computer inside it that listens, talks, looks and moves. What they share, from the robots built so far (A.L.I.C.E. and Astra-9 Lite):

- **A Raspberry Pi** inside the body, running the robot's panel software (`al-panel/pi`). A.L.I.C.E., Astra-9 and Astrad have a Pi 5. Astra-9 Lite has a Pi 4.
- **A voice.** Each robot has its own voice, from Azure or ElevenLabs. A.L.I.C.E.'s voice is ElevenLabs only.
- **Listening.** Microphones, so visitors can talk to the robot, and voice recognition for registered voices.
- **A neck that turns.** One servo (MG996R) on a servo board, with the head-turn stack in Section 1.4.
- **Eyes.** Most robots have two rings of lights behind the eyes. A.L.I.C.E. has moving eyes instead, and the Guardians have a single camera lens.
- **A panel.** A web page for each robot (`al-panel/index.html`, listed in `al-panel/robots.json`) to set the voice, the eyes, the mode and more.
- **A life.** Every robot has a name, a family and a backstory. If somebody asks whether a robot is a real person, it says no.

### 1.3 Host bodies

The host body is what the robot is built into. There are two kinds:

- **Mannequins.** Store display mannequins, fiberglass, opened up to take the electronics. A.L.I.C.E. is a full body posable mannequin (RoxyDisplay FFXF, from American Dress Forms on eBay). The dogs are Sunraymascota fiberglass dog mannequins. The twins and the 10-year-old are child mannequins. Panels cut with a Dremel (1/8 in kerf) are held back on with magnet tabs (Section 1.4).
- **3D printed bases.** _Dr. O to fill in: which robots stand on a 3D printed base, and what the base is._

### 1.4 What the adult and child mannequin robots share

From Dr. O's build book update of 2026-11-12. The full text, with all measurements, is the "Build book update" section at the end of the bench log.

- **Print settings for every printed part:** Snapmaker U1, Snapmaker PLA, textured PEI plate, supports OFF, 4 walls, 40% infill.
- **3D printer files:** `al-panel/3D_printer_files/stl`, with the scripts that made them in `al-panel/3D_printer_files/scripts`.

| File | What it is | Used on |
|---|---|---|
| spinner_v3.stl | Spinner: 7 mm plate + 8 mm D post through swivel | Head-turn, all robots |
| head_disc_v4.stl | 73 mm head disc with 4 swivel holes (40 mm square, #6) | Head-turn |
| deck.stl | Deck epoxied in torso neck (r 36.75, 7 mm) | Head-turn |
| servo_plate.stl | Hanging MG996R plate on two #6 bolts + nuts (~25.5 mm gap, adjustable) | Head-turn |
| ted_adapter.stl | Horn plate, hex pocket for 1/4 in bolt head | Ted |
| astra_adapter.stl | Horn plate, hex pocket for 3/8 in bolt head | Astra |
| magnet_tab.stl | Single magnet tab | Head and back panels |
| magnet_tabs_x8.stl | 8 tabs (one test plate) | Test fit |
| magnet_tabs_x40.stl | 40 tabs, 5 x 8 grid | 5 robots x 2 panels x 4 tabs |

- **Head-turn stack:** MG996R servo put in from the back opening, a deck epoxied in the torso neck, the servo plate hanging from the deck on two #6 bolts, the spinner through the swivel, the head disc on top.
- **Magnet-tab panels:** four tabs per panel, a head panel and a back panel per robot, so 8 tabs and 16 magnets (10x3 mm N48) per robot. Check that each pair attracts before gluing.
- **Three day schedule per robot:** Day 1 to 3. The "I stack" (LED, acrylic diffusion panel, standoffs) is part of the eye stage, and is skipped for A.L.I.C.E. and the Guardians.

### 1.5 Clothes: an ETL uniform (draft, Dr. O, 2026-11-12)

The bodies are mannequins, and Dr. O does all she can to make them not look like mannequins. Ordinary clothes turn them back into looking like mannequins. So the plan is something uniform-ish for all ETL bots:

- Khaki pants
- A black T-shirt
- The ETL logo

Draft only: which robots wear it, and how it fits the twins, the Guardians and the dogs, is not decided. The clothes already in the chapters (the twins' concept clothes and pajamas, the lab coats) are left as they are until Dr. O decides.

---

## Part 2. The kinds of robots ETL makes

**The Astra line** (Astra-9 Lite, Astra-9, Astrad, Astro and Astri) all look the same: champagne mist overall, with copper accents, and no hair or wig (Dr. O, 2026-11-12). The Astra line wears a black choker: it hides the neck cut, and it is where the camera is mounted.

| Kind | Host body | Robots | What it is |
|---|---|---|---|
| Bust | Head and bust | Astra-9 Lite (Elle) | A companion from the shoulders up, on a table. Eye rings, a neck that turns, every panel mode. |
| Full body companion | Adult mannequin | A.L.I.C.E., Astra-9, Astrad (Ted) | A life size robot that greets visitors, talks and turns to look at them. |
| Child | Child mannequin | Astro and Astri (the twins), five more 3-year-olds, the 10-year-old | A child robot in the children's friend mode, with smaller eye rings. |
| Guardian | Adult mannequin | Guardian F, Guardian M | Gloss black head, silver body, black uniform. One large camera lens in the center of the face and a red LED strip mouth that sweeps while it speaks. |
| Dog | Dog mannequin | Biscuit, Reggie, Mochi | A dog robot with a tail wag and touch. |
| Holopod | _Dr. O to fill in_ | Lumvivo | The hologram box. It takes part in the fireside chat as whichever character it is showing. |

---

## Part 3. The robots

Every chapter has the same parts: who the robot is, the host body, what makes it different, where the build stands, what is still open, and the bench log sections for it.

### Chapter 1. Astra-9 Lite (Elle, AL)

- **Who:** Astra-9 Lite, called Elle. Champagne mist with copper accents, no hair or wig.
- **Host body:** head and bust, with a Raspberry Pi 4.
- **What makes her different:** eye rings that pulse, a neck that turns, all of the panel's modes (including Guardian mode). Voice from Azure first when set up, ElevenLabs if not. Mechanical sounds around her speech (Dr. O, 2026-10-30).
- **Status:** built and working.
- **Bench log sections:** Camera for Astra Lite (2026-10-23); Registered voices for Elle (2026-10-23); Astra Lite: the two 470 ohm resistors; Astra Lite repair: facts so far; Astra Lite: where the head and bust and the Pi 4 were bought (2026-10-25); Astra Lite (AL): audio pigtail cable (2026-10-28).

### Chapter 2. A.L.I.C.E.

- **Who:** A.L.I.C.E. (Alice). Aged bronze legs, gunmetal arms, matte black suit, metal-looking joints.
- **Host body:** full body posable mannequin (RoxyDisplay FFXF), a plastic head, a Raspberry Pi 5 (8GB).
- **What makes her different:** a camera in her cheek plate and a HuskyLens (faces, objects, colors, tags, tracking); she holds a pose; a motion sensor hello (HC-SR501); a soft breath before she speaks; her voice is ElevenLabs only. No eye rings: moving eyes on the Will Cogley EyeMech 3.2 (six MG90S servos, a PCA9685 over I2C from the Pi, 5 V 3 A, 27 mm eyeballs, to be confirmed). The Cogley license is non-commercial; check it before any commercial use.
- **Status:** in progress (Dr. O's 10-day build). The photo guide covers the bench build through the finished bench.
- **Open:** dry fit; the moving eye holder (first draft in `al-panel/eyes`, not printed); the hand.
- **Bench log sections:** every section that starts "ALICE" from 2026-10-25 to 2026-10-30, plus ALICE's hand; ALICE's joints and worn metal look; ALICE and the HuskyLens; HuskyLens and the head, aimed together; ALICE's moving eyes; Which wire for what; Standoffs: M2.5, not M3.

#### A.L.I.C.E. eye mechanism (Dr. O, 2026-11-12)

What was done and seen, and what is still open. Nothing here is a guess about cause.

- **Printed:** the eye mechanism parts, in black PLA on the Snapmaker U1: a flat base tray, eyelid and linkage arms, bracket frames, two black cups, and a black ball with a hole in the top. The parts were laid out and photographed. Which part is which has not been matched to the assembly document yet.
- **Base:** the trimmed base is 80 mm wide, 95 mm front to back and about 16 mm tall (measured from the file). It was started on the printer on 2026-11-11.
- **Space in her head:** 75 mm left to right and 72 mm front to back (measured by Dr. O). The 80 by 95 mm base is 5 mm too wide and 23 mm too deep for that space, so it does not fit as printed. Open: the smallest base that fits, and whether the servo mounts and pivot holders still fit in 72 mm.
- **Black ball:** the hole in the top has to be opened up. Open it by hand with a drill bit about the size of the metal stem, turned slowly with no drill motor, and stop when the stem drops in with a hair of play. Do not punch it, because printed PLA cracks.
- **27 mm glass eyes:** the glass eye does not go into the black cup. It rests on the rim, because the cup opening is narrower than the widest part of the eye. The cup's inside width has not been measured, so the cause of the mismatch is not known. The cup is sized for a smaller eyeball.
- **What settles it:** print the fit test, `al-panel/eyes/alice_eye_holder_v1_fit_test_3cups.stl` (three cups, 27.4, 27.8 and 28.2 mm inside, with one, two and three notches on the rim). Press the real eye into each, back first. The cup it drops into with a hair of play is the size the holder is built around. Not printed yet. The first-draft holder in `al-panel/eyes` is also untried on a real eye.
- **License:** the EyeMech files are by Will Cogley and are licensed non-commercial. The trimmed base is derived from them and is kept on the local computer only, never committed. Commercial use needs his permission first (enquiries@willcogley.com).

### Chapter 3. Astra-9

- **Who:** Astra-9, the 9th of her line, the elder guide: calm, steady, unhurried. Champagne mist with copper accents, no hair or wig. White lab coat and dress.
- **Host body:** full body, Raspberry Pi 5.
- **What makes her different:** a neck on a lazy Susan bearing, the head moves when she talks, eye rings that pulse (16-bit eye stack), a collar, a camera (no HuskyLens), mechanical sounds around her speech. She turns slowly toward a visitor. The Astra adapter (`astra_adapter.stl`, 3/8 in post, fully threaded 3/8 x 1 bolt). Idea Dr. O liked, not built: a ring of nine small lights on her chest, one for each robot.
- **Status:** body arrived, not built.
- **Open:** post thread size; post length and horn-to-swivel gap; where the camera sits and which camera.
- **Bench log sections:** The nine robots; Sounds around her speech; Who Astra 9 and Ted are toward each other; Build book update.

### Chapter 4. Astrad (Ted)

- **Who:** Astrad, called Ted, Astra's curious companion. Champagne mist with copper accents, no hair or wig. White lab coat and khakis.
- **Host body:** full body, Raspberry Pi 5.
- **What makes him different:** a neck on a lazy Susan bearing, the head moves when he talks, eye rings that pulse (16-bit eye stack), a collar, a camera (no HuskyLens), mechanical sounds around his speech. He turns faster than Astra. The Ted adapter (`ted_adapter.stl`, 1/4 in post). Ideas Dr. O liked, not bought: a 4 microphone array to hear which way a sound comes from, and a small servo to tilt his head.
- **Status:** body arrived, not built.
- **Open:** post thread size; post length and horn-to-swivel gap; where the camera sits and which camera.
- **Bench log sections:** The nine robots; Sounds around her speech; Who Astra 9 and Ted are toward each other; Build book update.

### Chapter 5. Astro and Astri (the twins)

The twins are built the same way. **The one build difference: if female (Astri), add rosy cheeks.** Astri is also dressed as a girl.

- **Who:** three years old. Their mother is Astra and their father is Astrad. Astro, called Teddy, carries a teddy bear named TB and asks people to play a game (checkers or chess) or to read a story to TB. Astri likes dolls and tea parties and holds a baby doll by the hand.
- **Look:** the Astra line look, champagne mist with copper accents, no hair or wig. Astri adds rosy cheeks.
- **Dr. O's original plan for their clothes (concept pictures: `al-panel/images/astri-concept-clothes_v1.png` and `al-panel/images/astro-concept-clothes_v1.png`):** both champagne finish, green eyes, a black choker and a round sensor on the chest, standing on a metal stand base. Astri: rosy cheeks, a lavender dress with a white Peter Pan collar, a small pink bow and a maroon "ETL" on the chest, bare feet, a baby doll held by the hand. Astro: a gray T-shirt with a maroon "ETL", khaki shorts, bare feet, a teddy bear held by the paw.
- **What Dr. O bought them (photo: `al-panel/images/twins-accessories_v1.png`, 2026-11-12):** Astro, blue striped monster pajamas and his teddy bear, TB. Astri, pink yeti pajamas and her baby doll. A tablet.
- **Planned:** a toddler backpack for each twin, to carry the teddy bear or the doll, the tablet and a blanket, so Dr. O does not have to carry them. Not bought yet.
- **Host body:** child mannequins.
- **Eyes:** 12-bit eye stack, two WS2812 rings of 12 lights each (24 in all). On each twin's Pi, a file `eye_leds` containing `24`.
- **Voice:** Astro, ElevenLabs. Astri, Azure (en-US-AnaNeural).
- **Status:** eye rings wired (2026-11-07), not yet tested on a Pi. Test the rings before anything is glued into the head.
- **Open:** neck-piece removal steps for child mannequins (waiting on photos).
- **Bench log sections:** Astro and Astri: eye rings (2026-11-07); Build book update.

### Chapter 6. Five more 3-year-olds

- **Who:** _Dr. O to fill in: names, and who each one is._
- **Host body:** child mannequins, the same as the twins.
- **Build:** the twins' chapter applies (12-bit eye stack, head-turn stack, magnet-tab panels); if female, add rosy cheeks.
- **Status:** Dr. O has all five, still in the box, not built (2026-11-12). The magnet tab count of 40 covers 5 robots; Dr. O's note says to order a second pack of magnets (10x3 mm, 60 pcs) for the 5 to 6 child mannequins to come.
- **Open:** neck-piece removal steps for child mannequins (waiting on photos).

### Chapter 7. The 10-year-old

- **Who:** _Dr. O to fill in: name and who this robot is._
- **Host body:** child mannequin.
- **Status:** Dr. O has the body; not put together yet (2026-11-12).
- **Open:** neck-piece removal steps for child mannequins (waiting on photos).

### Chapter 8. Guardian F

- **Who:** a Guardian. Gloss black head and neck, silver/chrome body, black uniform with an ETL patch.
- **What makes her different:** one large camera lens in the center of her face, a red LED strip mouth that sweeps while she speaks. No eyes and no eye stack. Idea Dr. O liked, not bought: a badge reader (NFC) so guests tap a badge and she greets them by name.
- **Status:** Dr. O has her, still in the box, not built (2026-11-12).

### Chapter 9. Guardian M

- **Who:** a Guardian. Gloss black head and neck, silver/chrome body, black uniform with an ETL patch.
- **What makes him different:** one large camera lens in the center of his face, a red LED strip mouth that sweeps while he speaks. Idea Dr. O liked, not bought: a small receipt printer that prints a pass or card for each visitor.
- **Status:** planned.

### Chapter 10. Biscuit

- **Who:** a yellow Labrador, female, the consummate storyteller. She can make a leaf become a saga.
- **Host body:** Sunraymascota fiberglass dog mannequin.
- **What makes her different:** tail wag and touch. Idea Dr. O liked, not built: ears that perk up when her name is said.
- **Status:** planned.
- **Bench log sections:** The dogs: touch and tail (2026-10-24).

### Chapter 11. Reggie

- **Who:** a beagle, super hyped and very happy to see humans. "HI HI HI... BEST part of my day is seeing YOU!!!"
- **Host body:** Sunraymascota fiberglass dog mannequin.
- **What makes him different:** tail wag and touch. Idea Dr. O liked, not built: an air quality chip so he sniffs the air and reports on it.
- **Status:** planned.
- **Bench log sections:** The dogs: touch and tail (2026-10-24).

### Chapter 12. Mochi

- **Who:** a French bulldog, male, the small one. A dog of few words: "hi."
- **Host body:** Sunraymascota fiberglass dog mannequin.
- **What makes him different:** tail wag and touch. Idea Dr. O liked, not built: a heartbeat or purr felt through the body when he is held.
- **Status:** planned.
- **Bench log sections:** The dogs: touch and tail (2026-10-24).

### Chapter 13. Lumvivo (the Holopod)

- **Who:** the hologram box. In the fireside chat, it speaks as whichever character it is showing.
- **Host body:** _Dr. O to fill in._
- **Bench log sections:** Fireside chat: one speaker at a time (2026-10-29).
