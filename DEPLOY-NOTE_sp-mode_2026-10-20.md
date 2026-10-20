# Standardized patient mode on Elle, 2026-10-20

Dr. O, 2026-10-20: "a nursing or med student will say to Elle (Astra Lite) Patient 12 and that will trigger an SP patient with x symptoms. Then the student
can say patient 13 and Elle will switch to a different SP patient."

## What changed

1. **`al-panel/pi/sp_mode.py`** (new file, goes next to `al_panel_server.py`). A copy of `elle/sp_mode.py` from the private `standardized-patients`
   repository, which is where it is kept and tested. It hears "Patient 12", "Patient twelve", "patient number 12", "End patient", and keeps the
   patient library in `~/al_panel/sp_library.json` so she still works with no Wi-Fi.
2. **`al_panel_server.py`**: a new mode, **Standardized patient** (`sp`). Saying a patient number in any mode puts her in it. While a patient is
   loaded her whole prompt is that patient's robot script and the robot rules, and nothing of hers (no lab facts, memory, mood or character). She
   keeps no notes in this mode. Every new number clears the chat first, so nothing carries over. Changing mode from the panel drops the patient.
   Typing "patient 12" in the panel's chat box works the same as saying it. She does not greet people in this mode.
3. **`al-panel/index.html`**: the mode is in the panel's mode list.

If `sp_mode.py` is missing she runs as before.

## Where the patients come from

The `standardized-patients` repository, served by its Azure site at `/api/library`. Elle needs two settings in `~/al_panel/sp_mode.json`:

```json
{ "SP_LIBRARY_URL": "https://<the site>.azurestaticapps.net/api/library", "SP_ELLE_KEY": "<same as ELLE_KEY in Azure>" }
```

Until that file exists and the Azure site is up, she answers "There is no patient 12 in the library."

## What was tested, and what was NOT

Tested here: the real `al_panel_server.py` imported with stand-ins for `al.py`, the voice and the eyes. Patient 3 loads Sally Dixie's script,
Patient 4 replaces it completely, End patient returns to the mode's waiting prompt, an unknown number is refused, the typed chat box works, and a
mode change from the panel drops the patient. The command parsing and the offline copy have their own tests in `standardized-patients`.

NOT tested on the Pi, and not with real speech to text: how the microphones hear "patient twelve" in a busy room is not known yet. The server
prints `SP patient 12` or `SP no patient` to the journal each time (`journalctl -u al-panel -f`).

Her voice is the one already chosen for her, so a male patient is played in her voice.
