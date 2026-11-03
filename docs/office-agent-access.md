# Agent access and shared-PC login

Updated: 3 November 2026 (Asia/Dhaka).

## Requested rule

The owner has deferred the office-IP restriction. **Allow agent access from any IP for now.** A new office IP will be supplied later; the earlier 144.79.106.62 value is not enforced. Any active staff-linked account may authenticate on any PC. Email/password, optional 2FA, and login throttling still apply.

## Implementation

- AGENT_ACCESS_MODE=any is now the default in code, Compose, and .env.example. IP filtering is skipped even if an older allowlist remains configured; account/device authentication is still required.
- Later set AGENT_ACCESS_MODE=office and supply AGENT_OFFICE_NETWORKS with the newly approved IPs/CIDRs. Office mode fails closed for missing/invalid allowlists; unknown modes also deny access.
- The server uses Express `req.ip`, with the existing one-hop trusted reverse proxy. Caddy is the public entry point; API port 3000 stays bound to loopback. Do not expose the API directly or increase proxy trust without validating the topology.
- Only when office mode is enabled, an outside-office request receives HTTP 503 with `office_network_required`. This status deliberately keeps existing agents' credentials and offline queues intact; their generic 403 handling can otherwise discard data. Access resumes when they return to the allowed network. This is an API access rule, not a prohibition on local offline capture.
- Each employee retains their own device registration for a hostname/Windows-account pair. Switching users revokes the previous active registration and rotates the new user's token. Existing device IDs and historical ownership are preserved. Repeated/concurrent enrollment is serialized per Windows slot; a database partial unique index permits only one active registration there.
- Admin restore returns a conflict if another employee is currently using that Windows account. Enrollment codes remain single-use, including concurrent redemption.
- Updated Windows agent sign-out records a recovery marker and restarts the process. The replacement waits for the previous process to exit. Before any capture or sync starts, the old queue/database and screenshot files are retained under `<agent data>/account-history/<id>` and never sent under a new account. The archive includes the former device ID when available. If cleanup cannot finish, startup fails closed. The login form then uses staff credentials, not the installer's old enrollment code.
- Staff should use **Sync now** before signing out. Archived unsent data is not automatically counted or replayed; IT recovery must use the former owner. No automatic archive deletion was added.

## Source and validation

Source branch: `codex/office-agent-login`, based on clean VPS HEAD `82fd8a447f0b431e7ff7e54610407e83a02a4e89`.

Local worktree: `C:\Users\Mamunur Rasid\.codex\worktrees\office-agent-login\oXeio Office`. The original workspace contained unrelated uncommitted changes and was not overwritten.

- Prior implementation: server typecheck and lint passed. Any-IP revision: 18 network/mode tests and server typecheck passed.
- Server: 107 tests passed across office-network, login, concurrent handoff/admin restore, ingestion, device overlap, and portal authentication suites.
- Agent: 403 Core tests and 131 Agent tests passed, including archive/provenance recovery.
- Migration applied successfully to a disposable PostgreSQL database, not production.
- Full graphical sign-out/restart on an installed office agent has not been manually verified.

The documentation and source are local to this branch; GitHub push and VPS shared-document sync have not been performed.

## Deployment status and rollout

**Implemented and locally tested; not deployed.** Production API configuration/schema and installed agents have not been changed. No MSI version was published in this task. Existing release records remain historical.

Deployment needs the server changes plus migration `20261103090000_shared_pc_employee_identity`, an updated versioned agent MSI, and an office-PC sign-out/relogin check. Keep AGENT_ACCESS_MODE=any for this rollout. Office mode must wait for the owner’s new IP and instruction to enable it. Stage an updated agent first and validate account switching before broader rollout. Use both VPS Compose files. Preserve a database backup before migration.

Rolling back the old unique Windows-slot schema after handoffs requires reconciling multiple historical registrations; do not delete their tracking records or blindly restore the old unique index. Prefer a forward fix. This change does not reconstruct ownership already reassigned by historical manual repairs.
