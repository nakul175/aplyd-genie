# Portal custom-role assignments — staging candidate

The private bridge assigns/removes existing native workspace roles for active Members. Built-in administrator changes remain in the separate membership flow. The exact native catalogue, role versions, reviewer authority and target membership are pinned to the review; drift, replay and cross-tenant selections reject. No email matching, new identity, role definition or app grant is inferred.

Migration 011 shares the existing native assignment policy and tenant transaction lock. It grants no runtime caller access. Deployment/configuration and privileged bridge provisioning are not performed by this PR.

Every protected request checks current native authority. Open pages compare their rendered capability revision with /api/auth/session every five seconds or on focus. A change clears old controls and opens the current workspace; custom-role edits preserve the native session while reducing its effective rights.

Validation: full local suite 167 tests, 155 passed and 12 explicit PostgreSQL skips; all eight new bridge tests also passed against real isolated PostgreSQL, including competing saves (exactly one winner). Real Portal Review/Save + Accounts OIDC + native Genie browser passed grant, downgrade, revoke-all-custom-roles and regrant on the same cookie. Existing users, role definitions and nonempty conversation data preserved. Upstream login was synthetic. This is not production acceptance or new-account provisioning.
