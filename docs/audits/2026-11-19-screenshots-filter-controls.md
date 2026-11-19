# Screenshots active-filter controls — 19 November 2026

Web release **534 / `c14bd136b1c3c00620244130812b5549753d8e73`** is live at `https://hub.oxeio.com`.

## Delivered

- Screenshots now shows every applied non-default date, staff, Dhaka time band, app and monitor condition as a labelled removable chip.
- The row includes the exact active-filter count and **Reset all**. Removing a chip resets only that condition and returns pagination/lightbox state safely.
- A single non-today date is now correctly treated as an active filter for empty-state guidance; the screenshot query, role scope and data access rules are unchanged.

## Checks and release evidence

- Exact VPS-exported build-532 source was used; only `web/src/pages/GalleryPage.tsx` changed.
- Local and staged VPS typecheck/lint passed. The staged production build passed all **310/310** existing frontend tests across 16 suites.
- Live web is healthy. Public `index-Ddx2vbD3.js` is byte-identical to the deployed container (`0373583a...eb0d5`). Anonymous `GET /api/v1/screenshots` returns **401**.
- API container `ec9780...1d1` and PostgreSQL container `cab5ab...2821` are unchanged. No migration, database write or production test data was used.
- Rollback image: `oxeio-web:before-screenshots-controls-20261119`. Release evidence/source: `/opt/oxeio-releases/screenshots-controls-20261119`.
- Root disk was **93% used with 5.5 GiB free** after the build. Disposable validation images may be removed after documentation sync; retained rollback images/data were not deleted.

D05 remains `in_progress`; the next cohesive slice is consistent controls for appropriate report tables.
