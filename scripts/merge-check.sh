#!/usr/bin/env bash
# Reports which files would conflict if BRANCH were merged into the current branch (or BASE).
# Works in a throwaway worktree, so the working tree and the index are never touched.
#   scripts/merge-check.sh <branch> [base-ref]      e.g. scripts/merge-check.sh worktree-agent-ad2f35b239fb3fcf3
# Exit code: 0 clean merge, 1 conflicts, 2 usage/error.
set -u
branch="${1:-}"
base="${2:-HEAD}"
if [ -z "$branch" ]; then echo "usage: $0 <branch> [base-ref]" >&2; exit 2; fi
git rev-parse --verify -q "$branch^{commit}" >/dev/null || { echo "unknown ref: $branch" >&2; exit 2; }
git rev-parse --verify -q "$base^{commit}" >/dev/null || { echo "unknown ref: $base" >&2; exit 2; }

tmp="$(mktemp -d "${TMPDIR:-/tmp}/merge-check.XXXXXX")"
cleanup() { git worktree remove --force "$tmp/wt" >/dev/null 2>&1; rm -rf "$tmp"; }
trap cleanup EXIT

git worktree add --detach -q "$tmp/wt" "$base" || exit 2
cd "$tmp/wt" || exit 2

mb="$(git merge-base "$base" "$branch" 2>/dev/null || true)"
echo "base:   $(git -C "$tmp/wt" rev-parse --short "$base") ($base)"
echo "branch: $(git rev-parse --short "$branch") ($branch)   merge-base: ${mb:0:8}"
echo "branch is $(git rev-list --count "$base..$branch") commit(s) ahead, $(git rev-list --count "$branch..$base") behind"

out="$(git merge --no-commit --no-ff "$branch" 2>&1)"
rc=$?
conflicts="$(git diff --name-only --diff-filter=U)"
if [ $rc -eq 0 ]; then
  echo "RESULT: clean merge"
  echo "files changed by branch: $(git diff --cached --name-only | wc -l)"
  status=0
else
  echo "RESULT: CONFLICTS in $(echo "$conflicts" | grep -c .) file(s)"
  for f in $conflicts; do
    n="$(grep -c '^<<<<<<<' "$f" 2>/dev/null || echo '?')"
    echo "  $f  ($n hunk(s))"
  done
  status=1
fi
# Files both sides touched since the merge-base: likely semantic conflicts even if git merged them.
if [ -n "$mb" ]; then
  both="$(comm -12 <(git diff --name-only "$mb" "$base" | sort) <(git diff --name-only "$mb" "$branch" | sort))"
  echo "touched on both sides ($(echo "$both" | grep -c .)):"
  [ -n "$both" ] && echo "$both" | sed 's/^/  /'
fi
git merge --abort >/dev/null 2>&1
[ $status -ne 0 ] && echo "$out" | grep -i "^CONFLICT" | sed 's/^/  git: /'
exit $status
