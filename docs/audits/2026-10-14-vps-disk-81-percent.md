# VPS disk 81% — 14 October 2026

At approximately 18:02 Asia/Dhaka, `/dev/vda1` was 77G total, 62G used and 16G available (81%). Docker reported 103 images totaling 46.07GB, with 32.39GB reclaimable. About 50 `oxeio-api:before-*` rollback tags accumulated across repeated releases. The active API image ID matched `oxeio-api:latest`; API, web and PostgreSQL containers were healthy.

The daily `oxeio-docker-cache-prune.timer` remains enabled and active. Its 13 October run succeeded, reclaiming 0B. Current build cache is 1.335GB with 0B reclaimable. The timer only targets builder cache, not tagged release images. This explains why the alert returned after the 10 October cache cleanup reduced disk use to 47%.

Other measured storage: application `.data/storage` 7.7GB, `.data/backups` 687MB, PostgreSQL volume 301MB, system journal 410MB. No image, backup, volume or user data was deleted during this audit. The next cleanup should apply an explicit rollback-image retention rule, keeping the current image and recent rollback images before removing older tagged versions. The disk alert threshold is 80%; while usage remains above it, the six-hour throttle can allow another alert.
