# Add design targets — three stages

28 September 2026 · release **416 / 95141ab**.

Owner requested removal of **Uploaded** and **Live on Amazon** from Add design targets. The Pipeline now shows **In the pool**, **In hand**, and **Designed**, in three columns on larger screens. Its hint now says “From collected link to a finished design”. Design Pool production actions and server data are unchanged. Automatic morning distribution and Add Links remain available.

Scoped change: `oxeio-monitor/web/src/pages/TargetsPage.tsx`, based on current VPS source `1c99f2b`. The unrelated dirty local Production workspace was not included. No database migration or seed.

Validation: frontend production build (including TypeScript checking) and targeted ESLint on TargetsPage passed. Deployed at 11:53 Asia/Dhaka. Public HTTPS health reports **416 / 95141ab**, database up. Chrome shows matching web/API release, the three retained tiles, revised hint and Add Links form; Uploaded and Live on Amazon are absent. [Verified screenshot](add-target-three-stages-release416.png).

Release directory: `/opt/oxeio-releases/add-target-three-stages-20260928`; source bundle and health record included. Rollback images: `oxeio-api:before-three-stages-20260928` and `oxeio-web:before-three-stages-20260928` (release 414). PostgreSQL container identity retained.

Shared handoff: `/opt/oxeio/docs/current-state.md`. No GitHub push or automatic PC sync included.
