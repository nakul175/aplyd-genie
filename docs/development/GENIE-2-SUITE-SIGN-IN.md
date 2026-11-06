# GENIE-2 / PLAT-101 — suite sign-in foundation

Status: implementation candidate; live acceptance pending. Only this story is active.

[BTF story](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-2)

## Implemented boundary

Express uses confidential OIDC authorization code exchange, PKCE, nonce and state, with RS256 signature verification. Only opaque random cookies reach the browser. PostgreSQL stores hashed session handles and encrypted upstream session references. Login transactions expire after five minutes and are consumed once. Sessions expire within one hour and within the identity token lifetime.

Identity uses exact issuer and subject, with a reviewed native user mapping. Email matching and automatic account provisioning are absent. Disabled users, tenants and memberships cannot create or use sessions. Multiple memberships return `workspace_selection_required`; workspace selection belongs to PLAT-104. Each protected request checks current membership, requests fresh central session proof, and checks membership again. Authority failures deny access without exposing credentials.

Local sign-out requires a same-origin POST and invalidates the stored session. It does not sign out other suite applications. The protected workspace is a minimal acceptance surface; concierge execution is a later story.

## Acceptance mapping

| Criterion | Bug Off | Local evidence | Live acceptance |
|---|---|---|---|
| Server establishes user and tenant | [2554](https://bugoff.aplyd.org/en-US/projects/repository/7/2554) | Reviewed mapping; spoofed browser identity ignored; signed OIDC exchange | Pending real Accounts login |
| Disabled membership rejected | [2555](https://bugoff.aplyd.org/en-US/projects/repository/7/2555) | Disabled user/tenant/membership, race and upstream revocation tests | Pending staging revocation |
| Sign-out removes protected access | [2556](https://bugoff.aplyd.org/en-US/projects/repository/7/2556) | Cookie replay denied after deletion; origin checks | Pending browser acceptance |

All three cases remain Draft / Not run. Automated tests use synthetic identities, signed synthetic tokens and embedded PostgreSQL (PGlite). They do not prove deployed identity interoperability, production PostgreSQL driver connectivity, reverse proxy behavior or live acceptance.

## Accounts registration packet

| Environment | Dedicated proposed client | Exact callback |
|---|---|---|
| Staging | `aplyd-genie-staging` | `https://staging.genie.aplyd.org/auth/callback` |
| Production | `aplyd-genie` | `https://genie.aplyd.org/auth/callback` |

Register confidential code clients with client-secret basic authentication, PKCE S256, RS256 ID tokens and `openid profile aplyd` scopes. Confirm the `aplyd_session_uid` claim and `/internal/session/status` contract before deployment. The proof request supplies client ID, client secret, subject and UID; a positive response must match both subject and reviewed native `local_id`.

The inspected local Accounts source supports the generic session-status contract. Its tenant/application endpoints restrict callers to Holy Sheet; Genie does not reuse those endpoints or another application's credentials. This is source inspection, not proof of current deployed configuration. Shared Accounts configuration has not been changed.

Provision a reviewed issuer/subject-to-native-UUID user link, a tenant UUID and active membership with an auditable review reference. Schema defaults deny access. Keep changes disabled until the account owner verifies them. Use dedicated database credentials with only required Genie table permissions; migration privileges belong to the release operator.

## Deployment gates

1. Review this implementation and register the staging client and native identity mapping in Accounts.
2. Supply dedicated database URL, client secret and a persistent random 32-byte base64 encryption key through deployment secrets. Never reuse another app's client or commit credentials. Changing the encryption key invalidates existing encrypted transactions and sessions.
3. Run the checksum-protected migration against dedicated staging PostgreSQL; verify retry, rollback and actual driver connectivity. Back up before production migration.
4. Configure HTTPS ingress to the loopback listener. Production auth rate limiting uses shared PostgreSQL windows with hashed client keys. Set `GENIE_TRUST_PROXY=loopback` only when the local proxy overwrites forwarding headers, as in the staging Caddy fragment. Do not blindly trust browser-supplied forwarding headers.
5. Verify TLS, cookie attributes, callback URL, tenant isolation, central revocation, sign-out/replay, authority failure and restart through the real staging browser. Record evidence in cases 2554–2556 before marking them Passed or the story Done.

Expired session, transaction and rate-limit rows deny access or reset as appropriate but are not automatically deleted by this story. Define retention and release-time cleanup before sustained traffic. No recurring jobs or heartbeat schedules have been created. No production deployment or GPU/model invocation is included.

## Local verification

`npm test` runs 47 tests covering OIDC, Accounts proof handling, SQL-backed sessions and encryption. Reports are in `evidence/genie-2/`. The first sandbox attempt had loopback-listener permission errors; its full report is preserved. The authorized rerun passed, and the final candidate was rerun after review changes. Dependency audit results are recorded alongside test reports. CI runs the same tests and a production dependency audit on pull requests; it does not deploy.
