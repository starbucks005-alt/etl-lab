/* Teddy's walking legs, 2026-11-01. Dr. O: "we are actually walking, his legs just do the back and forth movement", so when she and her helper hold
   his two hands and walk him, his legs swing like steps.

   One push button starts the swinging and the next push stops it. Two hobby servos, one at each hip, swing in opposite directions (when the left
   leg goes forward the right goes back). The swing eases in when it starts and eases back to straight when it stops, so nothing jerks.

   NOT TRIED on a real Teddy. The pins, the swing size and the speed below are first guesses: change the numbers at the top, upload again, try again.
   Start with a SMALL swing (SWING_DEG 10) and a slow step (STEP_MS 1600) and work up. */

#include <Arduino.h>

// ---- change these for your board and for Teddy ----
const int LEFT_SERVO_PIN  = 4;     // signal wire of the left hip servo
const int RIGHT_SERVO_PIN = 5;     // signal wire of the right hip servo
const int BUTTON_PIN      = 6;     // push button between this pin and GND (the board's own pull-up is used)
const int LEFT_CENTER_DEG  = 90;   // the servo angle where the left leg hangs straight down
const int RIGHT_CENTER_DEG = 90;   // the same for the right leg
const int SWING_DEG       = 10;    // how far each leg swings forward and back from straight (start small)
const bool LEFT_REVERSED  = false; // if the left leg swings the wrong way round, set true
const bool RIGHT_REVERSED = true;  // the right servo faces the other way on his body, so it usually needs true
const unsigned long STEP_MS = 1600; // time for one full step cycle, slower is gentler
const unsigned long EASE_MS = 1200; // time to ease in and out
const unsigned long WALK_MAX_MS = 5UL * 60UL * 1000UL; // stops by itself after this long, in case somebody forgets
// ---------------------------------------------------

const int PWM_HZ = 50, PWM_BITS = 14;
const int US_MIN = 500, US_MAX = 2400;   // pulse width for 0 and 180 degrees, check against your servo's sheet

bool walking = false;
unsigned long startedAt = 0, stopAskedAt = 0;
bool stopping = false;
float level = 0;                          // 0 = standing still, 1 = full swing
unsigned long lastMs = 0;
float phase = 0;                          // 0 to 2*pi, the position in the step

void servoWrite(int pin, float deg) {
  deg = constrain(deg, 0.0f, 180.0f);
  float us = US_MIN + (US_MAX - US_MIN) * (deg / 180.0f);
  uint32_t duty = (uint32_t)(us / 20000.0f * ((1 << PWM_BITS) - 1));
  ledcWrite(pin, duty);
}

void legs(float swing) {                   // swing is -1 to 1: left forward, right back
  float l = LEFT_CENTER_DEG  + (LEFT_REVERSED  ? -1 : 1) * SWING_DEG * swing * level;
  float r = RIGHT_CENTER_DEG + (RIGHT_REVERSED ? -1 : 1) * SWING_DEG * (-swing) * level;
  servoWrite(LEFT_SERVO_PIN, l);
  servoWrite(RIGHT_SERVO_PIN, r);
}

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  ledcAttach(LEFT_SERVO_PIN, PWM_HZ, PWM_BITS);
  ledcAttach(RIGHT_SERVO_PIN, PWM_HZ, PWM_BITS);
  legs(0);
  Serial.println("Teddy walk: push the button to start his legs, push again to stop.");
  lastMs = millis();
}

bool pressed() {                           // one press = one true, with a little debounce
  static bool was = false; static unsigned long at = 0;
  bool now = digitalRead(BUTTON_PIN) == LOW;
  bool hit = now && !was && millis() - at > 250;
  if (now && !was) at = millis();
  was = now;
  return hit;
}

void loop() {
  unsigned long ms = millis();
  float dt = (ms - lastMs) / 1000.0f; lastMs = ms;

  if (pressed()) {
    if (!walking) { walking = true; stopping = false; startedAt = ms; Serial.println("walking"); }
    else if (!stopping) { stopping = true; stopAskedAt = ms; Serial.println("stopping"); }
  }
  if (walking && !stopping && ms - startedAt > WALK_MAX_MS) { stopping = true; stopAskedAt = ms; Serial.println("stopping, the time is up"); }

  if (walking) {
    float step = dt / (EASE_MS / 1000.0f);
    if (stopping) { level -= step; if (level <= 0) { level = 0; walking = false; stopping = false; legs(0); Serial.println("stopped"); } }
    else          { level += step; if (level > 1) level = 1; }
    phase += 2.0f * PI * dt / (STEP_MS / 1000.0f);
    if (phase > 2.0f * PI) phase -= 2.0f * PI;
    if (walking) legs(sinf(phase));
  }
  delay(10);
}
