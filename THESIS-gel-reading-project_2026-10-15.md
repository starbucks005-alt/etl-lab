# Thesis Project Opportunity: Teaching AI to Read Electrophoresis Gels (in this case my AI robot)

Emerging Technologies Laboratory, Dr. Terry Oroszi

Written by Dr. O, 2026-10-15, to be sent to the new thesis students by the assistant director. This is her wording. Elle's short version of it is `THESIS_TEXT` in `al-panel/pi/al_panel_server.py`.

## The idea

Every molecular biology lab runs gels, and almost every gel is read by eye or by software that needs a person to correct it. This project asks a simple question: how well can modern AI vision tools read gels, and where do they fail? You would build and test a way of reading gels, starting with simple one-dimensional DNA gels and moving up to two-dimensional protein gels, and measure the results against answers we already know.

## Research question (draft, you will refine it)

How accurately can an AI vision model, a classical image-analysis pipeline, or a combination of the two identify and measure bands (1D gels) and spots (2D gels), compared with trusted software and expert reading?

## Why this makes a good thesis

- It has an answer key. DNA ladders give known band sizes, so accuracy can be measured, not guessed.
- It builds in steps. 1D first, then 2D, so there is a finished result even if 2D turns out harder than expected.
- Any result is useful. If AI reads gels well, that is a tool. If it fails in specific ways, that is a publishable finding about where not to trust it.
- Real data is available: Dr. O's own gels from past lab work, plus 2D gels from other labs in the department.

## The five semesters

| Semester | What you do |
|---|---|
| 1 | Read and learn. Run a literature review on gel analysis and AI image reading. Write a draft of the background chapters. |
| 2 | 1D DNA gels. Build and test your reading methods against ladders and known results. |
| 3 | 2D gels. Spot detection, alignment between gels, and quantification. Compare with commercial software if the department has it. |
| 4 | Write up results. |
| 5 | Finish and defend. |

This is a full thesis.

## Thesis chapter map

1. Introduction
2. Background
3. Methods
4. 1D gel results
5. 2D gel results
6. Discussion
7. Conclusions

## Minimum scope and stretch scope

- **Minimum:** a complete, well-tested method for 1D gels, plus a first honest attempt at 2D with its limits clearly described.
- **Stretch:** a working 2D pipeline, a comparison with commercial software, and a short study of how well other students can use the tool.

## This semester, no commitment needed

If you are in rotations, you can start now. We will use SLR Studio, the literature review platform I designed. It helps find papers, map what has and has not been studied, and track the review in the PRISMA format. The faculty side of SLR Studio is used to scope the project and find the gaps. You use the student side to run your own review. Every word you write is yours.

## What you will learn

- How gels really work and where reading errors come from
- Image analysis and basic Python (you do not need to know it yet)
- How to test an AI tool honestly
- A full systematic literature review
- Writing and defending a complete thesis

## What we ask of you

- Real interest in electrophoresis, image analysis, or AI in the lab
- Willingness to learn some Python
- Open every source you cite and check that it says what you claim
- Keep a log of which AI tools you used and how, so you can disclose it
- Record the AI model name, version, and date for every test
- Use original scan files, not phone photos, which shrink the image and lose detail
- Ask before using any gel from another lab or from human samples, so permissions are settled first

## What you get

A thesis with real data, a poster or presentation, a good chance at a publication, and a project that shows you can combine wet lab work, data, and AI.

## Interested?

Reply to Catherine and me (drterryoroszi@emerging-tech-lab.com), and we will set up a meeting.
