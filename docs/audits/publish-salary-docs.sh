#!/bin/bash
set -euo pipefail
release=/opt/oxeio-releases/salary-20260930
repo=/opt/oxeio
cd "$repo"
test "$(git rev-parse HEAD)" = 3422cb7ea355b2903ac63ec3b87258da05bb349f
test "$(cat .git/oxeio-deployed-commit)" = 3422cb7ea355b2903ac63ec3b87258da05bb349f
test -z "$(git diff --name-only)"
test -z "$(git diff --cached --name-only)"
install -m 644 "$release/README.md" README.md
install -m 644 "$release/current-state.md" docs/current-state.md
install -m 644 "$release/salary-operations.md" docs/salary-operations.md
for name in 2026-09-30-salary-tracking.md salary-source-files.txt salary-local-sha256.txt salary-preview.png; do
  install -m 644 "$release/$name" "docs/audits/$name"
done
git add README.md docs/current-state.md docs/salary-operations.md \
  docs/audits/2026-09-30-salary-tracking.md docs/audits/salary-source-files.txt \
  docs/audits/salary-local-sha256.txt docs/audits/salary-preview.png
git diff --cached --check
git -c user.name=Codex -c user.email=codex@local commit -m 'Document salary payment tracking' > "$release/docs-commit.log"
git rev-parse HEAD > "$release/docs-commit.txt"
git bundle create "$release/source-with-docs.bundle" HEAD
for name in README.md current-state.md salary-operations.md 2026-09-30-salary-tracking.md salary-source-files.txt salary-local-sha256.txt salary-preview.png; do
  case "$name" in
    README.md) target="$repo/README.md" ;;
    current-state.md|salary-operations.md) target="$repo/docs/$name" ;;
    *) target="$repo/docs/audits/$name" ;;
  esac
  test "$(sha256sum "$release/$name" | cut -d' ' -f1)" = "$(sha256sum "$target" | cut -d' ' -f1)"
done
printf 'SALARY_DOCS_PUBLISHED %s\n' "$(cat "$release/docs-commit.txt")"
sha256sum "$repo/docs/current-state.md"
