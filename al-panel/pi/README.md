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
- **Wheels and following (Dr. O, 2026-10-25):** wheels under the dogs and the same HuskyLens detection sensor ALICE has, so a dog follows a person. The HuskyLens reports where the person is and how big they look (how far); the Pi turns the wheels from that. Each dog would need a HuskyLens ($41.28), motors with wheels, a motor driver board, a battery and a front distance sensor. The yellow gear motor with wheel ($3.95 on the listing she showed) is a small hobby motor and is probably too weak for a 3 to 6.5 kg shell (from memory, not checked); buy one or two only to test the follow on a small board. Safety before any dog moves near people: slow top speed, stop when it bumps something, an easy off switch. The tail servo is still a small SG90 or MG90S per dog (the Monk Makes servo kit she looked at is out of stock and not needed).
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

**Seeing and detecting are two jobs (Dr. O's description, 2026-10-25):** the HuskyLens finds and knows, the camera sees. The HuskyLens reports a result to the Pi (a face is here, it is Dr. O, this far to the left) and does not hand the Pi a picture. The cheek camera takes the picture that goes to the model to be described, the same way Astra describes a photo someone shares. So ALICE knows who and where from the HuskyLens, and says what is in front of her from the camera. To check on DFRobot's page: that the HuskyLens cannot send the Pi its camera pictures.

## Which wire for what (Dr. O, 2026-10-25)

- **30 AWG wire (Fermerry silicone kit, 6 colors, 25 ft each): signals only.** Never for power. Under about half an amp. Use it for the eye data wire, the motion sensor output, the I2C plug and other small signals. The box is marked.
- **20 AWG wire (the XINWANG hookup wire kit, 6 colors, 7 m each, considered 2026-10-25, not bought):** fine for the branches off the strips, which are the servo board, the amplifier, the sensor and the eye rings.
- **The 5 V / 6 A feed from the supply into the strips:** the most current in the robot. 20 AWG can carry it over about a foot each way. 18 AWG has more margin and was $1 more in the same kit. Not decided.
- **Color rule:** red is plus and black is minus on every power wire. The replacement for the thin black wire that smoked on 2026-10-24 was red and white, so tag both ends of it with which is plus and which is minus. The cause of that wire smoking was not confirmed.
- **Fuse:** an inline fuse on the supply plus wire, a little above what the robot draws. Suggested, not fitted.
- **Joints:** screw terminals or solder, not twisted wire. Twisted joints came loose on the first build.

## Standoffs: M2.5, not M3 (Dr. O, 2026-10-25)

- The Pi boards and the HATs on them take **M2.5** screws and standoffs. The Vibit 640 piece M3 nylon kit bought earlier did not fit the Pi 4.
- Ordered 2026-10-25: a 365 piece M2.5 black nylon hex standoff, screw and nut kit (AvrestYPT), $10.74 with tax, arriving 2026-10-26. Not tried yet: whether it has a length that suits the HAT (about 10 to 12 mm).

## Astra Lite: the two 470 ohm resistors (Dr. O, 2026-10-25)

- **Blue heat shrink:** the 470 Ω resistor on the **yellow** wire of the HAT's GPIO12 plug. Its other end goes to the eye ring data wire. On 2026-10-25 the ring side was loose, with a bare resistor lead sticking out of the blue sleeve and the ring's data wire free. It is to be soldered or put on a screw terminal and covered, with the Pi and the strips off.
- **Yellow heat shrink:** the 470 Ω resistor on the **white** wire (GPIO13). Its other end goes to the motion sensor OUT.
- Check before power, with a meter and everything off: about 470 Ω across each resistor.
- A black wire with a bare end was also loose near the resistor. Found 2026-10-25: it is the Pi's ground (a meter beeped from it to a ground on the Pi). It is meant to join the minus bridge, on a screw terminal. Not confirmed here that this has been done. Do not power up until it is.

## Astra Lite repair: facts so far (Dr. O, 2026-10-25)

- **The plug on the HAT's GPIO12 socket has fixed colors:** yellow is GPIO12 (eye data), white is GPIO13 (the sensor line), black is the Pi's ground, red is 3.3 V and is not used. Cap the red end so it cannot touch anything.
- **Every other wire color is Dr. O's own memory aid.** The wire colors came from a kit at random, so a color does not say what a wire does. Find out what a wire does with the meter, not by color.
- **Dr. O's wiring notes, as she wrote them:** eye stack orange to red to the plus bridge, green to black to the minus bridge, white through a resistor to the yellow wire to the GPIO12 socket. Arcade button white through a resistor to the white wire to the GPIO12 socket, which also goes to the orange wire on the motion sensor board (so the button shares the sensor's line, as the code expects). Her note says GP12 for the socket in both places, which is the socket name, not the pin.
- **Not confirmed:** where the arcade button's brown wire goes. It should go to ground (the black wire in the plug or the minus bridge), never to the yellow wire. A meter check settles it: with everything off, the brown side should beep to ground.
- **Not powered until:** the eye data wire is joined to the blue-sleeve resistor, the black wire is on the minus bridge, the red 3.3 V wire is capped, each 470 ohm resistor reads about 470 ohms, and plus to minus does not beep.
- **The old wiring picture (CH0, GPIO4, no resistors) is out of date.** The Astra-9 Lite build document says so itself. The code and the bench have the neck servo on channel 8, the sensor on GPIO13 and a 470 ohm resistor on each data line. A corrected picture has not been drawn.

## Astra Lite: where the head and bust and the Pi 4 were bought (Dr. O, 2026-10-25)

- Both were bought on eBay on 2026-09-16. The Pi 4 is order 02-15191-57036, $65.11 (2GB bundle). The head and bust (Astra Lite is a head and bust, not a body) is order 14-15166-73592, $58.53, which shipped untracked.
- The Astra-9 Lite build document lists the head and bust as the American Dress Forms test head at $54.45. The difference of $4.08 is 7.5 percent of $54.45, which looks like tax. Not confirmed from the order page.

## ALICE: the HAT working on a Pi 5 (Dr. O, 2026-10-26, day 1)

Raspberry Pi 5 8GB, Raspberry Pi OS 64-bit (kernel 6.18), hostname ALICE, written with the Raspberry Pi Imager (SSH on, Raspberry Pi Connect off). The Seeed-style 2-Mic HAT (WM8960 chip) gave sound with earphones in its headset jack. What it took:
1. In `/boot/firmware/config.txt`: remove the `#` from `dtparam=i2c_arm=on`, and add `dtoverlay=wm8960-soundcard` on its own line under `[all]` at the bottom. Reboot. (The overlay file `wm8960-soundcard.dtbo` is already in the system, nothing to install.)
2. After that `aplay -l` lists `card 2: wm8960soundcard` (the two HDMI outputs are cards 0 and 1, the Pi 5 has no headphone jack of its own) and `i2cdetect -y 1` shows `UU` at address 1a (the chip, claimed by its driver).
3. The tone was silent until three things were switched on: the `Headphone` switch and `PCM Playback` (both showed `MM`, muted, in `alsamixer -c 2`), and the two output mixer switches `Left Output Mixer PCM` and `Right Output Mixer PCM`, which were `off`: `amixer -c 2 sset 'Left Output Mixer PCM' on` and the same for Right.
4. Then `speaker-test -D plughw:wm8960soundcard -c 2 -t sine -f 440 -s 1` (left) and `-s 2` (right) were heard in both ears. Saved with `sudo alsactl store`.

5. The settings did NOT survive a reboot. `alsactl store` saved them, but after boot the Headphone volume was 0 (the two output mixer switches stayed on). The same thing happened on Astra Lite (Dr. O remembers; how that was fixed is not written down). Fix on ALICE: a small boot script `/usr/local/bin/alice-audio.sh` that waits 20 seconds (`sleep 20` as its second line), then sets `Left Output Mixer PCM` and `Right Output Mixer PCM` on, `Headphone` to 91% and `Playback` to 84%, run by a systemd service `/etc/systemd/system/alice-audio.service` (Type=oneshot, enabled). Cause not confirmed: something resets the volume after the script would otherwise have run; the wait works around it. After the 20 second wait was added, the sound held through a reboot (Dr. O, 2026-10-26).

Not checked: the speakers through the DROK amp, the microphones, the panel software on the Pi 5. The router showed the Pi on the wired connection; the WiFi has not been joined yet (set the WLAN country to US in `raspi-config`).

## ALICE: parts, cost and build decisions (Dr. O, 2026-10-25, nothing built or tried)

**Who she is and what she has.** ALICE has a Raspberry Pi 5 (8GB), no eye rings and no back button. She sees through a camera in a plate on the cheek, and the HuskyLens sits in her body. Two wigs were given to Dr. O: a short black bob with bangs, like her reference picture (seated, arms around her knees, hair framing the face with the cheek showing).

**What was bought for her, and what it cost** (with tax where the order showed it; parts from the second set are priced from the Astra-9 build brief, shared packs split as the brief splits them):

| Item | Cost |
|---|---|
| Mannequin body and the pair of wooden hands (eBay) | $610.61 |
| Plastic head, SKU 70399 (Store Supply Warehouse, with shipping and tax) | $64.40 |
| Dark green 27 mm eyes (Tech-Optics) | $57.95 |
| HuskyLens | $41.28 |
| Arducam Camera Module 3, 75 degrees, autofocus | $38.70 |
| Camera cable for Pi 5, 0.5 m, pack of 2 (her half) | $5.37 |
| Aves Apoxie Sculpt (cheek plate) | $20.37 |
| DROK 5W+5W amp board (PAM8406) | $10.74 |
| CQRobot speakers, 2 to 3 W pair | $9.66 |
| 3.5 mm plug to screw terminal audio cable | $7.84 |
| Micro-HDMI cable | $7.51 |
| M2.5 standoff kit (one eighth) | $1.34 |
| Raspberry Pi 5, 8GB (Amazon, MemoryWhiz, $200.00 each, 2 bought) | $200.00 |
| microSD 128GB SanDisk Extreme (one of two) | $41.40 |
| Pi 5 power adapter (Amazon, RasTech US, $12.99 each, 2 bought) | $12.99 |
| ReSpeaker 2-Mic HAT | $11.99 |
| Motion sensor (share of the 5-pack) | $1.90 |
| Neck servo MG996R | $6.99 |
| Servo board PCA9685 | $6.50 |
| Lazy Susan bearing, as listed | $9.98 |
| 5 V / 6 A supply | $14.99 |
| Heat shrink kit (half) | $1.75 |
| 1000 uF capacitor (one of 20, $5.36 with tax) | $0.27 |
| 470 ohm resistor (one of 40, listing price) | $0.12 |
| WAGO 221-413 lever connectors (one eighth of $25.75) | $3.22 |
| Female jumper to Grove cables (2 of the 5 pack, $9.57) | $3.83 |
| Transport chair (one ninth of $106.10, shared by all 9 robots, Dr. O 2026-10-27) | $11.79 |
| **Total** | **$1,205.89** |

Not counted: paint, the cargo bag (for her parts, not yet decided whether it is hers alone or shared), her clothes, the twisted red and white wire, the Dupont wires, the old amp boards (the DROK replaced the old amp, which was priced at $4.00 as half of the $7.99 pack and left out), and the standoff, wire and terminal packs bought for other robots.

**Arrival.** Camera, camera cable, DROK amp, audio cable, micro-HDMI cable, WAGO connectors and the Grove cables: Mon 26 Oct. HuskyLens and M2.5 standoffs: 26 Oct. CQRobot speakers and Apoxie Sculpt: Tue 27 Oct. Body and hands: shipped 26 Oct by FedEx Ground, due 27 to 29 Oct, may come sooner (eBay order 27-15308-37718). Eyes (Tech-Optics): estimated Wed 28 Oct at checkout (standard ground, $9.95); the listing said as soon as Sat 31 Oct, and the confirmation email has not been seen. Head: shipped (Dr. O, 2026-10-26), arrival date not shown yet. The eye openings cannot be cut until the eyes are here.

**Decisions.**
- **No soldering on ALICE.** WAGO 221-413 lever connectors for joins and the ground and power bundles. A 4 pin female jumper to Grove cable from the HAT's I2C socket to the servo board's pins (it has pins fitted); plug only GND, SCL, SDA and VCC, never V+. Speakers, amp power and the audio cable go on screw terminals; the CQRobot speaker plugs (JST 1.25) are cut off. The motion sensor goes to the HAT's GPIO12 socket on GPIO13 through a 470 ohm resistor, as on Astra Lite, not GPIO4 as the old brief says.
- **Camera wire goes inside the head**, not outside: through a slot behind the camera plate (about 18 mm by 3 mm), down the back wall, a loose loop of 10 to 15 cm at the neck, then through the open center of the lazy Susan beside the servo shaft to the Pi. Nothing else crosses the neck, because she has no eye stack.
- **Cheek plate** goes on the front of the cheek, in front of where the wig falls, as in the reference picture. Scuff the surface with 120 to 150 grit and wipe it with alcohol before the Apoxie Sculpt. Put the wig on first, then mark the plate.
- **Sound test first, with earphones** in the HAT's headset jack, until the speakers arrive.
- **Cooling:** Astra Lite has none. Measure with `vcgencmd measure_temp` with ALICE running and her body closed; buy a cooler only if it stays above about 65 C.
- **Pis:** two Pi 5 boards and two RasTech power adapters were bought on Amazon for Astra and Astrad (order 111-7457292-7008204: the Pi 5 8GB from MemoryWhiz at $200.00 each, the adapters from RasTech US at $12.99 each; the same order also holds a QSYZAIL 54 piece perf board kit), and a Pi 4 for Astra Lite: Raspberry Pi 4 Model B 2GB bundle with a SanDisk 16GB microSD and a USB-C cable (new, sealed), bought on eBay on 2026-09-16 for $65.11, order 02-15191-57036, seller kollectedbyque, no returns (eBay purchase page, 2026-10-25). The Astra-9 Lite build document says Amazon for this order, which is wrong. One Pi 5 now goes to ALICE and one is spare. The spare Pi 5 goes to Astra. Still to buy, one each: Astrad (Ted), Guardian M, Guardian F and the three dogs, six in all (Dr. O, 2026-10-25). Pi 4 or Pi 5 for each is not decided.

**The body, from the listing (Dr. O, 2026-10-26, not yet seen in person).** Female Mannequin Fleshtone Full Body, Realistic Pose, Includes Stand, FFXF (eBay order 27-15308-37718, American Dress Forms, Roxy Display Inc.). Fiberglass with a smooth fleshtone finish. Detachable arms, torso and legs (the photo line also says detachable waist and detachable, fully formed hands). Metal base with a calf rod. Bust 34.5 in, waist 24.5 in, hip 34 in, height 71 in. Weight not listed. It comes in pieces. It includes its own head (realistic face), which she does not plan to use: whether it detaches, and how the neck is made, are not known until the body arrives. Possible access without cutting: the torso lifts off the hips. Not checked: whether the torso is hollow all the way, the wall thickness, how each piece joins.

**Not checked.** The HAT working on a Pi 5, and the panel software on a Pi 5, have not been tried. The bag marked Motor has not been confirmed as the MG996R. The head's neck opening, the hole in the middle of the bearing (the ribbon needs about 20 mm) and the round hole inside the head near the ear have not been measured or explained. Whether the 0.5 m cable is long enough with the loop has not been measured.

## ALICE: servo board and neck motor wiring (Dr. O, 2026-10-26, day 1, motor NOT yet moved)

What was built at the bench and what was found. Dr. O did all of it herself.

1. **The HAT sockets are the wide 2.5 mm JST XH size.** A 2.0 mm HY2.0 Grove plug does not fit them. This was found when the Grove cable would not go in. Order XH cables, not Grove, for the HAT I2C socket and the motion sensor socket.
2. **The join that worked:** the cable from the bag of plug-and-bare-wire cables (wide plug on one end, bare black, orange, yellow and white wires on the other) goes into the HAT I2C socket. Each bare wire is joined to the matching servo board jumper wire (GND, SCL, SDA, VCC) with its own WAGO 221-413 lever connector. About 7/16 in of bare wire per side. One wire pair per connector, so one slot in each is left empty.
3. **Result:** `i2cdetect -y 1` shows `40` (the servo board) and `70` (the board's all-call address), and `UU` at `1a` (the HAT sound chip).
4. **Servo board header:** only GND, SCL, SDA and VCC are used. OE and V+ on that header are left alone. The motor's power comes in through the green screw terminal.
5. **Polarity lesson:** red wire under the plus screw, black under the minus screw. The first marking on the board was reversed, and the wires went on the wrong screws first. Dr. O checked it with the multimeter (continuity and Ω, probes firm on bare metal): no short between red and black, and the reading climbs to OL because of the board's capacitor, which is normal. A short chirp from the meter across V+ and GND is also the capacitor.
6. **The 5 V adapter** is an AC/DC adapter, model YS-0506, input 100 to 265 VAC, output 5 V 6 A. Its round plug has a screw terminal piece attached. Before connecting, set the meter to DC volts, put the red probe on one screw and the black on the other, and read about 5.0 with the adapter in the wall (a minus sign means the red probe is on minus). Power order: Pi first, then the 5 V. Ring off.
7. **Not yet done:** the 5 V is not connected, and the motor has not been moved. The program is `al_neck.py`, which drives channel 8. Whether channel 8 is the top row of the third group of sockets is the standard layout but has not been tested. If the motor does not move, try the neighbouring channels.

## ALICE head: delivery (Dr. O, 2026-10-27)

The carrier page shows the head arriving Wed 28 Oct 2026, between 11:30 AM and 3:30 PM, last seen in Pooler, GA. That is day 3 of the ten day plan. Not received yet.

## Orders placed 2026-10-25 on eBay: cargo bag and transport chair (Dr. O, 2026-10-27)

From her order screenshot. The chair is for transporting ALICE and the other robots: when Dr. O takes the robots to events she cannot carry them. The bag is for ALICE's parts.

| Item | Seller | Order number | Total | Estimated delivery |
|---|---|---|---|---|
| Small Mini Parachute Cargo Bag, black canvas, new with tags | armyuniverse | 27-15309-81617 | $32.24 | Sat 31 Oct |
| Lightweight Elderly Transport Wheelchair, portable folding transport chair, 250 lb, black and blue, new | pinguaabiy | 27-15309-79263 | $106.10 | Fri 30 Oct |

Together $138.34. The ten day plan has a transport test in the chair on day 10 (Wed 4 Nov), and the chair is due on day 5. The chair's cost is shared by all 9 robots (Dr. O, 2026-10-27): $11.79 each, which is in ALICE's total above. The bag has not been decided and is not counted. Dr. O is getting two chairs, but only one has been bought so far (2026-10-27); the second is not ordered and not counted. When it is bought, the shared cost is both chairs divided by 9.

## ALICE: WiFi (Dr. O, 2026-10-27, tried and working)

Done over SSH from her laptop while the Ethernet cable was still in:

1. `sudo raspi-config nonint do_wifi_country US`
2. `sudo nmcli radio wifi on`
3. `nmcli device wifi list` (her network showed in the list)
4. `sudo nmcli device wifi connect "NETWORK NAME" password "PASSWORD"`
5. `ip -4 addr show wlan0` gave 192.168.0.139. The address is handed out by the router, so it can change.

Then the Ethernet cable came out and she reconnected over WiFi at 192.168.0.139. After `sudo reboot` the Pi joined WiFi by itself at the same address, and the HAT volume was back at 91% from the boot script.

A ping with the cable still in does not prove WiFi, because it can go out through the cable. The test is to unplug the cable and reconnect.

## ALICE: where day 2 stopped (Dr. O, 2026-10-27, one hour logged, back spasms)

- The neck program is on the Pi at `~/al_panel/al_neck.py`. The download address returned 14 bytes ("not found" is the likely text, cause not checked), so it was pasted in instead. It matches the repository copy (md5 1cafe59c28147707b189a3102c1fd251, 4722 bytes, 141 lines) and compiles.
- `vcgencmd get_throttled` gave 0x0. `i2cdetect -y 1` shows 40, 70 and UU at 1a.
- The 5 V adapter's green block is marked + and -. The meter read 5.37 V with the red probe on +, so the marks are right. The red wire is under +, black under -.
- The neck motor test (`python3 ~/al_panel/al_neck.py --test`) was NOT reported back. Not known whether the motor moved.
- The Pi dropped off the network once during the day (connection reset, no green light, red light on). A press of the small power button brought it back. Cause not known: there was no persistent journal to read. It later showed WiFi connected (Serenity) at 192.168.0.139, and the cable address is 192.168.0.140.
- The panel server will not start on ALICE yet: it loads `~/al.py`, which holds the keys and is not in the repository. The only copy is on Astra Lite's Pi. Not done, and not urgent for the neck test.
- Speakers (CQRobot) arrived. Each has its own twisted orange and black pair ending in a small white 2-pin plug. To use the amp's screw terminals the plugs have to be cut off and the wire stripped. Not cut yet.
- The amp is the DROK 5W+5W (PAM8406), a 5 V board. Its labels for the four speaker screws were not readable in photos. Next: with no power, find which of the two top screws is ground by continuity to the G pad by the audio jack. Do not feed the amp more than 5 V.

## ALICE: neck program on the Pi 5 (Dr. O, 2026-10-28, day 3)

1. On a Pi 5 the first run of `al_neck.py` stopped with "The platform library 'adafruit_blinka_raspberry_pi_pwm' was not found". Fix, run on the Pi:
   `sudo pip3 install 'Adafruit-Blinka-Raspberry-Pi-PWM>=1.0.2' Adafruit-Blinka-Raspberry-Pi5-Neopixel --break-system-packages`
   It ended with "Successfully installed" for both. The "running pip as root" warning is harmless.
2. After that, `python3 ~/al_panel/al_neck.py --test` ran with no error and the prompt came back. Dr. O heard the motor.
3. The shaft turned (Dr. O, 2026-10-28), and it sounded like AL's neck when she turns her head. The program drives channel 8. Not yet written down: which channel number is printed beside the plug, and whether it turned both ways and came back to the middle.
4. The Pi dropped off WiFi a second time that morning (connection reset, then timed out, then reachable again without the button). Cause not known. The cable address 192.168.0.140 is the way back in.
