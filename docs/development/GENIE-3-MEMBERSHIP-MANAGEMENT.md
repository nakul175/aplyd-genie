# GENIE-3 / PLAT-102 — implementation checkpoint

Goal: finish the Aplyd Genie backlog, one story at a time. GENIE-2 is complete; 89 stories remain. This story alone is active. Existing schedules remain paused.

## Acceptance

1. Only active workspace administrators can change membership (Bug Off 2557).
2. Deactivation prevents subsequent reads and mutations (2558).
3. Membership changes have an immutable actor/tenant/target/before/after audit record (2559).

## Bounded implementation

- Add member/admin workspace roles; existing records default to member. No automatic administrator grant during migration.
- Invite only identities already reviewed and linked to the dedicated Genie Accounts client. A tenant-scoped reviewed people directory provides human labels without exposing other tenants or silently binding accounts by email.
- Invitation links are random, expiring and single-use. Only token hashes are stored; accepting requires real Accounts sign-in as the exact invited issuer/subject. No email sending is authorized by this implementation.
- Admin UI lists scoped reviewed contacts, memberships, pending invitations and audit history. Administrators can deactivate/reactivate members, change the basic member/admin role and revoke pending invitations. Preserve the last active administrator.
- Serialize membership changes per tenant and recheck the acting session and current administrator role inside the transaction. Write audit events with the mutation; an audit failure rolls the mutation back. Deactivation deletes target sessions in the same transaction.
- Keep the runtime database role unable to edit identity or audit tables directly. Use narrowly scoped, static SECURITY DEFINER functions with an explicit search path and no PUBLIC execute grants. The release operator grants only those entry points.
- No-op membership retries have no duplicate audit event. A second pending invitation returns an explicit conflict; revoke before issuing a replacement. Consumed or revoked invitation links cannot be replayed.

## Release gates

Local regression and PostgreSQL integration must pass. Prepare a concrete staging administrator/recipient fixture packet before any new security-sensitive grant. Browser policy requires action-time approval for those grants. No extra production Genie activation, account matching, automatic email, merge or unrelated service changes are implied by a green local test.

Current deployed foundation: runtime 82c0f3e; merged main 7f64770. Staging server receipt is /opt/aplyd-genie-staging/DEPLOYED.json. Runtime source parity was verified; the database role currently has identity reads and session/transaction/rate table CRUD only. New migration and entry-point grants are required for this story.

## Current checkpoint

Branch: codex/genie-3-membership-management. Migration 003 and 14 membership-boundary tests are implemented. Combined suite: 61 passed, zero failed/skipped. API/UI and invite-aware OIDC callback are not yet wired. No live migration or security grant has occurred. BTF GENIE-3 is In Progress; cases 2557–2559 remain Not run. Full reports are in evidence/genie-3.
