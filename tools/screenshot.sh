#!/usr/bin/env bash
# Headless screenshot of the site via Windows Chrome (WSL interop).
# Usage: tools/screenshot.sh <out.png> [query-string] [virtual_time_ms] [WxH] [scrollY]
#   e.g. tools/screenshot.sh /tmp/x/frame.png "t=3.5&pause=1" 6000 1280x800 0
# The site is served from the project root on http://127.0.0.1:8765 (server auto-started).
# Viewports narrower than 500 px (Chrome's minimum window width) and any scrollY > 0 are captured
# through tools/viewport-test.html, which embeds index.html in an iframe of the exact size: the iframe
# scrolls internally, so the fixed background and the scrolled content are captured together (a direct
# --screenshot with a scrolled window comes back all black / displaced). The outer window is padded
# to >= 500 px wide in that case; the extra strip on the right is #222 and not part of the page.
set -euo pipefail
OUT="$1"; QS="${2:-}"; BUDGET="${3:-1500}"; SIZE="${4:-1280x800}"; SCROLL="${5:-0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT=8765
if ! curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then
  # Fully detached (own session, no inherited fds): otherwise the script waits on the server at exit
  # and a pipeline such as `screenshot.sh ... | cut` never finishes.
  (cd "$ROOT" && setsid nohup python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1 </dev/null &)
  for i in $(seq 1 20); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.25; done
fi
CHROME="/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"
WT=$(cmd.exe /c "echo %TEMP%" 2>/dev/null | tr -d '\r')
WTL=$(wslpath -u "$WT"); mkdir -p "$WTL/hsrgshots"
NAME="shot_$$_$RANDOM.png"
W="${SIZE%x*}"; H="${SIZE#*x}"
WIN_W="$W"
if [ "$W" -lt 500 ] || [ "${SCROLL%.*}" -gt 0 ]; then
  URL="http://127.0.0.1:$PORT/tools/viewport-test.html?w=$W&h=$H&headless=1&scroll=$SCROLL"
  [ "$W" -lt 500 ] && WIN_W=500
else
  URL="http://127.0.0.1:$PORT/index.html?headless=1&scroll=$SCROLL"
fi
[ -n "$QS" ] && URL="$URL&$QS"
timeout 90 "$CHROME" --headless=new --disable-gpu --use-angle=swiftshader --enable-unsafe-swiftshader \
  --no-sandbox --hide-scrollbars --window-size="$WIN_W,$H" --virtual-time-budget="$BUDGET" \
  --screenshot="$WT\\hsrgshots\\$NAME" "$URL" >/dev/null 2>&1 || true
if [ -f "$WTL/hsrgshots/$NAME" ]; then
  mkdir -p "$(dirname "$OUT")"; cp "$WTL/hsrgshots/$NAME" "$OUT"; rm -f "$WTL/hsrgshots/$NAME"
  echo "wrote $OUT ($URL)"
else
  echo "screenshot FAILED for $URL" >&2; exit 1
fi
