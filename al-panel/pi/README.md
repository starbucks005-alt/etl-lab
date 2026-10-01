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
