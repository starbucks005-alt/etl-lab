#!/usr/bin/env python3
"""GO: set up a robot's Pi from Dr. O's laptop.

Plug the imaged Pi into the laptop's network (cable or same Wi-Fi), run this, answer
a few questions, press GO. It copies the panel files to the Pi over SSH and runs a
setup script there. The script checks each step first and skips what is already
done, so it is safe to run again. It finishes with a PASS / FAIL list.

    py tools\\robot_go.py                 (asks the questions)
    py tools\\robot_go.py --dry-run       (shows everything, touches no Pi)

Never put keys in this file. The Azure key is typed at a hidden prompt, travels to
the Pi inside the SSH copy, and is written there with owner-only permissions.
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import shlex
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
PANEL = HERE.parent                      # al-panel/
PI_DIR = PANEL / "pi"

# Not copied to a robot: one-off patch and helper scripts.
EXCLUDE_PREFIXES = ("patch_al_prompt", "make_", "remove_private", "find_voices")
DATA_FILES = ["moods.json", "personalities.json", "pronounce.json"]

# What each robot is. A robot picks its own character from the files on its Pi:
# the panel serves index_alice.html when that file is present (see SELF_PERSONA in
# al_panel_server.py). Only ALICE has such a page so far. Others use index.html and
# get their character from the panel.
ROBOTS = {
    "alice":      {"name": "ALICE",     "hostname": "ALICE",     "eyes": "animatronic",  "mode": "companion",       "page": None, "voice": "elevenlabs", "camera": True, "husky": True},
    "astra9":     {"name": "Astra-9",   "hostname": "astra9",    "eyes": "led-ring",     "mode": "companion",       "page": None, "voice": "elevenlabs"},
    "astrad":     {"name": "Astrad",    "hostname": "astrad",    "eyes": "led-ring",     "mode": "companion",       "page": None, "voice": "elevenlabs"},
    "astra-lite": {"name": "Astra Lite", "hostname": "astra9lite", "eyes": "led-ring",    "mode": "companion",       "page": None, "voice": "azure"},
    "astro":      {"name": "Astro",     "hostname": "astro",     "eyes": "led-ring",     "mode": "children-friend", "page": None, "voice": "elevenlabs"},
    "astri":      {"name": "Astri",     "hostname": "astri",     "eyes": "led-ring",     "mode": "children-friend", "page": None, "voice": "elevenlabs"},
    "guardian":   {"name": "Guardian",  "hostname": "guardian",  "eyes": "led-ring-red", "mode": "guardian",        "page": None, "voice": "tbd"},
}

SETUP_SH = r'''#!/usr/bin/env bash
# Runs on the Pi, started by robot_go.py. Safe to run again: each step checks first.
set -u
cd "$(dirname "$0")"
. ./go.conf
H="/home/$ROBOT_USER"
CFG=/boot/firmware/config.txt
REBOOT=0
FAILS=0
say() { printf '%-5s %s\n' "$1" "$2"; }
pass() { say PASS "$1"; }
skip() { say SKIP "$1 (already done)"; }
did()  { say DONE "$1"; }
fail() { say FAIL "$1"; FAILS=$((FAILS+1)); }
warn() { say WARN "$1"; }

sudo -v || { echo "sudo failed"; exit 2; }
MODEL=$(tr -d '\0' < /proc/device-tree/model 2>/dev/null)
echo "Pi model: $MODEL"
echo "Setting up: $ROBOT_NAME"
echo

# 1. hostname
if [ "$(hostname)" = "$ROBOT_HOSTNAME" ]; then skip "hostname $ROBOT_HOSTNAME"
else sudo hostnamectl set-hostname "$ROBOT_HOSTNAME" && did "hostname set to $ROBOT_HOSTNAME (shows after reboot)" && REBOOT=1 || fail "hostname"; fi

# 2. I2C on, HAT sound overlay
if grep -q '^dtparam=i2c_arm=on' $CFG; then skip "I2C on"
elif grep -q '^#dtparam=i2c_arm=on' $CFG; then sudo sed -i 's/^#dtparam=i2c_arm=on/dtparam=i2c_arm=on/' $CFG && did "I2C turned on" && REBOOT=1
else echo 'dtparam=i2c_arm=on' | sudo tee -a $CFG >/dev/null && did "I2C turned on" && REBOOT=1; fi
if grep -qx 'dtoverlay=wm8960-soundcard' $CFG; then skip "HAT sound overlay"
else echo 'dtoverlay=wm8960-soundcard' | sudo tee -a $CFG >/dev/null && did "HAT sound overlay added" && REBOOT=1; fi

# 3. packages
NEED=""
for p in python3-flask python3-pip i2c-tools alsa-utils curl; do dpkg -s "$p" >/dev/null 2>&1 || NEED="$NEED $p"; done
if [ -z "$NEED" ]; then skip "apt packages"
else sudo apt-get update -qq && sudo apt-get install -y $NEED >/dev/null 2>&1 && did "installed:$NEED" || fail "apt install:$NEED"; fi

# 4. Python libraries for the neck and eyes (Pi 5 needs the Blinka PWM and Neopixel ones)
pipneed() { pip3 show "$2" >/dev/null 2>&1 || { sudo pip3 install "$2" --break-system-packages >/dev/null 2>&1 && did "pip $2" || fail "pip $2"; }; }
pipneed adafruit_servokit adafruit-circuitpython-servokit
case "$MODEL" in
  *"Pi 5"*) pipneed adafruit_blinka_raspberry_pi5_neopixel Adafruit-Blinka-Raspberry-Pi5-Neopixel
            python3 -c "import adafruit_blinka_raspberry_pi_pwm" >/dev/null 2>&1 || { sudo pip3 install 'Adafruit-Blinka-Raspberry-Pi-PWM>=1.0.2' --break-system-packages >/dev/null 2>&1 && did "pip Blinka PWM" || fail "pip Blinka PWM"; } ;;
  *)        pipneed rpi_ws281x rpi_ws281x ;;
esac
pass "libraries checked"

# 5. audio volume script (the HAT forgets its volume at boot). An existing script is never overwritten.
if [ -f /usr/local/bin/alice-audio.sh ]; then skip "volume script"
else
  sudo tee /usr/local/bin/alice-audio.sh >/dev/null <<'EOS'
#!/bin/bash
sleep 20
C=wm8960soundcard
amixer -c $C sset 'Left Output Mixer PCM' on
amixer -c $C sset 'Right Output Mixer PCM' on
amixer -c $C sset 'Headphone' 91% unmute
amixer -c $C sset 'Playback' 84%
EOS
  sudo chmod 755 /usr/local/bin/alice-audio.sh && did "volume script written" || fail "volume script"
fi
if [ -f /etc/systemd/system/alice-audio.service ]; then skip "volume service"
else
  sudo tee /etc/systemd/system/alice-audio.service >/dev/null <<'EOS'
[Unit]
Description=Set the HAT volume at boot
After=sound.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/alice-audio.sh

[Install]
WantedBy=multi-user.target
EOS
  sudo systemctl daemon-reload && sudo systemctl enable alice-audio.service >/dev/null 2>&1 && did "volume service enabled" || fail "volume service"
fi

# 6. panel files
mkdir -p "$H/al_panel"
if [ -n "$(ls -A "$H/al_panel" 2>/dev/null)" ]; then
  BK="$H/al_panel_backup_$(date +%Y%m%d-%H%M).tgz"
  tar -czf "$BK" -C "$H" al_panel 2>/dev/null && did "backup of the current panel saved to $BK" || fail "backup of the current panel"
fi
tar -xzf files.tgz -C "$H/al_panel" && did "panel files copied to $H/al_panel" || fail "copy panel files"

# 7. al.py (holds the keys and the main prompt). Never printed.
if [ -f al.py ]; then
  mv -f al.py "$H/al.py" && chmod 600 "$H/al.py" && did "al.py installed" || fail "al.py"
elif [ -f "$H/al.py" ]; then skip "al.py"
else warn "al.py is not on this Pi. The panel cannot start until it is copied to $H/al.py"; fi

# 8. Azure speech key (only if one was typed)
if [ -f azure_speech.json ]; then
  mv -f azure_speech.json "$H/al_panel/azure_speech.json" && chmod 600 "$H/al_panel/azure_speech.json" && did "Azure key stored (owner only)" || fail "Azure key"
elif [ -f "$H/al_panel/azure_speech.json" ]; then skip "Azure key"
elif [ "$VOICE" = "azure" ]; then warn "no Azure key set. Voice falls back to ElevenLabs"
else pass "voice is $VOICE only, no Azure key needed"; fi

# 9. shutdown button permission
if [ -f /etc/sudoers.d/al-shutdown ]; then skip "shutdown permission"
else
  echo "$ROBOT_USER ALL=(root) NOPASSWD: /usr/sbin/shutdown" | sudo tee /etc/sudoers.d/al-shutdown >/dev/null
  sudo chmod 440 /etc/sudoers.d/al-shutdown
  sudo visudo -c >/dev/null 2>&1 && did "shutdown permission" || { sudo rm -f /etc/sudoers.d/al-shutdown; fail "shutdown permission"; }
fi

# 10. identity file for this robot
sudo mkdir -p /etc/etl-robot && sudo cp robot.json /etc/etl-robot/robot.json && did "identity written to /etc/etl-robot/robot.json" || fail "identity file"

# 11. services
for s in al-panel al-neck $WANT_EYES; do
  sed "s/terryoroszi/$ROBOT_USER/g" "services/$s.service" | sudo tee "/etc/systemd/system/$s.service" >/dev/null
done
sudo systemctl daemon-reload
for s in al-panel al-neck $WANT_EYES; do sudo systemctl enable "$s.service" >/dev/null 2>&1 && did "$s enabled" || fail "enable $s"; done
if [ -f "$H/al.py" ]; then sudo systemctl restart al-panel.service; fi
sudo systemctl restart al-neck.service $WANT_EYES 2>/dev/null
sleep 6

# 12. camera
if [ "$HAS_CAMERA" = "yes" ] && [ "$CAM_PORT" = "none" ]; then
  if rpicam-hello --list-cameras 2>&1 | grep -qi 'No cameras'; then warn "no camera detected. Check the ribbon and which port it is in (cam0 or cam1)"
  elif rpicam-hello --list-cameras 2>&1 | grep -q 'Available cameras'; then pass "camera found (nothing changed)"
  else warn "could not check the camera (is rpicam-hello installed?)"; fi
fi
if [ "$CAM_PORT" != "none" ]; then
  if command -v rpicam-hello >/dev/null 2>&1 && rpicam-hello --list-cameras 2>&1 | grep -q 'Available cameras' && ! rpicam-hello --list-cameras 2>&1 | grep -qi 'No cameras'; then pass "camera found"
  else
    if grep -q "^dtoverlay=imx708,$CAM_PORT" $CFG; then warn "camera not detected on $CAM_PORT. Check the ribbon and the port"
    else echo "dtoverlay=imx708,$CAM_PORT" | sudo tee -a $CFG >/dev/null && did "camera overlay added for $CAM_PORT" && REBOOT=1; fi
  fi
fi

echo
echo "---- checks ----"
I2C=$(sudo /usr/sbin/i2cdetect -y 1 2>/dev/null)
echo "$I2C" | grep -q UU && pass "HAT sound chip seen on I2C" || warn "HAT sound chip not seen yet (a reboot may be needed)"
echo "$I2C" | awk '/^40:/{print $2}' | grep -q 40 && pass "servo board seen at 40" || warn "servo board not seen at 40 (is it plugged in and powered?)"
if [ "$HAS_HUSKY" = "yes" ]; then
  echo "$I2C" | awk '/^30:/{print $4}' | grep -q 32 && pass "HuskyLens seen at 32" || warn "HuskyLens not seen at 32 (is it plugged in and set to I2C?)"
fi
aplay -l 2>/dev/null | grep -q wm8960 && pass "sound card wm8960 present" || warn "sound card not present yet"
systemctl is-active --quiet al-neck.service && pass "neck service running" || warn "neck service not running"
if [ -f "$H/al.py" ]; then
  curl -fsS -m 8 http://localhost:8000/ >/dev/null 2>&1 && pass "panel answers on port 8000" || fail "panel did not answer on port 8000. Run: journalctl -u al-panel.service -n 40"
fi
echo "throttled: $(vcgencmd get_throttled 2>/dev/null)   temp: $(vcgencmd measure_temp 2>/dev/null)"
echo
echo "FAILS=$FAILS REBOOT_NEEDED=$REBOOT"
exit $FAILS
'''


def ask(prompt: str, default: str = "") -> str:
    shown = f" [{default}]" if default else ""
    answer = input(f"{prompt}{shown}: ").strip()
    return answer or default


def collect(args: argparse.Namespace) -> dict:
    print("\nETL robot GO\n")
    key = args.robot or ""
    while key not in ROBOTS:
        print("Robots: " + ", ".join(ROBOTS))
        key = ask("Which robot").lower().replace(" ", "-")
    r = ROBOTS[key]
    host = args.host or ask("Pi address (for example 192.168.0.139 or ALICE.local)")
    user = args.user or ask("Pi username", "terryoroszi")
    has_camera = bool(r.get("camera"))
    if args.camera:
        cam = args.camera
    elif has_camera:
        cam = ask("Camera port (cam0, cam1, or detect to just check for it)", "detect")
    else:
        cam = "none"
    if cam not in ("cam0", "cam1", "none", "detect"):
        sys.exit("camera port must be cam0, cam1, detect or none")
    eyes = args.eyes or ask("Eyes (led-ring, led-ring-red, animatronic, none)", r["eyes"])
    hostname = args.hostname or ask("Hostname for this Pi", r["hostname"])
    al_py = args.al_py
    if al_py is None:
        al_py = ask("Path to al.py copied from Astra Lite (Enter to skip)", "")
    azure_key, azure_region = "", "eastus"
    if r["voice"] == "azure" and not args.dry_run and not args.no_keys:
        azure_key = getpass.getpass("Azure speech key (hidden, Enter to skip): ").strip()
        if azure_key:
            azure_region = ask("Azure region", "eastus")
    return {"key": key, "robot": r, "host": host, "user": user, "cam": cam, "eyes": eyes,
            "hostname": hostname, "al_py": al_py, "azure_key": azure_key, "azure_region": azure_region}


def build_bundle(a: dict, out: Path) -> list[str]:
    """Stage everything the Pi needs into `out`. Returns the list of panel files."""
    # The Oct 31 files in to_AL/ are the newest: ALICE's Pi serves a page that matches
    # to_AL/index.html (checked 2026-11-07). They replace the older copies in pi/ and al-panel/.
    TO_AL = PANEL / "to_AL"
    chosen: dict[str, Path] = {}
    for p in sorted(PI_DIR.glob("*.py")):
        if not p.name.startswith(EXCLUDE_PREFIXES):
            chosen[p.name] = p
    for name in DATA_FILES:
        if (PI_DIR / name).exists():
            chosen[name] = PI_DIR / name
    chosen["index.html"] = PANEL / "index.html"
    if (PANEL / "personas.json").exists():
        chosen["personas.json"] = PANEL / "personas.json"
    for name in ("al_panel_server.py", "al_cues.py", "index.html", "robots.json"):
        if (TO_AL / name).exists():
            chosen[name] = TO_AL / name
    files: list[tuple[Path, str]] = [(src, arc) for arc, src in chosen.items()]
    page = a["robot"]["page"]
    if page:
        if not (PANEL / page).exists():
            sys.exit(f"{page} is missing from {PANEL}")
        files.append((PANEL / page, page))
    with tarfile.open(out / "files.tgz", "w:gz") as tar:
        for src, arc in files:
            tar.add(src, arcname=arc)
    (out / "services").mkdir()
    for s in ("al-panel", "al-neck", "al-eyes"):
        (out / "services" / f"{s}.service").write_bytes((PI_DIR / f"{s}.service").read_bytes())
    want_eyes = "al-eyes" if a["eyes"].startswith("led-ring") else ""
    conf = {
        "ROBOT_USER": a["user"], "ROBOT_NAME": a["robot"]["name"], "ROBOT_HOSTNAME": a["hostname"],
        "CAM_PORT": "none" if a["cam"] == "detect" else a["cam"], "HAS_CAMERA": "yes" if (a["robot"].get("camera") or a["cam"] in ("cam0", "cam1")) else "no",
        "HAS_HUSKY": "yes" if a["robot"].get("husky") else "no", "WANT_EYES": want_eyes, "VOICE": a["robot"]["voice"],
    }
    (out / "go.conf").write_text("".join(f"{k}={shlex.quote(v)}\n" for k, v in conf.items()), newline="\n")
    (out / "robot.json").write_text(json.dumps({
        "id": a["key"], "name": a["robot"]["name"], "hostname": a["hostname"],
        "eyes": a["eyes"], "mode": a["robot"]["mode"], "voice": a["robot"]["voice"], "camera_port": a["cam"], "camera": bool(a["robot"].get("camera")), "husky": bool(a["robot"].get("husky"))}, indent=2), newline="\n")
    (out / "setup.sh").write_text(SETUP_SH, newline="\n")
    if a["al_py"]:
        src = Path(a["al_py"]).expanduser()
        if not src.is_file():
            sys.exit(f"al.py not found at {src}")
        (out / "al.py").write_bytes(src.read_bytes())
    if a["azure_key"]:
        (out / "azure_speech.json").write_text(json.dumps({"key": a["azure_key"], "region": a["azure_region"]}), newline="\n")
    return [arc for _, arc in files]


def ssh_base(a: dict) -> list[str]:
    return ["-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=10"]


def go(a: dict, dry: bool) -> int:
    with tempfile.TemporaryDirectory(prefix="etl-go-") as tmp:
        out = Path(tmp)
        names = build_bundle(a, out)
        print(f"\nRobot: {a['robot']['name']}   Pi: {a['user']}@{a['host']}   hostname: {a['hostname']}")
        print(f"Eyes: {a['eyes']}   camera: {a['cam']}   al.py: {'yes' if a['al_py'] else 'NOT included'}   voice: {a['robot']['voice']}   Azure key: {'yes' if a['azure_key'] else 'not used' if a['robot']['voice'] != 'azure' else 'no'}")
        print(f"Panel files to copy ({len(names)}): " + ", ".join(names))
        if dry:
            print("\nDRY RUN: nothing was sent. The setup script would do these steps, in order:")
            for line in SETUP_SH.splitlines():
                if line.startswith("# ") and line[2:3].isdigit():
                    print("  " + line[2:])
            return 0
        if ask("\nType GO to start", "").upper() != "GO":
            print("Stopped. Nothing was changed.")
            return 1
        target = f"{a['user']}@{a['host']}"
        remote = "/tmp/etl-go"
        files = ["files.tgz", "services", "go.conf", "robot.json", "setup.sh"] + \
                [f for f in ("al.py", "azure_speech.json") if (out / f).exists()]
        print("\nCopying to the Pi (it may ask for the Pi's password)...")
        r = subprocess.run(["ssh", *ssh_base(a), target, f"rm -rf {remote} && mkdir -p {remote}"], cwd=out)
        if r.returncode:
            print("Could not reach the Pi. Check it is on, on the network, and the address is right.")
            return 2
        r = subprocess.run(["scp", *ssh_base(a), "-r", *files, f"{target}:{remote}/"], cwd=out)
        if r.returncode:
            print("Copy failed.")
            return 2
        print("\nRunning setup on the Pi...\n")
        r = subprocess.run(["ssh", "-t", *ssh_base(a), target,
                            f"bash {remote}/setup.sh; rc=$?; rm -rf {remote}; exit $rc"])
        print("\nAll clear." if r.returncode == 0 else f"\n{r.returncode} step(s) FAILED. Read the FAIL lines above.")
        return r.returncode


def main() -> int:
    ap = argparse.ArgumentParser(description="Set up a robot's Pi from the laptop.")
    ap.add_argument("--robot", choices=list(ROBOTS))
    ap.add_argument("--host")
    ap.add_argument("--user")
    ap.add_argument("--camera")
    ap.add_argument("--eyes")
    ap.add_argument("--hostname")
    ap.add_argument("--al-py", dest="al_py", default=None)
    ap.add_argument("--no-keys", action="store_true", help="do not ask for the Azure key")
    ap.add_argument("--dry-run", action="store_true", help="show the plan, touch no Pi")
    args = ap.parse_args()
    return go(collect(args), args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
