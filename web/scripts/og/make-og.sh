#!/bin/sh
# Renders scripts/og/card.html to the social preview images every page links to (lib/seo.ts):
#   public/og/opengraph.png  1200×630 (Open Graph: Facebook, LinkedIn, Slack, iMessage…)
#   public/og/twitter.png     1200×600 (X summary_large_image)
# and scripts/og/icons-card.html to the cards of the pixel icon pages (/icons and /icons/library), in the same sizes:
#   public/og/icons-opengraph.png, icons-twitter.png, icons-library-opengraph.png, icons-library-twitter.png
# Needs Chrome or Chromium, on any system; the card brings its own typeface, so no network and no installed fonts
# are needed. Run from web/: sh scripts/og/make-og.sh
# CHROME names the browser to use (CHROME=/path/to/chromium sh scripts/og/make-og.sh); otherwise the first one found.
# Bump CARD_VERSION in src/lib/seo.ts afterwards.
set -eu
cd "$(dirname "$0")/../.."

if [ -z "${CHROME:-}" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium" \
           google-chrome google-chrome-stable chromium chromium-browser chrome; do
    if [ -x "$c" ]; then CHROME=$c; break; fi
    if command -v "$c" >/dev/null 2>&1; then CHROME=$(command -v "$c"); break; fi
  done
fi
if [ -z "${CHROME:-}" ]; then
  echo "No Chrome or Chromium found. Set CHROME to its program, e.g. CHROME=/usr/bin/chromium" >&2
  exit 1
fi

OG="file://$PWD/scripts/og"
# Chromium refuses to start its sandbox as root (containers, CI); the page is this repository's own file.
SANDBOX=""
if [ "$(id -u)" = 0 ]; then SANDBOX="--no-sandbox"; fi
# Own profile folder, removed afterwards: nothing is shared with the person's browser.
PROFILE=$(mktemp -d)
trap 'rm -rf "$PROFILE"' EXIT

shot() { # height, output, card page (with its query)
  rm -f "$2"
  # shellcheck disable=SC2086
  "$CHROME" --headless=new $SANDBOX --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --allow-file-access-from-files --virtual-time-budget=8000 --user-data-dir="$PROFILE" \
    --window-size="1200,$1" --screenshot="$2" "$OG/$3" >/dev/null 2>&1 || true
  if [ ! -s "$2" ]; then
    echo "$CHROME did not write $2" >&2
    exit 1
  fi
  echo "wrote $2"
}

shot 630 public/og/opengraph.png "card.html?h=630"
shot 600 public/og/twitter.png "card.html?h=600"
shot 630 public/og/icons-opengraph.png "icons-card.html?h=630"
shot 600 public/og/icons-twitter.png "icons-card.html?h=600"
shot 630 public/og/icons-library-opengraph.png "icons-card.html?page=library&h=630"
shot 600 public/og/icons-library-twitter.png "icons-card.html?page=library&h=600"
