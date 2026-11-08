# Review reason and Design Pool controls — 8 November 2026

Release 516, commit `8e93f5e3bfe6d43dcfe37df7c47e2342e57571f5`.

Owner and manager can change a skipped design's reason from Review and send skipped or deleted Review items to Design Pool. A pending request changed to Page Not Found becomes automatic and leaves the review queue; other corrected reasons remain pending. Pool return clears assignment and active workflow fields, closes a pending decision as rejected, and preserves the historical skip request and replacement record for audit.

Both write routes are owner/manager only. Staff received 403 and invalid reasons received 400 in isolated integration tests. Server and web typecheck/lint passed. The isolated PostgreSQL skip-review suite passed 12/12 with no production data. The exact committed web source built successfully; public JavaScript matched the built asset byte for byte. Anonymous write checks returned 401.

API and web are healthy at build 516. PostgreSQL container and schema were unchanged; payroll, deposits and existing design records were not mutated during deployment. Evidence: `/opt/oxeio-releases/review-controls-20261108`. Rollback images: `oxeio-api:before-review-controls-20261108` and `oxeio-web:before-review-controls-20261108`.
