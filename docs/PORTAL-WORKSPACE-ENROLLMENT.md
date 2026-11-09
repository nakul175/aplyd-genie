# Explicit additional workspace membership

Migration 014 adds an optional per-membership enrollment receipt marker. Private Portal functions require a reviewed current native administrator and one existing exact enabled issuer/subject with active native workspace membership. There is no identity creation or email matching. Existing memberships, including disabled memberships, and pending native invitations are conflicts requiring separate reconciliation.

Review pins native identity, original invitation provenance and reviewer versions. Commit adds one Member with no custom role, atomic audit and receipt. Other memberships, role assignments, identities and work data remain unchanged. Duplicate/stale/failed receipt paths roll back. Shared role editing is supplied by the parent branch, not widened here.

Enrolled membership uses a separate Accounts enrollment-access proof at callback, every request and workspace switch. Proof must be applied and agree with the exact native subject/id/workspace plus original creation provenance for invited identities. Missing/uncertain proof fails closed. Workspace switch rotates native browser cookie as before; permission updates within that workspace use the current cookie. Built-in administrator changes retain native session invalidation policy. No Owner role is invented.

Staging only. This source requires matching Portal and Accounts candidates; gates remain default off. Do not deploy independently or treat isolated acceptance as production certification.
