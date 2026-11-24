# Remove manual distribution from Add design targets

27 September 2026 — requested page change.

Removed the **Distribute now** button, its page-level request handler, permission check and mutation state from `oxeio-monitor/web/src/pages/TargetsPage.tsx`. The page now submits links with **Add to pool** and shows the existing daily 08:00 automatic distribution notice.

This UI change preserves the backend distribution schedule and the skip-review controls introduced in release 411.

Validation: local TypeScript check and targeted ESLint passed. Production frontend build passed. Release source: `b317bd9`.

Deployed as release **412 / b317bd9**. Public HTTPS health matches the commit; served HTML loads `index-G1Uq8_G2.js`. The served bundle matches the container SHA-256, contains Add to pool and the automatic distribution notice, and no longer contains Distribute now. No database migration was needed.
