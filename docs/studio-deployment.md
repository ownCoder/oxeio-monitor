> **Current release — 26 September 2026, 17:25 UTC:** round 2 audit fixes are live in web
> and API build **409 / 1081b09**, and the matching source is present on the VPS.
> All services are healthy; the prior version mismatch is resolved.
> [Final validation and rollback details](audits/2026-09-26-round2-fixes.md).

> **Follow-up — 26 September 2026:** the system audit fixes and matched source/API/web
> deployment are tracked in [the repair ledger](audits/2026-09-26-fix-tracker.md).
> Release notes below describe the preceding Studio-only deployments.

# Studio production deployment — 26 September 2026

Deployed to https://hub.oxeio.com at 15:17 UTC.

- Frontend: build 405, source commit `16f7aa7`.
- API: build 404, commit `a763b1c`; API and database containers were not recreated.
- Production web, API and PostgreSQL containers verified healthy.
- Served HTML points to `index-DpX9-Uk3.js`; JS, CSS and service worker were
  downloaded over HTTPS and matched byte-for-byte against the release.
- Browser verification reached the real sign-in page with web #405 / 16f7aa7.
  An authenticated production dashboard session was not available for inspection.

## Direct release and source synchronization

Automatic approval review rejected GitHub `main` push because that publication
was not explicitly authorized. No GitHub push was performed. The user's requested
VPS deployment instead used the verified production assets directly.

The VPS checkout and GitHub remain at `a763b1c`. Before any later source-based web
rebuild, synchronize the approved Studio commit; otherwise that rebuild would
restore the old dashboard. The frontend-only deployment deliberately leaves the
existing version badge's web/API mismatch warning visible.

Release directory: `/opt/oxeio-releases/studio-16f7aa7`

Release image: `oxeio-web:studio-16f7aa7`, also tagged `oxeio-web:latest`.
Rollback image: `oxeio-web:before-studio-16f7aa7`.

Only web assets were overlaid on the existing Caddy image; the Caddy configuration,
certificates and routing were preserved. Old hashed assets remain available for
already-open browser tabs. Previous `/srv` content is also in the release directory.

## Rollback

```bash
cd /opt/oxeio/oxeio-monitor
docker tag oxeio-web:before-studio-16f7aa7 oxeio-web:latest
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --no-deps --no-build web
```

Archive SHA-256: `16a78140ff9675f70ff0dbb8ce8ce76a38c2b73217a003e5c99fc97f66de2a76`.

## Dashboard information restoration — 26 September 2026, 15:28 UTC

Build 406, commit `3adb378`, is deployed at https://hub.oxeio.com.
Release: `/opt/oxeio-releases/studio-3adb378`.
Image: `oxeio-web:studio-3adb378` (also latest).
Rollback to the preceding Studio build: `oxeio-web:before-studio-3adb378`.
Archive SHA-256: `131459fabe7e12516a2d566689eb97dd707e1fbba338c5102bf403809ce89c8e`.

Served index, JS, CSS and service worker match the release. Web, API and DB
are healthy. API and DB containers were not recreated. API remains build 404;
the version mismatch indicator remains. GitHub and VPS source are still a763b1c;
do not rebuild from that checkout before syncing the local committed source.
Authenticated dashboard layout was verified using isolated sample data, not a
live user session. No fixture code was included in the deployed archive.
