# GENIE-3 dedicated QA identity — proposed creation packet

Status: explicitly approved and applied on 6 November 2026. Real password login and Accounts OIDC invitation acceptance verified. At checkpoint, Genie QA membership is deactivated with zero Genie sessions. Replaces the unavailable existing-credential dependency; does not change HS QA Viewer.

## Exact identity and access

- Display name: **Genie Staging QA Member**.
- Login: **genie.qa.member@aplyd.org**. Abort if this email or display name already exists; do not merge or reset an identity.
- Sign-in authority: existing shared SHO upstream used by `https://accounts.aplyd.org`. Accounts does not store standalone user passwords. This is a new synthetic identity in the shared identity source, not an isolated staging identity provider.
- Native upstream workspace: a new empty **Genie staging acceptance** workspace. Native role MEMBER; no existing projects, tasks, organisations or other workspace membership. Do not use SHO's add-person default-workspace flow: the reviewed implementation attaches users to the oldest workspace and sends mail.
- Central Accounts role: ordinary `user`, enabled, exact immutable upstream ID binding. Only native application link: `aplyd-genie-staging`.
- Genie: reviewed contact in the existing dedicated staging tenant; issue an ordinary **member** invitation through the real administrator UI. No admin grant to this identity. Membership becomes active only after normal credential/OIDC invitation acceptance.
- Existing owner remains the administrator. Existing HS QA Viewer records, credentials, pending invitation and other-app permissions remain unchanged.

## Credentials and operator safeguards

Generate one unique password for this new account with the existing upstream password-hashing implementation. Store the login only in `/opt/aplyd-genie-staging/private/genie3-qa-login.json`, root-owned mode0600 inside mode0700 directory, using exclusive creation. Never print the password, include it in shell history, screenshots, logs, BTF, Bug Off, commits or PRs. Do not read or change an existing account password. No email delivery or password-reset flow.

Before mutation, inspect the live upstream/runtime schema and access boundaries, then back up the affected stores privately. Abort on source/config/schema drift, duplicate identity, workspace collision or inability to prove the new workspace excludes existing content. Serialize against existing Accounts/Genie operator locks. Use parameterized writes and the deployed hash implementation. Record only nonsecret identity IDs, scope, timestamps and before/after counts in public evidence. No Accounts restart, new OAuth client, production Genie activation, other-app link, broad grant or production service change is included.

If live inspection shows additional directory review/binding is required, prepare the exact immutable binding and include it in the same ordinary-role scope; do not infer identity from matching email. If the required authority or isolation cannot be established, stop before mutation.

## Acceptance and cleanup

1. Perform normal password sign-in at the existing SHO source, then signed Accounts OIDC to the approved staging callback. Verify the central subject and native Genie user match the new receipt.
2. Accept the real invitation. Verify ordinary-member read access, hidden administration UI, and protected mutation rejection (2557).
3. Deactivate through owner UI. Verify subsequent reads and mutations fail and reactivation does not revive invalidated sessions; sign in afresh (2558).
4. Verify scoped immutable actor/target/before/after audit events and atomic membership behavior (2559).
5. Remove any temporary acceptance-only route. End with ordinary QA membership deactivated and active QA sessions invalidated. Retain the root-only credential/identity receipt for reproducibility; no other account is affected.
6. Record actual execution in Bug Off and BTF. GENIE-3 stays In Progress until acceptance and remaining release gates pass. PR #2 merge still requires its separate concrete approval.

## Approval boundary

The user requested creation of what is needed. Browser policy still requires action-time confirmation for new security-sensitive access. Requested confirmation is limited to the exact new synthetic upstream account, empty QA workspace, ordinary central identity, Genie staging-only link and invitation, and normal sign-in described above. The approved creation completed; temporary static acceptance-form route installation remains separately approval-gated.
