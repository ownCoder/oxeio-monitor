# Docker, cleanup and daily storage snapshots — 12 November 2026

Release 523 (`d0454d575743314da594867f4dbcbcba0cc6569b`) delivers the second D03 slice.

## Live

- Owner-only storage card shows aggregate Docker image/container/volume/build-cache usage and reclaimable amounts.
- Last cache-cleanup result and timestamp are visible.
- A host systemd timer records one disk snapshot per UTC day and retains 31 samples.
- The API has no Docker socket. The root collector writes only aggregate JSON atomically as `root:1000` mode `0640`.
- The first baseline was recorded on 12 November; comparison starts after the next daily sample.

## Verification

- Server/web typecheck and lint passed; collector Python compiled.
- Disposable PostgreSQL suite 13/13 passed, including snapshot parsing, growth math, owner access, manager 403 and anonymous 401.
- Collector service result `success`, timer active, snapshot valid and permission checked.
- Public health build 523 / `d0454d5`, exact public asset, healthy API/web/PostgreSQL and unchanged PostgreSQL container verified.

## Remaining acceptance

After the next daily run, verify two distinct dated samples and the displayed delta. Then D03 can close; no destructive cleanup is required.

Evidence: `/opt/oxeio-releases/storage-dashboard-host-20261112`.
