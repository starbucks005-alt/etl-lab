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
5. If her face does not look straight ahead when the head is in the middle, set the straight
   ahead number without taking the head off. `python3 ~/al_panel/al_neck.py --hold 100` moves
   to 100 and holds for a minute, then lets go. Try other numbers (between 30 and 150) until her
   face looks straight ahead, then keep it with `python3 ~/al_panel/al_neck.py --save 100` and
   `sudo systemctl restart al-neck`. The number is kept in `~/al_neck_middle.txt`. Not tried on the
   real head: which direction a bigger number turns it is not known yet.
6. If the neck only turns a short way, make the glance smaller so the servo never pushes against what blocks it:
   `python3 ~/al_panel/al_neck.py --save-glance 12` (0 to 40 degrees each way), then
   `sudo systemctl restart al-neck`. The number is kept in `~/al_neck_glance.txt`. Not tried on the real head.

## Start the eyes and the neck by themselves (after both have worked by hand)
`al-eyes.service` and `al-neck.service` start the two drivers when the Pi starts, the same
way `al-panel.service` starts the panel. The eye driver runs as root because the lights need it.
Not run on AL yet. To install both, on the Pi:
```
sudo curl -sSLo /etc/systemd/system/al-eyes.service https://raw.githubusercontent.com/starbucks005-alt/etl-lab/main/al-panel/pi/al-eyes.service && sudo curl -sSLo /etc/systemd/system/al-neck.service https://raw.githubusercontent.com/starbucks005-alt/etl-lab/main/al-panel/pi/al-neck.service && sudo systemctl daemon-reload && sudo systemctl enable --now al-eyes.service al-neck.service && sleep 3 && systemctl is-active al-eyes.service al-neck.service
```
It should print `active` twice. If a part is not connected yet, its service keeps trying
every 5 seconds and does no harm. The username `terryoroszi` is AL's; change it for another unit.

## The arcade Talk button (shares the sensor's line)
There is no free pin to reach without soldering, so the button shares GPIO13, the sensor's line. Wire the button's two
tabs between the GPIO12 plug's RED wire (3.3 volts, otherwise unused) and the plug's WHITE wire, with a 220 ohm resistor
in one leg (two 470 ohm side by side will do). It must join the white wire on the Pi's side of the sensor's own 470 ohm
resistor, not on the sensor's side, or the sensor's output holds the line low and the press is lost.
A tap pulls the line high for under a second and does the same as the panel's Talk to her button. The sensor holds its
line high for 3 seconds or more and still triggers the hello. `BUTTON_MAX_PULSE` in the server (1.0 second) is the
dividing line. A held press looks like the sensor, so tap, do not hold.
Tested here with a stand-in for the pin (a tap, a long signal, a repeat inside the wait, two taps, a 0.9 second tap).
NOT yet tried with a real button. While she listens her eyes brighten, so people can see she is.

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
Hands free, in card 8: "Keep listening after the hello" (on by default) makes her listen for about 20 seconds after
the hello, and again after each answer, so people can just talk to her. "Always listening" (off by default) makes her
answer only when she hears her name (Elle or Astra; speech to text often mishears it, so Al, Astro and Astrid count).
Hearing starts when a sound rises above the room's level (at least 600 on a 16 bit scale, `MIN_LEVEL`) and ends after a
second of quiet. That number is a first guess and needs tuning on the real Pi in a quiet room and in a noisy one: the
server prints "LISTEN room X, speech above Y" to the journal each time (`journalctl -u al-panel.service -f`).
Tested here with made-up audio and stand-ins only. She never listens while she is speaking, with a short pause after.
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

## Azure voice and listening (2026-10-14)
AL's own voice is Microsoft Azure `en-US-LunaNeural`, and her listening uses Azure speech to text, so the Azure credits
are used. Characters keep their ElevenLabs cast voices. The old ElevenLabs voice for AL, `DVXBaWlHfcpJmii7l8yI`, is kept
as the backup: if Azure fails she speaks in that voice instead of going quiet, and listening falls back to ElevenLabs Scribe.

Set up on the Pi (the key never goes in git): create `azure_speech.json` beside `al_panel_server.py`:

    {"key": "YOUR_AZURE_SPEECH_KEY", "region": "eastus"}

or set `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` in her environment. Add `"tts": false` or `"stt": false` to that file
to send that half back to ElevenLabs. Sound plays on `plughw:wm8960soundcard`; set `AL_PLAY_DEVICE` to change it.
Robot, American, British and Indian have an Azure voice (see AZURE_VOICES in the server): Luna for robot and American, Sonia for British, Neerja for Indian. Swedish stays on ElevenLabs, because Azure has no English voice with a Swedish accent. Characters stay on ElevenLabs.
Not tested on the Pi yet. First checks: she speaks, she hears you, and "Elle" sounds right (see `pronounce.json`).

## Camera for Astra Lite (plan, 2026-10-23, nothing built or tried)

Dr. O: Astra Lite keeps asking to "see" and saying she cannot see. A camera would answer her.
- **Where:** a pendant or brooch at the center of the collar, in the same copper ring style as the round medallion on her chest. The chest medallion is the motion sensor (PIR) and stays; the camera is a separate opening, because a camera cannot look through the PIR's lens. The head cannot be opened, so nothing goes inside it.
- **Why not the recessed eye:** the dome in one eye sits about 1/4 inch inside its hole and the other is flush. That eye could become the camera later, but the stack is glued from behind and cannot be reached, so it waits for a service hatch in the back of the head, cut along a panel line and held with magnets.
- **How:** a small USB camera with a thin flexible cable, 50 to 100 cm, run down inside the torso to the Pi, which sits at the base of the torso. Keep it away from the servo power wires. A clear flat window, not a dome.
- **Test first:** tape a USB webcam at the collar center and look at what she sees from where visitors stand. The chin may block part of an upward view.
- **The light:** a small NeoPixel ring around the window. Dr. O decided the pendant mirrors the eye color. Because it then glows all the time, it would not show when the camera is looking, so one option is to mirror the eye color and brighten or pulse the ring while a picture is taken. The ring cannot be chained after the eye rings, because the end of that chain is inside the head, so it needs its own data pin. The pin is not chosen: it has to be checked against the audio card.
- **What she does with it:** one still when asked to look, or when she decides to, described and then thrown away. No stored images, no recognizing faces (her instructions already say she cannot recognize anyone), a daily limit, and a posted sign near her. The panel already has a route that describes a photo someone shares, so a camera only supplies the picture.
- **Update 2026-10-23 (Dr. O's decisions):** the pendant uses a Waveshare ESP32-S3 camera board instead of the USB webcam above, a 12 LED WS2812 ring (Stemedu, 2 pack), a clear 1 mm acrylic disc as the lens window, 30 AWG silicone wire and USB-C plug breakouts. The Amazon order arrives Sunday Oct 25. The camera board itself is not in that order, and where it is coming from is not confirmed. The glow is diffused with frosted acrylic, the same way as the eyes, which she says works just like the panel. The clear lens window stays in the center, with a thin black divider so the glow does not leak into the lens. Not built or tried. Still open: the ring's data pin (needs the camera board's pin diagram) and whether the Azure model deployment accepts pictures.
- **Her words:** the main prompt is in `~/al.py` on the Pi, not in this repository. If it says she cannot see, that sentence needs a patch script in the style of `patch_al_prompt*.py`. Send the lines from `grep -n -i "see" ~/al.py`, with the key line removed.

## ALICE's hand (decision 2026-10-23, nothing bought, built or tried)

Dr. O's decision: ALICE gets a hand that can grip. First a cheaper kit to test on the bench, with the Honpine 17 DoF dexterous hand (about $2,263 on sale, ships from China, not checked: seller, specs, controller) as the wish list hand. ALICE is a cyborg, so a visible, imperfect fit suits her: no glove, mechanics left showing. Her body is the same fiberglass mannequin as Astra, Astrad and the Guardians, due after Monday Oct 26. The arms are not checked yet: do they come off, is the forearm hollow and how wide, wrist width, is the hand a separate piece. The kit is chosen after that. DFRobot Bionic Robot Hand Kit (ROB0143) was the pick from the listings checked, stock not confirmed; the SainSmart hand is discontinued and the BinHex hand is sold out.

Dr. O, 2026-10-24: for ALICE's hands, a cheap first try is the American Dress Forms wooden adult female jewelry hand display (eBay, $19, flexible wrists and fingers, listed as a "Set", free delivery in 2 to 4 days; a male one is $61.38). ALICE curls up with her arms around her knees, so her hands could be posed once and painted to look like worn metal; she needs a left and a right hand. The listing says it includes 1 left and 1 right hand (a pair for $19), 9.75 x 4.75 x 2 inches including the wrist stand (MPN FWHAND). Not checked: the length of the hand alone (about 6 to 7 inches by eye from the photos), whether it suits the mannequin's wrist. Dr. O's plan, 2026-10-24: paint the hands, and the limbs, to look like worn metal, as in her ALICE reference picture (gold bronze limbs, darker worn joints). A method to try, tested on a scrap first and sprayed outdoors: pose the fingers first so paint does not stiffen the joints; light sanding; dark wood primer; thin metallic coats (bronze, brass or gold spray, or a rub on metallic wax); a thin dark wash rubbed into joints and creases with the high points wiped clean; a thin matte or satin clear coat; paint the cut end at the wrist too. The hand kit above stays the later option for a hand that moves.

## The dogs: touch and tail (plan, 2026-10-24, nothing built, bought or tried)

Dr. O's decisions: the dogs wag their tails when petted or happy, and the touch map below is copied from the Hasbro Joy for All Pup care guide (sensors on head, both cheeks, mouth and back, a light sensor and a microphone; the guide lists no tail movement, so the wag is Dr. O's own addition).
- **Bodies:** Sunraymascota matte white fiberglass dog mannequins. Biscuit is the lab ($358.00 on the listing), Reggie the beagle ($166.00), Mochi the French bulldog ($195.00); names and breeds as Dr. O said on 2026-10-24. Shipping not known. Not ordered: she is getting the two human mannequins first and will decide on the rest after inspecting them. The older dog story and voice files still say Biscuit is a golden retriever and Mochi an English bulldog ("English, not French"); Dr. O will adjust the stories herself.
- **Touch map to copy:** head or cheek touch: wag and look at the person. Back, slow petting: slow calm wag. Name spoken: quick wag. Several minutes of nothing: goes to sleep, wakes when someone walks by or gives the head a pat. A MUTE setting that keeps the movement without sound is also in the guide.
- **Wag:** cut the tail off and fix it to a small servo (SG90 or MG90S type), driven from the servo board, one channel per dog. Mochi's tail is a short stub, so his wag may need a small made tail or a rear end wiggle. Wear a respirator when cutting fiberglass.
- **Petting:** a touch sensor (TTP223 type) behind the shell. Whether it works through the fiberglass is not known and is the first test. If not, a thin foam or fur layer over the spots, or a pressure pad inside.
- **Happy:** software, not hardware: a happy line or hearing its name starts a wag, faster when happier.
- **Mannequin sizes from the listings (Dr. O's screenshots, 2026-10-24; length x width x height):** Reggie, the beagle, 65 x 19.1 x 51.3 cm, 3.16 kg net, $166. Mochi, the French bulldog, 60 x 22.6 x 48.9 cm, 3.12 kg net, $195. Biscuit, the Labrador, 100.8 x 35.2 x 70 cm, 6.5 kg net, $358, in a 100 x 63 x 40 cm box. Biscuit is about 1.5 times as long as the others and about twice the weight. Whether any is hollow is not known.
- **Not known:** which board runs each dog, whether the bodies are hollow, how the tails attach. Pins are not chosen. Check these when the bodies are in hand.

## Registered voices for Elle (written 2026-10-23, NOT TRIED on the robot or with the real model)

Dr. O: "I want them to know my voice. Registered regular voices, their owners." Elle can tell registered voices apart and say she thinks it is that person. Only for people who agreed, only Elle (never a character), and OFF until the box in the panel's "Voices she knows" card is ticked.

**What is kept:** a name and a voice fingerprint (a list of numbers) per person, in `voices.json` beside the server, which is kept out of git. Never the recording: the clip is deleted as soon as the fingerprint is made. Nothing is sent anywhere. "Forget" in the panel removes a person.

**Consent:** a voice is registered only if the clip begins with the person saying "I agree that this robot may remember my voice." The words are checked with the listening service she already uses, so a recording of someone who never agreed is turned away. Voice prints are legally sensitive in some states (Illinois and Texas, for example). Ask a lawyer before using this where she meets the public in those states.

**It only chooses a greeting.** It is not a lock. Anyone with a recording of a voice could fool it. The panel's access code and anything important stay separate.

**How it reaches her:** while the words are found, the same clip is compared with the registered voices. If one matches closely and is clearly ahead of the next, a note is added to that turn: "Voice match: that sounded like NAME ... a likely match and not a certainty." Otherwise nothing is added and she answers as before. Her instructions still say she cannot recognize anyone, with that note as the one exception.

**Setup on the Pi (once):**
1. `sudo pip3 install resemblyzer --break-system-packages`. This pulls in a large machine learning library and may take a long time on a Pi 4. Not checked.
2. `sudo apt install -y ffmpeg` (only for the Use this recording button; recording with her microphone does not need it).
3. Check: `cd ~/al_panel && python3 -c "import al_voices; print(al_voices.ready())"`, which should print `(True, '')`. The panel card also shows why if it is not ready.
4. Restart the panel: `sudo systemctl restart al-panel.service`.

**Try it:** in the panel, tick the card's box. Type a name, tick "This person agrees", press Record, say the agreement and keep talking for about ten seconds. Do it twice. Then talk to her and watch the log: lines starting `VOICE` show who she thought it was and the score, never the words or the audio.

**Two numbers are guesses to tune from that log:** `MATCH_MIN` (0.78) and `MARGIN` (0.06) in `al_voices.py`. If she names the wrong person, raise them; if she never knows a registered voice, lower `MATCH_MIN` a little.

**Tests:** `python3 -m unittest tests/al_voices_test.py` (the fingerprint logic with stand-ins) and `python3 -m unittest tests/al_panel_voices_test.py` (the panel routes and the hook, with Flask and stand-ins). Both pass here. Neither uses the real model, a real microphone or the robot.

## ALICE's joints and worn metal look (plan, 2026-10-25, nothing bought, built or tried)

Dr. O's goal: ALICE's joints look like metal with open gaps and visible mechanism, as in her reference picture, not like a mannequin. The body is the RoxyDisplay FFXF fiberglass mannequin (eBay, American Dress Forms, arriving 27 to 29 October): detachable arms, torso and legs, separate segments with visible gaps already, a metal base with a calf rod. Not checked until it arrives: how far the knees bend (the reference pose is sitting with the knees to the chest), how tight the joints hold, how thick the fiberglass is, and how the neck attaches.

- **Method (Dr. O's, from Astra Lite's chest ring):** cut a gasket and center it, then paint it with craft metallic paint. For ALICE, gaskets and O-rings in a few sizes sit on each side of a joint gap as collars. Black tubing or braided cable fills the gap as a dark core, with a few small details (a bolt, a spring, fine wire for looks only, never power).
- **Colors:** bronze on the legs, a darker gunmetal on the arms. Then a dark wash rubbed into the low spots and wiped off the high ones, a light dry brush on the edges, and a matte clear coat.
- **Try first:** one knee, adding the core and collars without cutting anything. Cutting a gap into the fiberglass would weaken the joint and cannot be undone. Test the finish on the wooden hand, then on a spare piece of fiberglass, before the body.
- **Shopping list, after measuring each joint (knee, elbow, wrist, ankle):** flat gaskets and O-rings to fit, black tubing for the cores, bronze and gunmetal craft paint, a dark wash, matte clear coat.
- **Dust:** cutting or sanding fiberglass makes fine dust. Respirator, gloves and long sleeves, outdoors.
- **Access:** Astra Lite's head cannot be reopened, which made her eye and neck hard to fix. Keep the camera, the eyes and the wiring on ALICE reachable.

## ALICE and the HuskyLens: how each mode applies (plan, 2026-10-25, nothing wired or tried)

Dr. O: apply everything the HuskyLens does to ALICE. It sits in her body at the collar or chest (too big for the cheek plate) and tells the Pi what it sees; the Pi decides what she says and does. The list of modes is from DFRobot's video. The uses below are proposals for Dr. O to accept or change. How it connects to a Pi 5 is not checked.

- **Face recognition:** learns a face with one button press, on the sensor. First use: she knows Dr. O when she walks up. Teach it more than one view (the video's person wears glasses), in the light ALICE will sit in. Learn a face only for a person who agrees. It is for greetings, never for letting anyone in or allowing anything.
- **Object tracking:** locks onto something and follows it. Use: keep a person in view and have the Pi turn the neck servo to follow, inside the neck's limits.
- **Object recognition:** names things from a fixed list the sensor already knows (from memory, about 20 everyday kinds, such as person, chair, cup and dog; check DFRobot's page). Use: she can tell a person from a chair, and a dog from a cat.
- **Color recognition:** learns a color. Use: a colored card shown to her could be a signal, for example a particular color to start or stop talking.
- **Tag recognition:** reads printed tags like a small QR code. Use: a card with a tag for each of Astra's modes could switch the mode when it is shown to her. An idea, not decided.
- **Line tracking:** follows a line on the floor. Not used: ALICE sits and does not move.

Open: the Pi 5 connection and a Raspberry Pi example from DFRobot; whether the sensor's own screen can be turned off or hidden under the turtleneck; and how a learned face is deleted.
