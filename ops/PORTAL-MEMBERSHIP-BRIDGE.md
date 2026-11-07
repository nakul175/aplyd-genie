# Portal membership bridge — staging candidate

Migration 010 creates an empty, default-deny bridge. It does not enable a Portal
writer, approve any reviewer, create identities or memberships, or grant any
runtime database privileges. Production deployment is not approved by this file.

The Portal must authenticate its current central reviewer before calling the
bridge. The bridge separately requires that exact issuer/subject to be an active
native administrator with an enabled `genie_portal_reviewers` entry for the exact
native workspace UUID. Email matching and account creation are not supported.

A dedicated database principal may receive EXECUTE on only
`genie_portal_membership_preview(text,text,text,uuid)` and
`genie_portal_membership_change(uuid,text,text,text,uuid,text,text,jsonb)`.
It must not own the database, be a superuser, inherit the migration owner, receive
table writes or EXECUTE on `genie_change_member_as_actor`, or be the ordinary
Genie runtime principal. Provisioning and per-workspace reviewer approval are
separate reviewed actions; they have not been performed in production.

Preview returns an exact native plan, including membership/reviewer revisions and
custom roles. Save must present that unchanged plan and a unique request UUID.
The transaction takes the same workspace lock as the native editor, rechecks the
reviewer, applies the existing native policy, reads back, and records a receipt.
The last active administrator remains protected. Custom assignments, identities,
other workspace memberships and unrelated sessions are preserved.

Built-in role changes and disable remove the target's workspace sessions, matching
the native editor. Regrant does not resurrect old cookies. A new native session
is required. Protected pages poll current session status every five seconds and on focus.
Invalid sessions clear the rendered content; unverifiable status clears content
until a fresh server render succeeds. Native enforcement never depends on this
poll. Custom-role editing and app assignment creation remain outside this scope.

If a response is lost, do not retry with another request UUID. The Portal retains
an unresolved dispatch. Reconcile its UUID with `genie_portal_receipts` using a
separately approved read-only operator path. No automatic unlock is provided.

Validation: native PGlite policy tests plus disposable real PostgreSQL tests,
including competing last-administrator removals and reviewer revocation. The isolated
browser matrix additionally covers real Portal Review/Save, Accounts signed OIDC,
native PostgreSQL, grant/downgrade/revoke/regrant, old-cookie replay rejection,
open-page clearing, native write allow/deny, and preservation of nonempty
conversation/custom-role fixtures. Its upstream login is synthetic; it is not
production credential or all-app acceptance.
