# Birthday design skip reason — 11 October 2026

Release **495 / `d1f9224604425e2d8baac67b5be1528ac883ee62`** adds **Birthday** to the design Skip reason picker. Like Event, Copyright and Others, it creates a pending owner/manager review request and a one-for-one replacement obligation. The existing shared reason picker also shows Birthday for Design Pool deletion. Birthday is available in review and pool filters, saved views and daily reason counts.

Migration `20261011120000_birthday_skip_reason` extends the skip-request reason check constraint. No existing rows were changed. Local API and web typechecks, focused ESLint checks and all six saved-view tests passed. The database integration test for Birthday was added but not run locally because no isolated PostgreSQL test database was available.

The VPS started from clean release 494. API, web and migration images built; Prisma applied the new migration and reported the database schema up to date. Both services are healthy, public health reports build 495 and commit `d1f9224`, the PostgreSQL container ID is unchanged, and the public JavaScript hash matches the web container and contains Birthday. An unauthenticated skip request returns 401. Deployment marker matches the new commit. Root disk had 7.8 GiB free (90% used) after deployment.

Source mirror: `.release-salary/oxeio-monitor`. Release bundle: `.release-salary/birthday-skip-source-20261011.tar`. API and web images before this release have the tag `before-birthday-skip-20261011` for rollback.
