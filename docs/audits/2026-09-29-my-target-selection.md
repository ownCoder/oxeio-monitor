# My Data: selected design ও number ordering

Deployed: 29 September 2026 · application **424 / e327e29**.

## ব্যবহার

- My Data → Your Design Targets-এ row অথবা তার design link click করলে border/tint ও `✓ Selected` থাকে। পরের row click করলে selection সেখানে যায়। Row focus করে Enter/Space দিয়েও select করা যায়।
- একই browser/account-এ refresh-এর পর selection ফিরে আসে। Browser storage unavailable হলে current page-এ selection কাজ করে। অন্য PC-তে এই selection sync হয় না।
- প্রতিটি workflow section-এর designs job number অনুযায়ী ছোট থেকে বড় সাজানো; number না থাকলে শেষে। Open all একই ordering অনুসরণ করে।
- Selection শুধু দেখার সুবিধা; Complete, Skip, review policy বা assignment/status বদলায় না।

## যাচাই

- Clean VPS source থেকে scoped three-file release; frontend production build/typecheck, targeted lint ও **285 tests / 13 suites** passed। Three new tests cover numeric ordering/input immutability, account-scoped persistence and unavailable storage. Main local frontend typecheck also passed.
- Chrome-এ actual component-এর synthetic preview: unsorted numbers sorted, design-link click selected, reload retained selection, another click moved selection, keyboard selection worked। [Preview screenshot](my-target-selection-preview.png)। Production designer login দিয়ে action করা হয়নি।
- Public `/api/v1/health`: build 424, commit e327e29, database up। API/web/PostgreSQL healthy; PostgreSQL container unchanged। No migration or seed.
- Public JavaScript `/assets/index-BdaET17z.js` matches container SHA256 `f330bcaa3044c982fd8f6f4e4b74e5bc0755b032560e7e6cc48e4205118dd644`.

## Source ও recovery

- VPS `/opt/oxeio`; deployed marker `/opt/oxeio/.git/oxeio-deployed-commit`। Docs-only commits may advance HEAD without changing app version.
- Release evidence, encrypted pre-release backup and source bundle: `/opt/oxeio-releases/my-target-selection-20260929`। Backup parsed successfully in an isolated container.
- Rollback images (422): `oxeio-api:before-my-target-selection-20260929`, `oxeio-web:before-my-target-selection-20260929`। Use both compose files: `docker-compose.yml` and `docker-compose.vps.yml`.
- Local clean release mirror `.release-my-targets`। Main checkout retains unrelated unreleased Production changes, including History & review links; never deploy the entire dirty checkout.
- Shared handoff `/opt/oxeio/docs/current-state.md`; docs checked against local copies. No GitHub push or automatic other-PC sync claimed.
- Previous physical-PC acceptance, monitor-email receipt and specific offsite-upload approval remain pending; see [previous record](2026-09-28-system-improvements.md).
