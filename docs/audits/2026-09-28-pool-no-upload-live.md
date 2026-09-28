# Design Pool — remove upload/live controls

28 September 2026 · release **418 / e559b45**.

Following the owner's request, Design Pool no longer shows **To upload**, **To make live**, or **Uploaded/Live** row actions, including expanded **More actions**. Completion-date helper text now focuses on completion time. Check/fix, complete/undo, skip/review, deletion, filters, CSV and search remain available. Shared Review rows also no longer offer upload/live actions.

The frontend's unused `markUploaded` and `markLive` helpers were removed. Stored upload/live timestamps, backend endpoints and guards were retained; this is a UI change, with no migration, seed or production data updates. Source based on VPS HEAD `1ccec83`, excluding the unrelated dirty local Production workspace.

Validation: frontend build/typecheck and targeted ESLint passed; all 279 frontend tests passed (11 files). Two API-helper caller checks disappeared with the two removed exports, explaining the decrease from 281. No new tests were added for the UI-only removal.

Deployed at 12:02 Asia/Dhaka. Public HTTPS health reports **418 / e559b45**, database up; matching web/API versions visible in Chrome. Live checks confirm To check/To fix remain, upload/live queues are absent, and opening More actions shows no Uploaded/Live buttons. No production target was mutated. [Verified screenshot](design-pool-no-upload-live-release418.png).

Release directory: `/opt/oxeio-releases/design-pool-no-upload-live-20260928`, with source bundle and health record. Rollback images: `oxeio-api:before-pool-no-upload-live-20260928`, `oxeio-web:before-pool-no-upload-live-20260928` (release 416).

Shared handoff: `/opt/oxeio/docs/current-state.md`. No GitHub push or automatic PC sync included.
