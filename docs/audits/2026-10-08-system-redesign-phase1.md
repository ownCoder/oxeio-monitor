# Full-system redesign · phase 1 · 8 October 2026

The owner approved `docs/mockups/full-system-redesign.html` and asked to begin implementation. Release **468** (`f5dbc7de60c15e646a84b4244b3a647b0af24c1b`) is live at https://hub.oxeio.com. This is the first implementation phase; the rest of the mockup is not yet implemented.

## What changed

- Shared application shell: mockup-based blue sidebar, clearer section labels and icons, top bar, and a mobile navigation drawer. Existing role-based visibility and routes remain in place. `/targets` now matches its own navigation item exactly, avoiding two active Target links.
- Live Board: primary KPI cards, a 7-day completed-design chart, current attention links, and the team snapshot are arranged like the approved mockup. Existing operational detail stays below the new overview. These widgets use existing live APIs, including owner-only alerts.
- UI-only release. No API schema, database migration, seed, staff record, target assignment, or permission change.

## Validation and rollout

- Local web `typecheck`, `lint`, production `build` passed; Vitest **296/296** passed.
- VPS staged exactly `web/src/components/Layout.tsx`, `web/src/pages/LiveBoardPage.tsx`, and `web/src/system-redesign.css`. Previous API/web images were tagged for rollback in `/opt/oxeio-releases/system-redesign-phase1-20261008`; deployed-commit marker moved from release 465 to release 468 only after health checks.
- Live web/API containers healthy; PostgreSQL container ID unchanged. Public health returned build 468 and commit `f5dbc7d`. Public JS hash matched the web container, and anonymous Daily designs API request returned 401.
- Chrome owner session: Live Board data and chart rendered; Add target page displayed only its own active nav item. Live Board tab left open for review.

## Next implementation work

Adapt the remaining page bodies in the mockup in practical groups: Worklog and Targets; Team and Oversight; then Office and Production. Keep the existing business rules, permissions and real API data. Verify each group visually and with frontend checks before rollout.
