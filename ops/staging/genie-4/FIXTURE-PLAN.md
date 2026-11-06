# GENIE-4 staging activation and acceptance packet

Scope: Genie staging only. Do not execute until the exact candidate passes CI and the security grants below receive action-time approval. No Accounts/SHO changes, password resets, production access or personal schedules.

## Deployment and least privilege

- Preserve the accepted GENIE-3 receipt, root-only backup and current release. Back up only the Genie database before applying new migrations005–007 with the existing migration owner. Existing001–004 checksums must remain unchanged. Rerun the migration runner to verify idempotence.
- Use the same pinned Node24/PostgreSQL17 images and locked production dependencies. Recreate only the Genie staging app against the new release, preserving other apps and the reverse proxy.
- Keep existing runtime grants. Add EXECUTE on genie_current_capabilities(text), genie_save_role(text,uuid,text,jsonb,bigint), genie_assign_role(text,uuid,uuid,boolean,bigint), genie_roles_page(text,text,text,text), genie_enqueue_member_export(text), genie_get_member_export(text,uuid). Grant neither direct policy/job/audit writes nor internal permission helpers.
- Apply the exact grants in grants.sql: create genie_export_worker initially NOLOGIN, with CONNECT/schema USAGE, SELECT on the four identity/session tables used by IdentityStore.getSession, DELETE on sessions for fresh-authentication invalidation, and EXECUTE only on current capabilities plus claim/finish. Activate LOGIN with a generated server-only password stored in private/export-worker.env. No role management, policy writes, job-table reads, app session creation or superuser privilege. The password must never appear in a command, log or public file; provision it inside the root-only operator script. Existing runtime cannot claim or finish jobs.
- For acceptance, run the real worker with --once using the reviewed server-only configuration. Do not activate a persistent worker service until its exact process configuration is reviewed. The provided worker loop is application processing, not an authorization to resume personal automation.

## Synthetic staging fixture

Reuse the approved dedicated Genie Staging QA Member identity and normal password/OIDC login. Its existing password stays in its exact root-only private file and is never copied into source, logs, comments or test evidence. Reactivate only this Genie staging membership if needed, using the owner UI. Owner remains administrator.

Create two temporary named roles through normal owner UI:

1. GENIE-4 QA Reader: workspace.members/read only.
2. GENIE-4 QA Steward: workspace.members/read and workspace.roles/read, manage, assign only.

Assign only to the synthetic QA member. No invitation, email, other-app permission or built-in administrator promotion. Remove assignments and clear temporary grants after acceptance; restore QA membership to disabled and revoke its Genie sessions. Keep truthful policy audit records.

## Live cases and evidence

- 2560: ordinary member denied; assigned reader sees read-only member UI and can call members.list, while membership mutations and members.change return403. Verify native forms, direct API and safe errors.
- 2561: queue a real member export as reader, remove its role before execution, execute real --once worker, verify denied/no result; restore reader and prove a completed export, then revoke access and prove result/UI/tool access denied on the same session. Exercise Accounts/local session freshness and inspect audit.
- 2562: scoped steward can create/assign only the grants it holds. Attempt membership manage and invitation create delegation, editing a stronger role and built-in administrator changes; verify403 and no unintended grant/audit success. Browser payload cannot select actor or tenant.

Preserve revision, timestamps, actual responses and sanitized evidence. No mock Accounts proof, fabricated background pass, synthetic bearer session or database-only assertion counts as live acceptance. Keep cases Not run until executed. Close story only after acceptance, cleanup, final CI and exact-head merge approval.
