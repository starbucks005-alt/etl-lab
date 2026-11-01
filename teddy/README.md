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

## What the mannequin video shows (Flexable Mannequin Assembly Video, sent by Dr. O 2026-11-01)

Teddy's body is to be a smaller version of this mannequin. I looked at stills from the video, taken every 12 seconds, so I may have missed detail. What I saw:

- The pelvis is a hollow shell. Each leg has a short stub at the top of the thigh that goes into the pelvis from the side, and a hex bolt at the back of the pelvis holds it. So each hip is a hinge on a sideways axis, which is the right axis for a forward and back swing.
- The knees and ankles are separate joints. Only the hips need to move for this.
- The whole figure stands on a metal base plate with a rod up into the pelvis. Walking him by his hands means the base plate and rod are not used, or are replaced, for Teddy. That is a choice to make before the legs are fitted.

One way to fit the servos, NOT tested and only an idea from those stills: put each hip servo inside the pelvis shell, and join the servo's arm to the top of the thigh with a short link rod, leaving the mannequin's own hip hinge as the pivot. That keeps the leg's weight on the hinge and not on the servo shaft. The other way is to turn the leg's own stub with the servo, which puts the leg's weight on the servo, so it needs a stronger one.

## Not known yet

- The size of the smaller mannequin, how much one leg weighs, and so which servo is strong enough. Weigh one leg once you have it.
- Which board goes in him, and where the button goes on his body.
- Not built: a Walk button on a panel page, as the box panel has. The button on his body comes first.
