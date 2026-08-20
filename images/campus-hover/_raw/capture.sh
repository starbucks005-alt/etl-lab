#!/bin/bash
# Captures a real live screenshot per campus platform for the homepage hover cards.
# Run once; re-run individual lines if a site changes its above-the-fold look.
set -u
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
OUT="/c/Users/w001txo/Desktop/ETL Lab/etl-lab-push/images/campus-hover/_raw"

declare -a ENTRIES=(
  "founder-studio|https://emerging-tech-lab.com/founder-studio.html"
  "the-gauntlet|https://thegauntlet.studio/"
  "the-prep-room|https://emerging-tech-lab.com/prep-room"
  "everly-castle|https://emerging-tech-lab.com/everly-castle"
  "the-dose|https://thedose.net/"
  "etl-newswire|https://emerging-tech-lab.com/press"
  "the-boardroom|https://emerging-tech-lab.com/boardroom"
  "almost-human|https://emerging-tech-lab.com/almost-human"
  "good-company|https://emerging-tech-lab.com/good-company/"
  "greylander-press|https://greylanderpress.com/"
  "the-gym|https://emerging-tech-lab.com/gym"
  "city-government|https://emerging-tech-lab.com/city-government"
  "the-court-of-judge-roz|https://emerging-tech-lab.com/court"
  "gandhi-king-center|https://gandhi-king-center-for-nonviolence.org/"
  "intel-dashboard|https://inteldashboard.org/"
  "slr-studio|https://slrstudio.online/"
  "office-hours|https://emerging-tech-lab.com/office-hours"
  "etl-deskworks-dayton|https://emerging-tech-lab.com/deskworks"
  "build-your-own-agent|https://emerging-tech-lab.com/build-your-own-agent"
  "take-it-with-you|https://emerging-tech-lab.com/export-your-agent"
  "chris-s-tailor-shop|https://emerging-tech-lab.com/tailor-shop"
  "etl-design|https://emerging-tech-lab.com/etl-design"
  "etl-messenger|https://emerging-tech-lab.com/hiring-pool"
  "the-harvest-circuit|https://emerging-tech-lab.com/restaurant"
  "etl-classrooms|https://emerging-tech-lab.com/classrooms"
  "opsec-gauntlet|https://opsec-gauntlet.com/"
  "m-e-my-echo|https://my-echo.me/"
)

for entry in "${ENTRIES[@]}"; do
  slug="${entry%%|*}"
  url="${entry##*|}"
  echo "=== $slug  ($url) ==="
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --disable-extensions \
    --window-size=1280,800 --screenshot="$OUT/$slug.png" "$url" 2>&1 | tail -3
  if [ -s "$OUT/$slug.png" ]; then
    echo "  ok: $(du -h "$OUT/$slug.png" | cut -f1)"
  else
    echo "  FAILED: $slug"
  fi
done
echo "DONE"
