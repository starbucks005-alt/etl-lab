# Teddy's walking legs (2026-11-01)

Dr. O: "we are actually walking, his legs just do the back and forth movement." She and her helper hold his two hands and walk him. One button starts his legs swinging like steps, and the next push stops them. He does not carry himself or move forward on his own.

`teddy-walk/teddy-walk.ino` does it. It compiles for an ESP32-S3 board (Arduino core esp32 3.2.0, board ESP32S3 Dev Module). NOT TRIED on a real Teddy.

## What it is

- Two hobby servos, one at each hip. They swing in opposite directions, so when the left leg goes forward the right goes back.
- One push button. Push to start, push again to stop. It also stops by itself after 5 minutes.
- The swing eases in when it starts and eases out to straight when it stops, so nothing jerks.
- The numbers at the top of the sketch are first guesses: the pins, how far the legs swing (`SWING_DEG`, start at 10), how long a step takes (`STEP_MS`, start slow), and which way each servo faces (`LEFT_REVERSED`, `RIGHT_REVERSED`). Change them, upload again, try again.

## Wiring (default pins, change them in the sketch if your board needs other ones)

1. Left hip servo signal wire to pin 4. Right hip servo signal wire to pin 5.
2. Both servos' power wires to a separate 5 to 6 volt supply made for servos. Do not take servo power from the board's USB.
3. The servo supply's ground to the board's ground, and to both servos' ground wires, so all the grounds are joined.
4. A push button between pin 6 and ground. No resistor is needed, the board pulls the pin up itself.
5. Test with the legs OFF the servos first (just the horns turning), then fit the legs.

## Teddy's body, from the listing Dr. O pasted (2026-11-01)

Movable joints kid, 3 years old, realistic head with makeup, glass base. Colour: skin. Shoulder 10.5 in, bust 21.5 in, waist 20 in, hip 23 in, height 37 in, foot 6.5 in, base 12 in by 16 in.

- A hip of 23 in means the pelvis shell is roughly 7 in across, so two servos side by side inside it will be a tight fit. Measure the inside of the pelvis once he arrives, before choosing servos.
- The listing gives no weight. Weigh one whole leg when he arrives: that is the number that decides the servo.
- He stands on a glass base. For walking, he is held by his hands and the base is not used, so decide how he is lifted off it and where the glass base goes.

## The larger mannequins Dr. O has (photos she sent 2026-11-01)

Teddy is a smaller version of these. What the photos show, and what Dr. O said:

- Every joint is held by a hex socket bolt through a round hole in the side of the shell (hip, knee and ankle, all the same). Dr. O: "hex".
- The hip: the top of the thigh is a hollow shell that fits up into a notch in the pelvis. The hole in the side of the thigh, with the hex bolt behind it, is the hip pivot. The pivot axis runs side to side, which is the right direction for a forward and back swing.
- The thigh also has a horizontal seam partway down, and the knee and ankle are separate joints. Only the hips need to move for this.
- The legs are hollow (Dr. O confirmed, 2026-11-01). The walls are about 1/8 inch thick on Astra Lite's mannequin body (Dr. O, 2026-11-01, going by that one). Teddy's own walls have not been measured, so check them when he arrives. That is thin: a screw into the shell alone will not hold a servo that pushes on it, so a servo should sit on a bracket or plate glued over a wider area of the inside, or on a mount that clamps on the hinge bolt, with no new holes drilled through the shell.
- It depends on the stand (Dr. O, 2026-11-01): mannequins with a foot stand and mannequins with a full pole are different, but the bodies themselves are the same. Teddy has the pole stand (Dr. O, 2026-11-01, from his listing picture: a glass base with a pole going up into the body). On the ones with the full pole, the pole goes up into the torso, through the middle of the pelvis between the legs. It would be in the way of anything fitted inside the pelvis. For walking by hand, the pole and plate are not used, and taking the pole out leaves a hollow space up the middle for the board, the battery and the wires. Not known yet: how the pole comes out (it looked like it screws into the top of the pelvis in the assembly video) and whether the body still holds together without it.

One way to fit the servos, NOT tested and only an idea from the photos and the assembly video: a servo inside each thigh shell or the pelvis, its arm joined to the leg with a short link rod, and the hex-bolt hinge left as the pivot, so the leg's weight stays on the hinge and not on the servo shaft. The other way, turning the leg directly on its hip bolt, puts the weight on the servo and needs a stronger one.

## What the mannequin assembly video shows

Stills from the video (one every 12 seconds, so detail may be missed): the legs go into the hollow pelvis from the side and a hex bolt at the back holds each one. The same stub and bolt idea as in the photos above.

## Not known yet

- How much one leg weighs, which decides the servo. The listing gives sizes only.
- The thickness of the shell walls and how much room there is inside the thigh and the pelvis. Open one up and measure.
- How the pole comes out of him, and whether his body still holds together without it. From the listing pictures (2026-11-01): the side view shows the pole behind his lower back with two small knobs at the back of the pelvis, and the back view shows it rising between his legs to the bottom of the pelvis. Read together, it most likely goes up into the bottom of the pelvis from behind, held by those knobs, the same as on the larger mannequins. I first read the side view alone and thought it only clamped on the back, and the back view does not agree with that. I cannot see inside, so look at it when he arrives.
- Which board goes in him, and where the button goes on his body.
- Not built: a Walk button on a panel page, as the box panel has. The button on his body comes first.
