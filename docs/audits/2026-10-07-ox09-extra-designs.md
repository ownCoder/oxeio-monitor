# OX-09 one-day extra allocation — 7 October 2026

Owner requested **30 additional designs for Gazi Hafizur Rahman (OX-09) today only**. At 12:41 Asia/Dhaka, OX-09 was active, had 4 assigned designs, and had received 12 assignments today; the ready pool had 14,057 designs.

At 12:43 Asia/Dhaka, one PostgreSQL transaction randomly claimed exactly **30** ready designs for employee ID 22. The transaction checked the exact employee identity, active designer status, Dhaka date, daily issuance limit, available pool rows, and that the request had not already been applied. It used the same per-employee advisory lock as normal allocation. The target-history trigger recorded all 30 `assigned` events with source `owner_extra_ox09_20261007`; no app release, policy, or daily target was changed.

Read-only verification after commit: **34 open** for OX-09, **42 issued today** (9 morning distribution, 3 top-up, 30 owner-requested extra), and all 30 extra targets still assigned to OX-09. This is a one-time exception to the normal 30-open limit; no other staff received an extra allocation. The normal 23:55 Dhaka return job will return untouched/unstarted targets. Designs already started or pending skip review remain with the designer under the existing end-of-day safety rule, even if they are among these 30. No automatic repeat is scheduled for later days.
