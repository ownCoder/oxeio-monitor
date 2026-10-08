# Daily designs & skips redesign — 8 October 2026

Owner-approved mockup: `docs/mockups/daily-designs-redesign.html`. Live route: `https://hub.oxeio.com/targets/daily`.

The page now uses the mockup's six KPI cards, daily completion/skip chart, attention panel, compact daily table with expandable four-reason details, search/staff filters and separate Skip analysis tab. All numbers come from the existing daily and skip-insights APIs. The chart shows the last seven days in a longer selected period. Existing definitions remain visible, including unavailable pre-ledger skip data and the cohort-rate denominator. The site's existing navigation/header are retained.

Source: `.release-salary/oxeio-monitor/web/src/pages/DailyDesignPage.tsx`, `web/src/pages/targets/DailyDesignDashboard.tsx` and `daily-design-dashboard.css`. No backend, schema, migration or seed change. Deployed VPS app commit `92f3283ed55bd9feb1196109e556426d093e701c` (build 465). Staged archive, deployment script, build and public verification are under `/opt/oxeio-releases/daily-dashboard-20261008`.

Local frontend typecheck and lint passed; production build passed after allowing Vite/esbuild child processes; 296/296 frontend tests passed. VPS deployed only the three scoped source files, rebuilt API/web to keep build markers consistent, and left PostgreSQL container ID unchanged. API/web were healthy; public health reported build 465 and commit `92f3283`; anonymous daily report returned 401; public JS SHA-256 matched the web container. In authenticated Chrome owner view, the live page loaded real data and the Skip analysis tab opened successfully. The mockup's sample figures were not deployed.
