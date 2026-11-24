#!/bin/bash
set -euo pipefail
release=/opt/oxeio-releases/salary-20260930
repo=/opt/oxeio
cd "$repo"
test "$(git rev-parse HEAD)" = dd0613ae5525bf7cabafc2728712bbac1b8a31a4
test "$(cat .git/oxeio-deployed-commit)" = 3422cb7ea355b2903ac63ec3b87258da05bb349f
test -z "$(git diff --name-only)"
install -m 644 "$release/current-state.md" docs/current-state.md
git add docs/current-state.md
git diff --cached --check
git -c user.name=Codex -c user.email=codex@local commit -m 'List latest applied salary and inbox migrations in handoff' > "$release/handoff-commit.log"
git rev-parse HEAD > "$release/handoff-commit.txt"
git bundle create "$release/source-with-docs.bundle" HEAD
test "$(sha256sum "$release/current-state.md" | cut -d' ' -f1)" = "$(sha256sum docs/current-state.md | cut -d' ' -f1)"
printf 'SALARY_HANDOFF_FINALIZED %s\n' "$(cat "$release/handoff-commit.txt")"
sha256sum docs/current-state.md
