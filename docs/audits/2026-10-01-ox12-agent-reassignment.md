# OX-12 agent recovery — 1 October 2026

## Diagnosis

- OX-12 Abdul Karim's staff and portal account are active. Web/agent authentication succeeded several times around 10:01–10:05 Dhaka after earlier incorrect-password attempts.
- His former device `INTERN_2` (#17, agent 0.4.11) stopped normally at 09:06; there is no later heartbeat.
- The newly installed agent (0.4.9) reached `/api/v1/agent/enroll-login`, but the server returned HTTP 409 after authentication. Its Windows identity was `SADIA\Intern`, already registered as active device #26 for OX-07 Sadia Akther. The submitted machine GUID matched that device. This is a deliberate protection against mixing two employees' tracking data, not a server outage.
- Owner confirmed that Sadia's physical PC is now being used by Abdul.

## Action and verification

- Revoked device #26 through a guarded, atomic SQL change with an `audit_log` entry; retained all historical screenshots and work records. The exact reviewed statement is [the recovery SQL](2026-10-01-ox12-device-reassignment.sql). It updated one row and created audit #4602 at 10:28 Dhaka. A follow-up read confirmed device #26 is `revoked`.
- Abdul signed in on the reassigned PC at 10:39 Dhaka. Device #26 now belongs to employee #25 (OX-12), is active, and a fresh heartbeat was observed after 11:12. Agent version 0.4.9. The enrollment and heartbeat are verified.
- Do not restore the revoked Sadia device: restore would revive its old token. Do not share a Windows account between two active staff members.
- Owner confirmed that the former OX-12 `INTERN_2` PC/SSD is retired. Its device #17 was also revoked through [a guarded statement](2026-10-01-ox12-retired-device.sql), with audit #4603. No historical tracking data was deleted.

## Acceptance check

1. Device #26 belongs to employee #25, is active, and has fresh `enrolled_at` and `last_seen_at`; this passed.
2. Confirm the tray shows OX-12 and healthy sync on the PC during the next physical visit. Server heartbeat is already verified.
3. Retired device #17 remains revoked. Do not restore its old token.

No app code or deployment changed in this recovery.
