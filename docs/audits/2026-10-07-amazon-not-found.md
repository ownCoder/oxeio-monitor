# Design Pool Amazon page audit — 7 October 2026

## Outcome

At 11:07 Asia/Dhaka, 18 active targets were changed through the authenticated owner Design Pool UI to **Deleted · Not Found** after each exact `https://www.amazon.com/dp/<ASIN>` URL displayed Amazon's **Page Not Found / Dogs of Amazon** page in Google Chrome. The UI confirmed the resulting status for every target. One of the 18 was assigned to a designer; the other 17 were waiting in the pool. The normal soft-delete flow kept the rows and ASIN uniqueness, removed them from distribution, and wrote a target-history event for each. This was a live data correction, not a code release; web/API remain **449 / `52c6a9d438c71eb766556ded8553aa121d2b806a`**.

| Target IDs | ASINs |
|---|---|
| 398, 1715, 1718, 1727, 1740, 1746 | B0DY5961BK, B0FDQPTB5Y, B0FDVH3CPW, B0FFFRCYQB, B0FG1M9CJP, B0FG9K7KH4 |
| 1798, 1857, 1991, 2010, 2103, 2164 | B0FK27PLYZ, B0FMHLNYJR, B0FWCZ4ZV4, B0FXD4PBTY, B0G43SCVQJ, B0GCTWPN5T |
| 2501, 2552, 3013, 3958, 4041 | B0DPXFK79Q, B0DY6DT4WB, B08Z69SBKQ, B0DPKLQ4Z2, B0GBXWYFHZ |
| 58321 (assigned) | B0H7BZSQ6B |

Production verification: all 18 exact IDs now have `status=deleted` and `drop_reason=not_found`; all 18 have a `deleted` target-history event. Live totals after the correction: 14,062 waiting, 202 assigned without a drop reason, 24 Deleted · Not Found overall (including 6 pre-existing records).

## Scope and limits

- A read-only HTTP pass requested the first 300 *oldest waiting* ASINs and the first 100 *newest assigned* ASINs. Raw outcomes are in [waiting TSV](2026-10-07-amazon-pool-audit.tsv) and [assigned TSV](2026-10-07-amazon-assigned-audit.tsv). The waiting pass returned 17 Amazon 404 dog pages, 136 other HTTP 200 responses, and 147 HTTP 200 robot/challenge responses. The assigned pass returned one 404, 93 recognizable product pages, and six challenge responses. All 18 404 candidates were reopened and confirmed in Chrome before mutation.
- The HTTP 200 waiting responses were deliberately not classified as live products because the probe read only the first 80 KB of large pages. Challenge, CAPTCHA, network-error, and “Currently unavailable” screens are **not evidence that the ASIN is missing**. Amazon began returning challenge pages partway through the pass, so the bulk pass was stopped. A later attempt to inspect the next 50 in Chrome timed out and yielded no reliable complete batch result; none of those were changed.
- This is **not a full 14,000+ target audit**. The remaining waiting/assigned targets have not been confirmed. An older target previously labeled Not Found (`B0CLH3JBFL`) currently returned an Amazon product page during calibration; an earlier label can become stale. It was already deleted and was not changed in this work.

## Safe continuation

Use Google Chrome to open exact `amazon.com/dp/<ASIN>` links in manageable batches. Change only an active, eligible target whose own URL shows Amazon's Page Not Found/dog page; in Design Pool search the ASIN, select its row, choose **Delete selected → Not Found**, then verify **Deleted · Not Found**. Do not infer a missing product from HTTP 200 challenge, robot check, temporary transport failure, or unavailable stock. The owner can restore an incorrectly marked row with **Undelete**. Recheck current status before changing it because designers may complete or skip assigned work during review. Resume from the source audit files; their rows are observations at the recorded time, not a live availability guarantee.
