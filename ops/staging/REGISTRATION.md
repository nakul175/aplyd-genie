# Authorized staging activation

User authorized Accounts registration, Genie staging deployment and GENIE-2 acceptance on 6 November 2026. Production Genie activation is excluded.

Register `aplyd-genie-staging`, confidential authorization code + PKCE, RS256, exact callback `https://staging.genie.aplyd.org/auth/callback`. Keep all other Accounts clients, keys, issuer, upstream configuration and identity records unchanged. Create a distinct native Genie UUID link for the existing reviewed owner identity, with one staging tenant and explicit approval reference. Generate secrets only on the server; private environment files and config backups must never enter this public repository.

Live inspection located Accounts at `/home/deploy/aplyd-accounts-stage`, user service `aplyd-accounts.service`, loopback 3600. Its session-proof endpoint supports generic registered clients and requires an enabled reviewed native link. Normal service restart is required to load a new client; retain a private config snapshot and SQLite online backup for rollback. Recheck current source/config hashes under exclusive lock before changing anything. Do not restore an entire shared identity database over concurrent changes; rollback only the added client/link under the same lock.

Genie deployment uses dedicated PostgreSQL and a bounded Node 24 container, no shared application database. The runtime database role receives only table CRUD; the migration role is private. Caddy overwrites forwarded client addresses; only loopback is trusted. Shared login rate windows reside in PostgreSQL. No production route, unrelated service restart, resource cleanup or scheduled work is included.

Preflight capacity observed: 39,347,003,392 bytes free disk, 8,630,575,104 bytes MemAvailable. Recheck before activation. Preserve at least 2 GiB disk reserve. No active SSO flock was shown in the inspected lock inventory; acquire the known SSO lock before a shared Accounts change. Observe baseline Accounts/SHO/Bug Off responses before and after restart.

Execute migrations twice against dedicated staging PostgreSQL to verify idempotence. Verify runtime cannot create tables. Record resolved image digests and source commit in deployment evidence. Run local regression and hosted CI before publishing the new candidate.

Acceptance: real browser login resolves the reviewed native user and tenant (2554); disabling only the Genie staging membership denies an existing session and replay remains denied after re-enabling it (2555); local sign-out removes protected access and old cookie replay fails (2556). Include negative anonymous, cross-origin logout, proxy rate isolation and service restart checks. Retain case results and screenshots. Do not mark cases passed based only on the synthetic local suite.
