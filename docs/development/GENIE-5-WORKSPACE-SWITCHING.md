# GENIE-5 — Explicit workspace switching

In Progress after GENIE-4 merged as b2877f2 and was verified Done. Branch codex/genie-5-workspace-switching. Cases2563–2565 remain Draft/Not run until actual staging acceptance.

- AC1: show the active workspace by name. Offer only active memberships, require explicit choice after OIDC when more than one membership exists, and preserve an invitation's explicit destination. Switch with same-origin POST, fresh Accounts proof and a transactional destination membership check. Rotate the browser token; old tokens cannot access browser routes or switch again. Never extend the source session lifetime or accept browser-supplied principal/role.
- AC2: implement real tenant-bound, user-owned conversations and bounded structured search of authorized workspace resources. A workspace switch changes the server-derived search/conversation scope. Cross-tenant IDs and hidden/disabled resources remain unavailable. Do not substitute a UI label change for isolation or fabricate an app connector, model, or vector retrieval system. The broader Genie conversation/model and app-connector stories remain separate.
- AC3: preserve each existing queued export's immutable origin tenant, actor and sealed authorization context. Retire the previous token for browser access while allowing the isolated worker to reauthorize the persisted context. A switch never changes a job's origin tenant, payload or result scope; membership/source revocation still prevents completion. Sign-out revokes contexts belonging to the current browser family, including pinned jobs; other browser families remain independent.

## Implementation boundaries

Migration008 adds tenant names, browser-family state and an atomic switch/retirement operation. Both tenant locks are acquired in stable order, matching existing membership and role mutation locks. The source row is locked, target membership rechecked, and a new immutable tenant-bound session is minted with the same expiration. One active browser context per family and a bounded number of rotations protect concurrent switch requests. Application authentication must explicitly reject retired contexts; only the worker can opt in to background authentication. Do not deploy this schema separately from the compatible server/worker wiring or grant new entry points before reviewed activation. Migrations001–007 remain immutable.

Use a short-lived, one-use, browser-bound encrypted workspace-selection record after normal OIDC for multi-membership sign-in. Scope all live conversation/search operations to the authenticated server frame, with real persistence, bounded inputs/results and explicit permission checks. Add focused SQL, HTTP, worker and real-PostgreSQL concurrency/privilege tests; prove actual staging selection, tenant isolation and a real queued export after switching. A second synthetic staging workspace and new grants require a concrete activation packet and action-time confirmation. No Accounts/SHO identity change, production activation or personal schedule.


## Integrated implementation checkpoint

Migrations008–009 are wired into the migration runner and production server. Normal multi-membership OIDC yields an explicit one-use chooser, and protected pages show the active workspace. Same-origin switch rotates browser authorization without extending expiry. A retired token cannot authenticate browser requests; the separate real export worker can reauthorize the old tenant-bound context, while sign-out revokes the browser family. Conversation create/append/list/detail and structured member/role/title search are real persisted, server-scoped operations; resource access is rechecked in PostgreSQL.

Integrated local138 tests:130 passed,8 real-engine-only skips,0 failures. Focused database qualification11 passed and2 PG-only skips; focused HTTP passed43 before the additional pending-choice sign-out regression. Combined counts are not additive. Full logs remain in /private/tmp/genie-5-*.log. CI is extended to actual PostgreSQL workspace/conversation privilege and concurrent switch checks. No live GENIE-5 activation or acceptance has run. Concrete packet: ops/staging/genie-5/FIXTURE-PLAN.md, grants.sql, fixture.sql.

## Staging acceptance

Revision `f05382771e6343d5c217a1212a64509919df890e` passed all 43 live checks. Migrations 008–009 were applied and replayed, and the app health check passed. The evidence file records the observed HTTP and worker outcomes.

- Case 2563 covers the explicit workspace chooser, active workspace indicator, native switch form, forbidden target rejection and retired token rejection.
- Case 2564 covers persisted conversations and tenant-scoped search. Cross-workspace conversation reads and writes returned 404, and forged tenant values did not change the scope.
- Case 2565 covers a real export completing in workspace A while the browser was in B. A second export stayed bound to A and was denied after browser-family sign-out.

The owner browser session expired, so the temporary membership and reader roles were managed with scoped staging operator transactions and explicit audit provenance. The live checks still used the dedicated QA identity, normal Accounts OIDC and Genie routes, and the isolated worker in one-shot mode. Cleanup verified that workspace B is disabled, no temporary grants or QA sessions remain, and the original owner remains active.

The acceptance and cleanup harnesses are preserved under `ops/staging/genie-5`. For the recorded run, the operator fixture script was executed with `ACCEPTANCE_SOURCE` bound to the text of `verify-qa-api.py`, followed by `verify-cleanup.py` after the fixture transaction completed. These scripts target the named staging revision and fixture.

BTF and Bug Off require fresh sign-ins before the tracker records can be updated. GENIE-5 is still In Progress and PR #4 is a draft.
