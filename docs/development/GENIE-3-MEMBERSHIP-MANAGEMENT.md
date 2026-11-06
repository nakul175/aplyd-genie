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

Branch: codex/genie-3-membership-management. Migration 003, member/admin UI and APIs, tenant-scoped people pages, versioned writes and invite-aware OIDC callback are implemented. Local suite: 72 passed, zero failed, two actual-PostgreSQL-only tests skipped locally. The dedicated PostgreSQL CI job runs the membership tests against the real engine, including concurrency and restricted-role checks; both push and PR CI gates passed all 19 real PostgreSQL membership tests, with no skips. The existing sign-in tests run against the combined schema and still pass.

Owner action-time approval was received. Migration 003 and its replay passed on staging; the reviewed owner administrator bootstrap, ordinary QA contact/native link and narrow function grants are applied. A member invitation has been issued but is not yet accepted. BTF GENIE-3 is In Progress; cases 2557–2559 remain Not run. Full reports are in evidence/genie-3. Unknown reviewed recipients remain unavailable; invitations never bind by email. Invitation acceptance begins only through an explicit same-origin POST and binds its token hash into encrypted, single-use OIDC state.

## Staging packet

See [fixture and activation plan](../../ops/staging/genie-3/FIXTURE-PLAN.md). The exact bootstrap script passed a read-only dry-run against the live baseline: existing owner is a member, HS QA Viewer is an enabled reviewed ordinary suite identity, and it has no Genie link yet. No permission or identity changed. That action-time approval was received and the script applied successfully with private PostgreSQL/SQLite backups. The recipient must use an isolated in-app browser to preserve the owner’s Chrome session.

## Browser acceptance finding

On eaf4964, the invitation POST reached the server (aggregate pending-login count advanced) but its cross-origin SSO redirect did not navigate under the strict form policy. The corrected invitation POST commits a same-origin continuation document with an explicit Accounts GET link; it preserves the original form policy, origin checks, no-referrer header and encrypted browser-bound OIDC state. The initial stalled browser screenshot is retained privately. See the MDN form-action reference linked in the source comment. QA acceptance remains pending; no case is marked Passed.

## Current release qualification

The navigation fix is deployed as 08be21e and its normal continuation link was verified in the real isolated browser. That browser had an existing Nakul Accounts session; the invitation correctly rejected the mismatched identity. The normal HS QA Viewer sign-in page is now handed to the user. Automatic review rejected the private credential-source lookup; no alternate credential search is permitted.

A fresh-provider-login prompt is now required only for invitation transactions; ordinary suite SSO stays unchanged. The authorized audit-page pagination test also caught a numeric cursor being ordered as text. Migration 004 repairs the existing function without changing migration 003 or adding privileges. Its initial failure report is retained. The combined local candidate has 74 passes, zero failures and the same two PostgreSQL-only checks skipped locally; the updated actual-engine CI gate remains required. Staging acceptance is still pending, with no new Passed claim.
