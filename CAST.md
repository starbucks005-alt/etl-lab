# The cast: where it lives, and what may overwrite what

`roster.json` is the source. Everything about a character is edited there and
nowhere else.

**The deploy runs it.** `netlify.toml` sets
`command = "node tools/cast-sync.js --write"`, so the derived index is rebuilt
from `roster.json` on every deploy and cannot drift.

Run `node tools/cast-sync.js` yourself after a cast change if you want the
report first. It only reports; `--write` rebuilds.

**It can fail a deploy**, and only on a fault in `roster.json` that no script
can fix: a portrait that 404s, two characters wearing one face, a duplicate
name, mis-encoded text. Those are the faults that have shipped unnoticed here
before, because nothing about them looks broken on the page. A stale index does
not fail the build, because it was just rebuilt.

## Why this file exists

There was never a drift problem between three copies of one roster. There was a
dead build pipeline and a live file that was never part of it:

    ETL_Agent_Roster.xlsx  ->  build_agent_data.py  ->  data/agents.generated.json
                                                    ->  data/etl-agents-roster.json

That pipeline last ran on **2026-06-08**. The spreadsheet was last touched on
**2026-07-08**. Every character change since then has gone into `roster.json`,
which the pipeline has never heard of.

So every attempt to "fix the drift" was hand-editing build outputs of a
spreadsheet nobody updates. It looked fixed and could not hold: the files still
carried `"do not hand-edit"` and still pointed at a source that had moved on
without them. Several sessions were spent on this and none of them held, which
is the expected result rather than bad luck.

## The three files

| file | what it is | may it be regenerated |
|---|---|---|
| `roster.json` | **the source.** Every character, every portrait. | never. this is the thing you edit |
| `data/agents.generated.json` | a thin index: name, platform, hasMCP, plus totals. Feeds index, investors, neighborhood. | yes, by `tools/cast-sync.js --write` |
| `data/etl-agents-roster.json` | **not a copy.** Its own schema and its own authored content. Feeds the studio and three studio functions. | **no. never. see below** |

## Do not rebuild the studio file

`data/etl-agents-roster.json` looks like a stale copy of the roster and is not
one. It carries fields that exist nowhere else — `consent`,
`real_person_disclosure`, `price_monthly`, `interview_protocol_ref`,
`person_type` — and six people who are in no other file, including **Dr. O
herself**, flagged `real_living_person` with a consent record.

Regenerating it from `roster.json` would delete her and destroy consent data.

`tools/cast-sync.js` reports on it and refuses to write it. Keep it that way.
Differences between it and the roster are for a person to decide one at a time,
not for a script to reconcile.

## The retired pipeline

`EMERGING_TECH_LAB/ETL_Agent_Roster.xlsx` and
`EMERGING_TECH_LAB/build_agent_data.py` are **retired**. They are still on disk
as history. Running the script would overwrite both JSON files with June data
and undo every character added since.

If a future session is asked to "fix the roster drift": the answer is not to
reconcile the files. It is to check that nothing has quietly re-armed the old
pipeline, run `tools/cast-sync.js`, and act only on what it reports.

## Portraits

A portrait must live under `etl-lab-push/` to deploy. Name every file with the
character's **full name** — `Ali_Malik_eyes_open.png`, not `Ali_eyes_open.png`.

Bare first names are how agents came to wear each other's faces: `Ali_eyes_open.png`
and `Eli_eyes_open.png` each exist in more than one project folder holding a
different person, so copying a folder across silently overwrote somebody. Dr.
Amina Farouk spent months as Benjamin Reed, and Eli Adler as Delia Marsh, both
without anything appearing broken.

`cast-sync.js` checks that every portrait resolves and that no two characters
share one. It cannot check that a file is who its name claims, so a filename is
never evidence: open the image.
