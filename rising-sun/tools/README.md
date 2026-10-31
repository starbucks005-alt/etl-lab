# make-box: set up a companion box, or a lid screen, in one go

For Dr. O (2026-10-31): "we will likely make a few companion boxes, so make a script to automate this process."

## Use it

1. On GitHub, download the repository as a ZIP (the green Code button, Download ZIP) and unzip it. Do this again whenever the sketches change.
2. Open the unzipped folder, then `rising-sun`, then `tools`.
3. Double-click `make-box.bat`.
4. Answer the questions: which kind (1 box, 2 screen), a short name for the box (desk, kitchen), the Wi-Fi name and password (2.4 GHz), and the home access code. They are kept on this computer only, in `ETL-Box\settings.json` in your user folder, so the next box only asks for the name.
5. Plug the board in. Close the Arduino IDE Serial Monitor first.
6. It builds, uploads, then listens to the board for ten seconds and tells you whether it saw "Wake word engine: ok" and "Wi-Fi: joined".
7. Open `emerging-tech-lab.com/rising-sun/box-panel.html`, pick the new box name, and choose its companion.

The first run downloads the Arduino command line tool and the ESP32 board files (a few minutes, once). Later runs are quick.

## What it does for you

- Sets the Partition Scheme (ESP SR 16M) and PSRAM (OPI) itself for the audio board. That is what makes the wake word model go on the board. The IDE kept forgetting it. The command line upload was checked, on another computer, to write the model at 0xD10000.
- Uses board files 3.2.0 exactly, and the two screen libraries at the versions the sketch was built with.
- Writes `secrets.h` from your answers into a clean copy, so a secret never lands in a sketch folder you might upload to GitHub.

## Not tried

It has not been run on Windows, and PowerShell has not checked its syntax: the commands it runs (build, and the upload command with its flash addresses) were checked on another computer. If it stops with red text, copy the red lines and send them to Claude. `make-box.bat -DryRun` from a command prompt builds without uploading.
