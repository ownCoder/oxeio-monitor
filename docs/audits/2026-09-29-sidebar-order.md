# Sidebar: Office ও Production নিচে

Application release **430 / 689966c** · 29 September 2026.

- Sidebar-এর Office এবং Production links শুরু থেকে সরিয়ে শেষে রাখা হয়েছে। Owner/manager-এর order: Settings → Office → Production। অন্য roles-এর existing visibility filtering একই থাকে।
- শুধু `web/src/components/Layout.tsx`-এর দুটি item স্থানান্তর করা হয়েছে; routes, permissions এবং workflow অপরিবর্তিত।
- Clean VPS-aligned source-এর targeted lint/typecheck এবং production build passed। Main local typecheck/lint passed। Navigation source যাচাইয়ে দুটো item একবার করে, সঠিক ক্রমে আছে। এই release-এ authenticated browser UI test করা হয়নি।
- Public HTTPS health-এ build/commit এবং database up যাচাই; API/web healthy, PostgreSQL container অপরিবর্তিত। No migration/seed.
- VPS source `/opt/oxeio`; release evidence `/opt/oxeio-releases/sidebar-order-20260929`। Rollback images: `oxeio-api:before-sidebar-order-20260929` এবং `oxeio-web:before-sidebar-order-20260929` (application 428)। Both compose files required.
- Shared handoff `docs/current-state.md` VPS copy-এর সঙ্গে hash যাচাই করা হয়েছে। GitHub push/automatic other-PC sync করা হয়নি। আগের physical-PC, monitor-email এবং offsite acceptance pending থাকে।
