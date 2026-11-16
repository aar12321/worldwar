#!/usr/bin/env bash
# Lists (and with --yes kills) orphaned vite / vitest / chromium / playwright processes older than N minutes.
#   scripts/kill-stale.sh [--min N] [--yes]        default N=30; prints only, kills only with --yes
# Never touches this script, its parents, or anything younger than N minutes.
set -u
min=30; yes=0
while [ $# -gt 0 ]; do
  case "$1" in
    --min) min="$2"; shift 2 ;;
    --yes) yes=1; shift ;;
    -h|--help) sed -n 2,5p "$0"; exit 0 ;;
    *) echo "unknown arg $1" >&2; exit 2 ;;
  esac
done
pat='node_modules/\.bin/vite|vitest|/vite/bin|chrome-headless-shell|/chrome-linux64/chrome|chromium|playwright'
me=$$
parents=" $me $PPID "
p=$PPID
for _ in 1 2 3 4 5 6; do p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"; [ -z "$p" ] || [ "$p" = 1 ] && break; parents="$parents$p "; done
found=0
while read -r pid etimes comm args; do
  case "$parents" in *" $pid "*) continue ;; esac
  echo "$args" | grep -qE "$pat" || continue
  echo "$args" | grep -q "kill-stale" && continue
  [ "$etimes" -ge $((min * 60)) ] || continue
  found=$((found + 1))
  printf '%6s pid %-7s age %4dm  %s\n' "" "$pid" $((etimes / 60)) "$(echo "$args" | cut -c1-140)"
  [ $yes -eq 1 ] && kill "$pid" 2>/dev/null
done < <(ps -eo pid=,etimes=,comm=,args= )
if [ $found -eq 0 ]; then echo "nothing older than ${min} min"; exit 0; fi
if [ $yes -eq 1 ]; then echo "sent SIGTERM to $found process(es); run again to confirm, kill -9 any survivors"; else echo "$found process(es) listed. Re-run with --yes to kill them."; fi
