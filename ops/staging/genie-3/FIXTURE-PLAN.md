# GENIE-3 staging fixture and activation packet

Candidate: PR #2, branch codex/genie-3-membership-management. No security grant or migration has yet run on the live Genie database.

## Exact intended changes

1. Keep the existing `aplyd-genie-staging` client, issuer, secret and callback unchanged. No Accounts restart is required for a new native identity link.
2. After owner approval, promote only the existing approved Genie staging owner membership from member to administrator. Record the bootstrap as an operator-originated, owner-approved audit event; invalidate only its local Genie sessions.
3. Use the already reviewed, enabled **HS QA Viewer** suite identity as the recipient. Add only its dedicated Genie staging native link and tenant-scoped reviewed contact. Keep its existing suite role, credentials, SHO/Holy Sheet permissions and other links unchanged. Do not match by email, create a new upstream identity or reset a password.
4. Use the administrator UI to issue that account a member invitation, accept it after exact Accounts sign-in, exercise deactivation/reactivation and inspect the resulting audit trail. Use an isolated in-app browser for this QA identity so the owner's Chrome sign-in remains intact. Existing test credentials may be used only for normal Accounts/SHO login; they must not enter the public repository or logs.
5. Grant the Genie runtime role EXECUTE only on the six external membership entry points. Do not grant direct identity, directory or audit writes. Keep the internal administrator-context helper ungranted.

## Deployment sequence

- Confirm exact-head CI: the combined local suite has 72 passes; its two real-engine checks run in the separate PostgreSQL gate, which passed all 19 membership tests with zero skips. Full CI logs remain on disk and the CI links are authoritative.
- Recheck capacity, active release/SSO locks and the current Genie receipt. Take root-only dedicated PostgreSQL and Accounts SQLite backups before the migration/new native link.
- Stage the exact reviewed source with the existing pinned Node/PostgreSQL digests; install locked production dependencies with lifecycle scripts disabled.
- Apply migration 003 with the migration role, rerun to verify checksums/idempotence, then apply the approved fixture and narrow EXECUTE grants. Back up first; no whole shared identity database restore is permitted over concurrent changes.
- Recreate only the Genie staging application container. Preserve the existing Caddy route, other applications and all unrelated Accounts configuration.
- Re-run GENIE-2 sign-in/sign-out smoke checks and GENIE-3 cases 2557–2559 through real browser sessions. Preserve failures, timestamps, source revision and before/after audit evidence. Only then request the final merge/closure step.

## Acceptance coverage

- 2557: the ordinary reviewed member cannot invite or change membership; the authorized administrator can.
- 2558: deactivation prevents the member's subsequent protected reads and membership mutations; restoration does not revive the revoked local session.
- 2559: each accepted membership mutation has the correct actor, tenant, target and before/after state; failed/no-op operations do not fabricate successful audit records.

Invitation tokens, upstream session references, passwords, native identity exports and private backups remain server-only or inside the intended isolated browser. No email is sent. The ordinary QA account receives only Genie staging membership, never a production Genie grant. Existing schedules stay paused.
