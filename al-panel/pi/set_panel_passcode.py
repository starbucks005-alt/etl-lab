#!/usr/bin/env python3
"""Sets, changes or removes the panel passcode from the robot itself (written 2026-11-24).

    python3 set_panel_passcode.py            asks for a new passcode (hidden), twice
    python3 set_panel_passcode.py --remove   removes the lock, no passcode needed: being at the robot is the proof

The passcode is never printed and never stored, only its salted fingerprint (see al_lock.py).
"""
import argparse
import getpass
import os
import sys

import al_lock


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--remove", action="store_true", help="remove the passcode lock")
    a = ap.parse_args()
    if a.remove:
        try:
            os.remove(al_lock.LOCK_FILE)
        except OSError:
            pass
        al_lock.al_chain.append(al_lock.LOG_FILE, "passcode_removed_at_robot", {})
        print("The panel is open again. Set a new passcode on the panel, or run this again without --remove.")
        return
    one = getpass.getpass("New passcode (at least %d characters, hidden): " % al_lock.MIN_LENGTH)
    two = getpass.getpass("Again: ")
    if one != two:
        sys.exit("They did not match. Nothing changed.")
    try:
        if al_lock.is_set():
            os.remove(al_lock.LOCK_FILE)           # at the robot, so no need for the old one
        al_lock.set_passcode(one)
    except ValueError as e:
        sys.exit(str(e))
    print("The panel is locked. Sign in with the new passcode on any browser.")


if __name__ == "__main__":
    main()
