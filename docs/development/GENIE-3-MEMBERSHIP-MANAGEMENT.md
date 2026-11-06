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

## Deployed candidate checkpoint

7d87fe7 is deployed. Migration 004 and a repeat migration run succeeded, and the live runtime privilege probe confirmed no direct identity/membership/audit writes or schema DDL. Both current CI gates are green: 74 local/combined passes (two real-engine tests skipped in that job), plus 20 actual PostgreSQL passes with zero skips. Public staging health is live. The private server receipt explicitly labels this a candidate with live acceptance pending.

The user reported completing QA sign-in twice, but the controlled in-app browser still displayed Nakul / Super Admin after refresh, and fresh signed invitation login rejected that identity. No ordinary-member acceptance is claimed. Automatic review rejected checking Chrome outside the initially approved isolated scope; a new narrow browser-scope question is pending. Do not bypass either that restriction or the rejected private credential lookup.


### QA credential-source revalidation — 6 November 2026

The user explicitly authorized locating and using the existing HS QA Viewer staging credentials. The documented custody source (`deployment/QA-ACCOUNT-MATRIX.md` in the parent workspace) names a root-only staging file; exact name, account ID and reviewed email lookups found no matching credential entry. No password was retrieved or changed. Automatic review rejected a broader source listing; a bounded filename-only search followed by exact-recipient record lookup is pending explicit clarification. Ordinary-member live acceptance remains unexecuted.

The subsequently approved bounded filename-only search completed. Neither documented/discovered staging credential file contains an exact HS QA Viewer name, account ID or reviewed-email match; no additional credential-source file was found within the bounded staging directories. No credential was retrieved or changed. A fresh browser account-menu check still shows the owner, so ordinary-member cases remain Not run. The root console was closed and normal sign-in retained for handoff.


### Dedicated QA identity and actual acceptance — 6 November 2026

The user explicitly approved a new synthetic ordinary identity, new empty upstream workspace, ordinary Accounts identity and Genie staging-only link/contact. The guarded operator first stopped before writes on its local-DB assumption; after pinning the actual private managed PostgreSQL target and preserving TLS, dry-run and creation succeeded. The unique password was entered through hidden terminal input and retained only in a root-owned mode0600 server receipt; no existing credential changed. Real normal password login showed Member with zero existing projects/tasks. A stale owner Accounts session caused a blank account-switch continuation; normal central logout in the QA browser followed by a new invitation transaction completed successfully. No session-record decryption, cookie inspection or fabricated login was used.

The ordinary QA workspace has no administration link; the admin read endpoint returns administrator_required. Actual owner UI deactivation made the QA session fail authentication; reactivation did not revive that session, while fresh SSO succeeded. Audit UI verified invitation, acceptance, deactivation and reactivation with actor, target, timestamp and before/after status/role. Bug Off run46 records case2559 Passed, with all three steps Passed and a non-sensitive JSON report attached. Cases2557/2558 remain Pending until real POST denials are executed. Automatic review rejected installing the temporary static form route without exact approval; that approval is pending, and no route is installed. Upload of the live audit screenshot was also rejected; it remains local, while the sanitized report contains no identities/credentials/session material. Final checkpoint: QA member deactivated, zero Genie sessions, root console closed.


### Acceptance completed — 7 November 2026

The pending mutation checks were completed through existing HTTPS APIs using the approved QA credential and a fresh real Accounts OIDC flow. A standard in-memory cookie jar followed the actual redirects; no browser cookies were read, no stored session was exported, no authentication was fabricated, and no temporary route was installed. The live client passed 13 checks: real upstream login; protected Genie workspace and exact identity/tenant; ordinary administrator GET and all three change/invite/revoke POST denials403; after owner UI deactivation, three protected GET and all three POST denials401. The source and non-sensitive report are committed with this checkpoint.

Bug Off run46 was updated with all three cases and all nine manual steps Passed, non-sensitive evidence attached, then completed as Done and verified after reload. The ordinary QA membership was left deactivated. Local browser control was subsequently disabled; the user reported enabling it, but the browser backend still reports disabled and inventories no browsers. Final SQL cleanup readback, operator receipt update, repository case activation and BTF closure remain outstanding. The earlier zero-session SQL readback is historical; current401 evidence proves current access loss but is not relabelled as a fresh SQL count. No new story or merge has started.
