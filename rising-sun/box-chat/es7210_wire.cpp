/* The microphone chip driver from Waveshare's demo (es7210.c) talks to the chip with the old I2C driver. The speaker chip files and Wire use the newer one, and the ESP32 will not start
   when both are in the same program ("CONFLICT! driver_ng is not allowed to be used with this old driver", seen on Dr. O's board, 2026-10-30). This one small function writes a register
   with Wire instead, and es7210.c calls it where it used to use the old driver. Nothing else in es7210.c was changed. */
#include <Arduino.h>
#include <Wire.h>

extern "C" int es7210_wire_write(uint8_t i2c_addr, uint8_t reg_addr, uint8_t reg_val) {
  Wire.beginTransmission(i2c_addr);
  Wire.write(reg_addr);
  Wire.write(reg_val);
  return Wire.endTransmission(true) == 0 ? 0 : -1;
}
