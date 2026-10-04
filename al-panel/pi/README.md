# AL panel server (runs on AL's Pi)

Status: written 2026-10-01. The server logic was tested with a stand-in for
`al.py`. It has NOT been run on AL's hardware, and the Claude photo call and the
eye lights are untested.

## What is here
- `al_panel_server.py` serves the panel and its buttons (eyes, accent, skills, chat, photos).
- `al_eyes.py` drives the two eye rings from GPIO12. It needs the rings wired.
- `make_samples.py` records one sample clip per accent, for the website demo.

## Setup on the Pi
1. Make a folder: `mkdir -p ~/al_panel`
2. Put `al_panel_server.py` and `al_eyes.py` in it, and the panel page from
   `al-panel/index.html` as `~/al_panel/index.html`.
3. Install Flask: `sudo apt install -y python3-flask`
4. Start the server: `python3 ~/al_panel/al_panel_server.py`
5. On a phone or laptop on the same network, open `http://<AL's address>:8000`.
   The status pill should say "Connected to AL".

## Eyes (after the rings are wired)
1. `sudo apt install -y python3-pip` then `sudo pip3 install rpi_ws281x --break-system-packages`
2. `sudo python3 ~/al_panel/al_eyes.py`
3. If it complains about the Pi's own audio, turn that off with `dtparam=audio=off`
   in `/boot/firmware/config.txt` and restart. That is flagged in the build brief.

## Motion sensor (after the sensor is wired)
Not run on AL yet. The signal wire goes to GPIO13, the second signal pin of the HAT's
GPIO12 socket, because the pins under the HAT are not reachable. Which wire of the cable
is GPIO13 has to be found with a meter before it is connected (see the build brief).
Power the sensor from the 5V supply, not from the cable.
1. The panel server reads the sensor itself and holds GPIO13, so there is nothing to
   start. It cannot tell whether a sensor is plugged in. After a minute of warm-up the
   panel says it is listening, and then shows when the sensor last noticed someone. Wave
   a hand in front of the dome and that line should change within a few seconds.
2. To test with the small script instead, stop the panel first, because only one program
   can hold the pin: `sudo systemctl stop al-panel.service`, then
   `python3 ~/al_panel/al_motion.py`, wait for "Ready", wave a hand, press Ctrl+C, and
   start the panel again with `sudo systemctl start al-panel.service`.
3. In the panel, card 8 "When someone walks up" picks what AL does (say hello, turn her
   head, brighten her eyes) and how long she waits before welcoming again. The choices
   are saved in `welcome.json` next to the server and are not cleared by Reset.
   "Welcome now" does the same thing by hand, for when the sensor misses someone.
4. If the library is missing or the pin cannot be taken, the panel says the sensor could
   not be started, and everything else keeps working.

## Neck (after the servo board is wired)
Moved the motor on the bench on 2026-10-04, on channel 8 (found by trying each channel in turn).
The PCA9685 board takes its two data wires from the HAT's I2C socket.
Measure that socket's power pin with a meter before connecting the board's logic power.
1. `sudo pip3 install adafruit-circuitpython-servokit --break-system-packages`
2. `i2cdetect -y 1` should show 40 once the board is connected.
3. With the head OFF the servo: `python3 ~/al_panel/al_neck.py --test` does one small
   glance and stops.
4. `python3 ~/al_panel/al_neck.py` waits for the panel server to ask for a glance.
   The head is limited to 60 degrees each side of the middle. One motion sensor cannot
   tell where a person is, so the head makes a small glance and comes back; it does not aim.

## Start the eyes and the neck by themselves (after both have worked by hand)
`al-eyes.service` and `al-neck.service` start the two drivers when the Pi starts, the same
way `al-panel.service` starts the panel. The eye driver runs as root because the lights need it.
Not run on AL yet. To install both, on the Pi:
```
sudo curl -sSLo /etc/systemd/system/al-eyes.service https://raw.githubusercontent.com/starbucks005-alt/etl-lab/main/al-panel/pi/al-eyes.service && sudo curl -sSLo /etc/systemd/system/al-neck.service https://raw.githubusercontent.com/starbucks005-alt/etl-lab/main/al-panel/pi/al-neck.service && sudo systemctl daemon-reload && sudo systemctl enable --now al-eyes.service al-neck.service && sleep 3 && systemctl is-active al-eyes.service al-neck.service
```
It should print `active` twice. If a part is not connected yet, its service keeps trying
every 5 seconds and does no harm. The username `terryoroszi` is AL's; change it for another unit.

## Switching her off (the Shut down button)
Card 9 in the panel, "Switching off", shuts the Pi down properly: she says goodnight, then the Pi halts.
Wait about 30 seconds after that, then it is safe to switch the power off. Pulling the power while the Pi is
running can slowly damage its memory card. The button is only shown when the page is served by the Pi, and it
takes two taps so a stray tap cannot do it.
The panel needs permission to run the shutdown without a password. Run this once on the Pi:
```
echo 'terryoroszi ALL=(root) NOPASSWD: /usr/sbin/shutdown' | sudo tee /etc/sudoers.d/al-shutdown && sudo chmod 440 /etc/sudoers.d/al-shutdown && sudo visudo -c
```
Until that is done the button says so and shuts nothing down. Tested only with stand-ins here, not yet on the Pi.

## Talking to her by voice (the Talk to her button)
Card 6 in the panel has a "Talk to her" button, shown only when the page is served by the Pi. Press it, speak for
6 seconds, and she answers out loud, the same way as a typed message. The server records from the HAT's microphones
with `arecord` (card `plughw:wm8960soundcard`; a 5 second record and play back through it worked on 2026-10-04),
sends the clip to ElevenLabs speech to text (`scribe_v1`, the same account and key that gives her voice, so it uses
some credit), and gives the words to the same reply code as the typed box.
Tested here with stand-ins for the microphone and the service. NOT yet run against the real service on the Pi, so
the model name and the pace of the answer are unproven. She does not listen all the time: one press, one question.
Her own speaking and the recording never overlap, so she does not hear herself.
Note for later: `al.py` plays sound on `plughw:3,0`, by card number. Turning the Pi's own audio off moves the HAT
from card 3 to card 2, which silenced her on 2026-10-04. Leave the built-in audio on, or change that line to
`plughw:wm8960soundcard`.

## Limits and notes
- Eye brightness is capped at 30 percent of the lights' full power, in two places.
- Photos are held in memory only and are never saved.
- The accent voices are Astra-9's five, from `good-company/gc-friend.js`.
- A page on the secure website cannot reach AL on the local network, so open the panel from AL's own address.

## Real voices in the website demo
The website version cannot use live voices (Good Company's demo allowance is about
3 spoken replies per visitor per day). Instead:
1. On the Pi: `python3 ~/al_panel/make_samples.py` makes five clips in `~/al_panel/audio/`.
2. Copy them to a laptop, for example: `scp terryoroszi@192.168.0.87:~/al_panel/audio/*.mp3 .`
3. Upload the five files to `al-panel/audio/` on `main` (GitHub's web page works).
   Keep the names exactly: `accent-robot.mp3`, `accent-american.mp3`, `accent-swedish.mp3`,
   `accent-british.mp3`, `accent-indian.mp3`.
The panel plays them, and falls back to the device voice if a clip is missing.
