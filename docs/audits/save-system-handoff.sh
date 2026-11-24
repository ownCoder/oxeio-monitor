#!/bin/bash
set -euo pipefail
release=/opt/oxeio-releases/system-improvements-20260928
cd /opt/oxeio
test "$(git rev-parse --short HEAD)" = cc34a36
git diff --quiet && git diff --cached --quiet
tar -xf "$release/system-improvements-docs.tar"
files=(README.md docs/current-state.md docs/design-pool-operations.md docs/audits/2026-09-28-system-improvements.md docs/audits/system-source-alignment.json docs/audits/restore-latest-backup.json docs/audits/restore-offsite-backup.json docs/audits/payroll-reconciliation-summary.json docs/audits/system-public-bundle.txt docs/audits/system-skip-report-422.png docs/audits/system-design-history-421.png docs/audits/system-external-monitors.png docs/audits/deploy-system-improvements.sh docs/audits/deploy-monitor-readiness.sh docs/audits/verify-system-release.sh docs/audits/reconcile-payroll.cjs docs/audits/reconcile-payroll.sh docs/audits/restore-current-system.sh docs/audits/verify-current-offsite.sh docs/audits/verified-restore-tool.sh docs/audits/upload-current-offsite-pending-approval.sh docs/audits/daily-offsite-pending-approval.timer)
git add -- "${files[@]}"
git -c core.whitespace=cr-at-eol diff --cached --check
git -c user.name=Codex -c user.email=codex@local commit -m 'docs: record system improvements, recovery proof and pending physical acceptance'
git bundle create "$release/source-with-docs.bundle" HEAD
git archive HEAD | gzip > "$release/source-with-docs.tar.gz"
sha256sum docs/current-state.md docs/audits/2026-09-28-system-improvements.md
printf 'App marker: '; cat .git/oxeio-deployed-commit
git log -3 --oneline
git status --short
