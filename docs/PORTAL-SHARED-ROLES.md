# Portal shared-role capability editing

Migration 013 exposes two private, ungranted functions for reviewing and changing one existing workspace role's capabilities. Role names, assignments, identities, built-in administrator authority and business data are preserved. Native UI and Portal use the same grant validation and capability-delegation policy.

The native review pins the current approved administrator, reviewer revision, target membership, role catalogue and every assigned member's status/version. A tenant advisory lock and assignment-table share lock serialize writers; stale reviews, foreign roles, unknown capabilities and repeated request IDs fail. Native role change, audit and receipt commit atomically. Failed receipt insertion rolls the role change back.

Each request recomputes native capabilities. The existing session watcher clears stale screens when their capability digest changes. No session replacement is required for custom-role grant/downgrade/revoke. Built-in admin/member changes retain their separate native semantics; this does not invent an owner role or implement workspace enrollment.

Validation: 5 new native tests pass in PGlite and separately on real disposable PostgreSQL. Full native suite: 181 tests, 168 pass, 13 explicitly optional integration skips. Actual Portal Save was exercised against two independent open browser sessions, including grant, downgrade and capability revoke. Existing assignments, users, memberships and work data remain unchanged. The selected role is deliberately changed and restored; its revision advances 1→5 and audit/receipt rows remain.

No production migration or database privilege grant is included. Runtime callers cannot execute the private bridge by default. Portal integration is separately gated and stacked on the accepted staging source.
