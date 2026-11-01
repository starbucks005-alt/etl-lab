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

## Not known yet

I found no description of Teddy's body in the repository, only his picture and voice, so these are open:

- What his legs are and how they join his body at the hip, and how much a leg weighs. That decides which servo is strong enough. Weigh one leg.
- Whether the legs are already free to swing at the hip, or need a hinge made.
- Which board goes in him, and where the button goes on his body.
- Not built: a Walk button on a panel page, as the box panel has. The button on his body comes first.
