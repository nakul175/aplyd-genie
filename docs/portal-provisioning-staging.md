# Fresh Genie Member provisioning (staging candidate)

Private migration012 creates a new identity only for a previously absent exact issuer/subject and a currently approved native workspace administrator. It creates Member with no custom roles; existing/disabled identities are conflicts. Native create + membership + receipt are atomic. The native identity permanently records its Portal request and workspace. No runtime role receives permission to call the private provisioning functions.

A marked identity must pass the new Accounts `/internal/genie/access` proof before native session issuance and on every authenticated request. Missing/outage proof fails closed. A revoked proof retires the old native session; later regrant does not revive it. Existing unmarked users retain the current session behavior. New users are limited to the exact reviewed provisioning workspace; expanding them to other workspaces is not implemented by this slice.

Pair with the Portal provisioning coordinator and Accounts receipt-aware proof candidate. Installing SQL alone or using an older native server with provisioning enabled is NOT supported. Writers remain default-off; rollout requires paired artifact/version acceptance before any enablement. No production migration/deploy is included.

Validation: native176 tests (163pass,13explicitPGskips); six new real-PostgreSQL tests allpass including collision/concurrent creation and rollback. Actual isolated Portal Create -> first launch -> native OIDC -> same-session custom-role grant/downgrade/revoke passes. Receipt uncertainty denies and retires old cookie; fresh login succeeds after explicit fixture recovery. Existing native/Portal/Accounts data compared. Upstream login and fault injection synthetic. No all-app or production acceptance claim.
