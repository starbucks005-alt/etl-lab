/* Five lit buttons on the base of the hologram box, 2026-10-15, Dr. O.
   Left to right: 1 Alice, 2 Reggie, 3 Tansy, 4 Kevin, 5 Terry.
   A press types that number as a keyboard key. hologram.html listens for 1 to 5 and shows that hologram.
   The pressed button's ring stays lit until another is pressed, which matches the page (one hologram at a time).
   NOT TRIED ON THE REAL BOARD YET. Check the pins against the board's printed labels before wiring.

   Board: ESP32-S3 N16R8. Plug the port marked USB into the tablet (through the hub). The other port is only for loading this program.
   Arduino IDE settings: Board "ESP32S3 Dev Module", "USB Mode: USB-OTG (TinyUSB)" is NOT needed; use
   "USB CDC On Boot: Disabled" and "USB Mode: Hardware CDC and JTAG" is wrong for a keyboard, so choose "USB-OTG (TinyUSB)".
   PSRAM: "OPI PSRAM" (this is an N16R8 board). If the settings differ from these on your version, tell Claude what the menu says.

   Wiring:
     Each button switch: one wire to the button pin below, the other wire to GND.
     Each ring light: + wire to the 5V pin. - wire to the matching output on the ULN2003 board.
     ULN2003 inputs go to the LED pins below. ULN2003 ground goes to GND.
     Add a 150 ohm resistor in each ring's + wire unless the listing says the ring has one built in. */

#include "USB.h"
#include "USBHIDKeyboard.h"

USBHIDKeyboard Keyboard;

const int BTN[5] = { 4, 5, 6, 7, 15 };    // switches
const int LED[5] = { 16, 17, 18, 8, 9 };  // to the ULN2003 inputs
const char KEYCH[5] = { '1', '2', '3', '4', '5' };

int lit = -1;                 // which ring is on, -1 = none
bool wasDown[5] = { false, false, false, false, false };
unsigned long lastChange[5] = { 0, 0, 0, 0, 0 };

void showRing() {
  for (int i = 0; i < 5; i++) digitalWrite(LED[i], i == lit ? HIGH : LOW);
}

void setup() {
  for (int i = 0; i < 5; i++) {
    pinMode(BTN[i], INPUT_PULLUP);
    pinMode(LED[i], OUTPUT);
    digitalWrite(LED[i], LOW);
  }
  Keyboard.begin();
  USB.begin();
  // a short sweep so you can see the board is alive
  for (int i = 0; i < 5; i++) { digitalWrite(LED[i], HIGH); delay(120); digitalWrite(LED[i], LOW); }
}

void loop() {
  unsigned long now = millis();
  for (int i = 0; i < 5; i++) {
    bool down = (digitalRead(BTN[i]) == LOW);
    if (down != wasDown[i] && now - lastChange[i] > 40) {   // 40 ms to ignore contact bounce
      lastChange[i] = now;
      wasDown[i] = down;
      if (down) {
        Keyboard.write(KEYCH[i]);
        lit = i;
        showRing();
      }
    }
  }
}
