#!/bin/bash
set -euo pipefail
release=/opt/oxeio-releases/screenshots-filters-20260930
repo=/opt/oxeio
cd "$repo"
test "$(git rev-parse HEAD)" = d9f312e11d460ff12cc723227487fd86d3d44496
test "$(cat .git/oxeio-deployed-commit)" = d9f312e11d460ff12cc723227487fd86d3d44496
test -z "$(git diff --name-only)"
install -m 644 "$release/README.md" README.md
install -m 644 "$release/current-state.md" docs/current-state.md
for name in 2026-09-30-screenshots-filters.md screenshots-filter-files.txt screenshots-filter-local-sha256.txt screenshots-filters-preview.png; do
  install -m 644 "$release/$name" "docs/audits/$name"
done
git add README.md docs/current-state.md docs/audits/2026-09-30-screenshots-filters.md docs/audits/screenshots-filter-files.txt docs/audits/screenshots-filter-local-sha256.txt docs/audits/screenshots-filters-preview.png
git diff --cached --check
git -c user.name=Codex -c user.email=codex@local commit -m 'Document screenshot gallery filters' > "$release/docs-commit.log"
git rev-parse HEAD > "$release/docs-commit.txt"
git bundle create "$release/source-with-docs.bundle" HEAD
for name in README.md current-state.md 2026-09-30-screenshots-filters.md screenshots-filter-files.txt screenshots-filter-local-sha256.txt screenshots-filters-preview.png; do
  case "$name" in
    README.md) target="$repo/README.md" ;;
    current-state.md) target="$repo/docs/current-state.md" ;;
    *) target="$repo/docs/audits/$name" ;;
  esac
  test "$(sha256sum "$release/$name" | cut -d' ' -f1)" = "$(sha256sum "$target" | cut -d' ' -f1)"
done
printf 'SCREENSHOTS_FILTERS_DOCS_PUBLISHED %s\n' "$(cat "$release/docs-commit.txt")"
sha256sum "$repo/docs/current-state.md"
