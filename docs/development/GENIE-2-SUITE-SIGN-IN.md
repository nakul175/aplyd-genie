# GENIE-2 / PLAT-101 — suite sign-in foundation

Staging accepted on 6 November 2026. Only this story has been implemented.

- [BTF story](https://backlogtothefuture.aplyd.org/aplyd/issue/GENIE-2)
- [Staging](https://staging.genie.aplyd.org)
- [Implementation PR](https://github.com/nakul175/aplyd-genie/pull/1)
- [Debug acceptance run 45](https://debug.aplyd.org/en-US/projects/runs/7/45)
- [Detailed deployment and acceptance evidence](../../evidence/genie-2/staging/ACCEPTANCE.md)

## Implemented boundary

Express performs confidential OIDC authorization code exchange with PKCE, nonce, state and RS256 verification. PostgreSQL stores hashed opaque browser session handles and encrypted upstream session references. Login transactions expire after five minutes and are single-use. Sessions expire within one hour and within the identity-token lifetime.

Identity uses exact issuer and subject with a reviewed native UUID mapping; no email matching or automatic provisioning occurs. Disabled users, tenants and memberships cannot create or use sessions. Multiple active memberships return `workspace_selection_required`; selection is a later story. Each protected request checks membership, requests fresh Accounts session proof, and checks membership again. Authority outages deny access.

Local sign-out requires a same-origin POST and deletes the stored session. The protected workspace uses a same-origin referrer policy so native browser forms retain Origin provenance; other responses keep no-referrer. Null and cross-origin sign-out remain blocked. This signs out Genie, not other suite applications.

The deployed workspace is a minimal acceptance surface. Conversation UI, contextual workflows and model inference belong to later stories.

## Accepted cases

| Criterion | Debug case | Result |
|---|---|---|
| Server establishes user and tenant; browser cannot override either | [2554](https://debug.aplyd.org/en-US/projects/repository/7/2554) | Passed |
| Disabled membership rejected immediately | [2555](https://debug.aplyd.org/en-US/projects/repository/7/2555) | Passed |
| Sign-out removes protected access | [2556](https://debug.aplyd.org/en-US/projects/repository/7/2556) | Passed after browser fix; earlier failure retained |

All three definitions are Active. The acceptance report distinguishes real browser execution from the 47 local regression tests and hosted CI. Actual PostgreSQL migration rollback, replay and checksum guards were qualified in a separate synthetic database. Session persistence, database least privilege, public TLS, secure cookie attributes and ingress header isolation were checked on staging.

## Registered identity and runtime

Only `aplyd-genie-staging` is registered, with exact callback `https://staging.genie.aplyd.org/auth/callback`, confidential client-secret basic authentication, authorization code/PKCE and RS256. The real generic `/internal/session/status` contract was verified; Genie does not use Holy Sheet's restricted tenant/application endpoints or another app's credentials.

The owner approved linking the existing reviewed suite identity to a dedicated Genie staging membership. No other identity, client credential or application membership was changed. Secrets and private rollback backups remain on the server outside this public repository. A production client remains unregistered.

The dedicated containers and HTTPS route are described in `ops/staging/`. The application binds to host loopback on port 3910. Caddy overwrites forwarding headers, and Genie trusts loopback only. Login limits use atomic shared PostgreSQL windows with hashed client keys. The runtime role has identity reads and session/transaction/rate table CRUD, with no identity writes or DDL.

## Run and operate

Use Node.js 24 and `npm ci --ignore-scripts`. Run `npm test` for local verification. Supply reviewed values through an untracked `.env` or deployment secrets; `npm run migrate` applies checksum-protected migrations. Production server roles must be provisioned separately from migration credentials.

Staging uses `/opt/aplyd-genie-staging`, resource limits and bounded container logs. Full operator logs and private config/SQLite backups are retained there. A previous candidate is retained for rollback. Never rerun registration or secret-generation scripts against an existing registration without inspection: they intentionally refuse overwrite/rotation.

Expired rows are not automatically purged. Retention and cleanup remain manual release operations until explicitly approved. No recurring work was enabled. Production deployment, capacity qualification and AI/GPU costs are outside this story.
