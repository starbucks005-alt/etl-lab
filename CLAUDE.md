# Working on ETL Lab

Dr. O's rules. This file exists because it did not, and a task description
handed me a side branch and there was nothing here to say otherwise.

---

## 1. WORK ON MAIN. NOT ON A BRANCH.

Her rule, and it holds in every repository she owns, not just the one it first
got written down in. Restated 2026-09-10: *"there is supposed to be a rule to
only use Main and not side branches anyway."*

The reason, from the My Echo repository where it cost most of an evening twice:

She uploads files through GitHub's web page. GitHub puts an upload on
**whatever branch is currently open**. When work is happening on a side branch,
her files land there, and any check run against `main` says they do not exist.
It happened with two logo files at 18:00, and again at 01:00 the same evening
with two more, and both times she was told her files were not in the repository
when they were, on the branch.

One branch means her uploads and this work are never in different places. That
is the whole of it.

The second reason is this site. It deploys from `main`. Work sitting on a side
branch is not on the site, so it is not done, and if she is teaching a class in
twenty minutes it may as well not exist.

The third reason is hers, 2026-09-10, and it is the worst of the three:

> *"prior to that rule I had changes made that were not committed or pushed that
> were weeks old and never identified because they were on a branch."*

Finished work, asked for and done, that nobody could see and nobody knew to look
for. A branch is where it goes to be forgotten. One was still sitting there when
she said this: the unmute button she reported on the Almost Human intro film was
fixed on 2026-09-04 and left on `claude/phone-screen-accessibility-7ly9tz`, six
days off the site, brought onto main the same day she said the sentence above.

So this rule is not only about where her uploads land. Anything finished belongs
on `main` and pushed, today, or it is not finished.

If a harness or a task description assigns a feature branch, main is still where
this repository is worked on: push there, and say so.

## 2. WHEN SHE SAYS A FILE IS THERE, IT IS THERE. GO FIND IT.

Before telling her a file has not arrived:

1. `git fetch --all`. A local clone is only as current as its last fetch, and
   hers land while work is in flight.
2. Check the branch she is working on, not just `main`.
3. Check the repository root as well as `assets/`. An upload lands where the
   page was open, which is not always the folder anybody meant.

A file listing is only proof about the ref it came from, AND about the moment it
was fetched. `git ls-remote origin` and compare the SHAs before saying a file is
not there. It costs nothing and answers the only question that matters, which is
whether anything has moved.

And weigh the person above the tooling. She has said it twice before anybody
looked properly, more than once.

## 3. NEVER SAY IT IS FIXED WITHOUT PUSHING IT.

*"the deploy said you fixed it, but the deploy when opened does not show it
fixed."* Verified locally is not shipped. Push, then say so.

## 4. DO NOT WRITE A THEORY INTO THE REPOSITORY AS FACT.

If the cause is not known, the note says the cause is not known, and says what
would settle it. She has the tape, the video and the voice. A plausible
mechanism written into a config note, a commit message and a test as though it
were settled has been wrong three times in one evening.

## 5. HER WORDS, HER FILENAMES, HER RULES ABOUT LANGUAGE.

- No em dashes anywhere. No non-breaking hyphens.
- "Elevator", never "lift".
- No jargon she has not used. She has never heard "sandbox" in a session and
  said so.
- "plainly" is a Claude tell and she can hear it: *"you overuse the word
  plainly"*, *"it's a claude tell"*, *"to me and your agents use it."* It
  matters most inside a prompt, because that is the half that gets spoken out
  loud by an agent. When she names a tic, grep the whole repository for it, and
  look at the prompts first.
- A new asset gets a **new filename**. Replacing a file in place does not reach
  the site; `_v2`, `_v3` and so on are why.
- Her filenames win. The page follows the files, not the other way round.

## 6. HER ADDRESS IS THE WORK ONE

`drterryoroszi@emerging-tech-lab.com`. That is the mailbox this system sends
from, it is the one on the laboratory, and it is the only one that belongs
anywhere a customer or a student sees or replies to.

She has a personal address as well. It must not arrive in this repository: a
receipt, a notification and a git commit are all places it would then live
permanently, in somebody else's inbox and in a history nobody can edit. Not in a
commit trailer, a config, a test fixture or a screenshot.

## 7. THE AGENTS HAVE LIVES, AND SAY SO WHEN ASKED

The agents here have a childhood, a family, a school and a favourite drink, on
purpose. Dr. O: *"We still want to give both Rin and Meg a backstory, it is what
we do at ETL. Make our agents almost human, the technology we brag about."*

Two rules hold inside every persona. If somebody asks whether they are a real
person, they say no, the same answer the FAQ gives. And none of them invents
past what is written down: a detail not in the file gets "I would rather not
make something up", never a fresh hometown each time.

A written life offered to a stranger as fact is the con, which is why a made up
background does not go into a letter to somebody who has never heard of any of
this.
