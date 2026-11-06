# GENIE-2 staging acceptance — 6 November 2026

Runtime source: `82c0f3e997e79e47ead204fb3f8bfaaf23bb093e`.

- Staging: https://staging.genie.aplyd.org
- Story: https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-2
- Implementation: https://github.com/nakul175/aplyd-genie/pull/1
- Bug Off run: https://bugoff.aplyd.org/en-US/projects/runs/7/45

## Observed acceptance

| Case | Live observation | Outcome |
|---|---|---|
| 2554 / AC1 | Real Accounts login reached the protected workspace. Conflicting browser query user/tenant IDs were ignored. The returned IDs matched a guarded server assertion against the reviewed membership. | Passed |
| 2555 / AC2 | Disabling exactly the Genie staging membership denied the existing browser session. That session was deleted; restoring membership did not revive it. Fresh login worked. | Passed |
| 2556 / AC3 | Native browser sign-out returned to the landing page. Previously accessible `/workspace` and `/api/auth/session` then denied access. Database session count was zero. | Passed after fix |

The case's former conversation-URL example was clarified to use `/workspace`, the protected surface for the identity foundation story. Its original acceptance criterion remains unchanged, and the test now explicitly checks both protected endpoints and server session deletion. This does not claim conversation functionality or global suite logout.

## Additional verification

- Both migrations applied through the actual `pg` driver against dedicated PostgreSQL; a second migration run succeeded without reapplying them. A separate synthetic qualification database proved failed DDL rollback, repeat-run idempotence and checksum-mismatch rejection. The first drill harness lacked a nested bind-mount target and failed before reaching PostgreSQL (zero schema tables); its corrected rerun passed. Both operator logs remain on the server.
- The runtime role could read the reviewed membership but received PostgreSQL `42501` for table creation and identity/membership writes.
- The final revision's authenticated browser session survived an application service restart.
- Public TLS verification, redirect/callback binding, PKCE, Secure/HttpOnly/SameSite login cookie attributes, anonymous 401 responses, null/cross-origin logout 403 responses and GET logout 405 passed. See `https-smoke.json`.
- Two public requests with different forged forwarding headers advanced one shared rate-limit bucket twice, confirming that ingress overwrites browser-supplied addresses.
- Final database state: zero live sessions, one active reviewed staging membership, extra synthetic tenant disabled, synthetic unassigned user disabled.
- Post-deployment free disk: 39,073,005,568 bytes. Bounded containers: app 256 MiB / 0.5 CPU; PostgreSQL 384 MiB / 0.5 CPU. No GPU allocation.
- Accounts discovery and SHO root returned 200; Bug Off root returned its expected 307 redirect after the Accounts activation.

## Failures retained

The initial registration verification used loopback HTTP. Accounts correctly rejected it; the guarded operation restored the prior config and removed only its new native link. Repeating the registration with HTTPS succeeded. Other clients, credentials, signing keys and the shared identity database were preserved.

The initial native browser logout on `ffa128a0ae6b739602d4cc8f282a35facd375edf` returned `origin_denied`: `no-referrer` caused a null Origin on the form POST. The workspace now uses `same-origin` referrer policy; other responses retain `no-referrer`, and the strict Origin check remains intact. The failed Bug Off result is retained before the successful final retest. See `initial-logout-failure.png` and `signed-out.png`.

## Deployment provenance and private boundaries

- Node image: `node@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9`.
- PostgreSQL image: `postgres@sha256:1bcc18d81671b02906296aad470ec9778a6b71016ce953092024b680bad007b0`.
- Release: `/opt/aplyd-genie-staging/releases/82c0f3e`; prior candidate retained for rollback.
- Dedicated client: `aplyd-genie-staging`, exact staging callback only. No production Genie client or production Genie route was created.
- Secrets, reviewed native identity details, private config/SQLite backups and full operator logs remain on the server outside this public repository. Public screenshots contain no tokens or personal identity details. Private identity-response screenshots remain outside the repository.
- No schedules or heartbeat automations were enabled. Expired-row cleanup remains a manual release operation; define operational retention before sustained use. This acceptance covers GENIE-2 only, not suite capacity, AI inference or later stories.
