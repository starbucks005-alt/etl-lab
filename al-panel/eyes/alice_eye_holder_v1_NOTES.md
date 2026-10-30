# A.L.I.C.E. eye holder, first draft (v1), 2026-10-30

For the Tech-Optics "Doll and Mannequin Eyes 27mm" (a ball with a short neck and stem on the back; the listing page does not say what it is made of, glass or acrylic). **Nothing here has been printed or tried.** Every size is a guess until the real eye is pressed into the fit test.

## Step 1. Print only the fit test first

`alice_eye_holder_v1_fit_test_3cups.stl`: three small cups, with one, two and three notches on the rim.
- 1 notch = inner size 27.4 mm, 2 notches = 27.8 mm, 3 notches = 28.2 mm.
- Print with the open side up. Plain PLA, 0.2 mm layers, 3 walls, 15 to 20 percent infill. Supports only if the bottom looks rough.
- Press the real eye in, back first. You want it to drop in and sit on the opening at the back with a hair of play. If 27.4 is snug but fits, use it. If none fits, tell Claude what you see (too tight, too loose, which cup).
- Also check the opening at the back (18 mm across): the eye's neck and stem must go through it without touching. If the neck is wider than about 16 mm, say so.

## Step 2. The holder, once a size is chosen

These are made for the 27.8 cup. If another cup fits best, Claude will make the set again for that size.
- `alice_eye_holder_v1_cup_ID27.8.stl`: the cup. The eye is **glued in** (a glue made for glass and plastic). It has two pins at the sides and a tab at the bottom with a small hole for a servo rod.
- `alice_eye_holder_v1_yoke_for_cup_ID27.8.stl`: a frame around the cup. The cup's two pins go in its side holes (tilt, up and down). A bar over the top has a bolt hole (turn, left and right) and an arm to the back with a small hole for the second rod.
- `alice_eye_holder_v1_mount_plate_for_cup_ID27.8.stl`: a small plate above the frame. An M3 bolt goes through the plate and the frame, with a nylon lock nut, and the frame turns on it.
- One set of parts is for **one eye**. Print two sets for two eyes.

**Also needed, not printed:** per eye, two small metal-gear servos (MG90S or SG90 type), an M3 bolt about 12 mm long with a nylon lock nut, and two pieces of stiff wire about 1.5 mm thick for the rods, bent at the ends. To keep the cup's pins from falling out, touch the tip of each pin with a warm soldering iron so it mushrooms. The servos plug into the servo board, which has spare channels (the neck is on channel 8).

## What was checked, and what was not
- Checked in the model: all four parts are solid, and the cup moves inside the frame with nothing touching across 30 degrees of turn and 25 degrees of tilt.
- **Not checked:** that it prints well, that the sizes suit the real eye, where the servos go, the distance between the eyes in the head, how deep the head is behind the eyes, and the rod lengths.
- The tilt rod and the turn rod will each move a little when the other axis moves. The program can correct for that, or ball links can be used. Not yet tried.

Made with `make_alice_eye_holder_v1.py` (numbers at the top can be changed and the files made again).
