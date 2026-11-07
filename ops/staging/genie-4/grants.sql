-- Execute only as the migration owner after approving the staging activation packet.
-- Login password is provisioned separately in a root-only file, never in this script.
BEGIN;
GRANT EXECUTE ON FUNCTION genie_current_capabilities(text),genie_save_role(text,uuid,text,jsonb,bigint),
 genie_assign_role(text,uuid,uuid,boolean,bigint),genie_roles_page(text,text,text,text),
 genie_enqueue_member_export(text),genie_get_member_export(text,uuid) TO genie_runtime;
CREATE ROLE genie_export_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE genie_staging TO genie_export_worker;
GRANT USAGE ON SCHEMA public TO genie_export_worker;
GRANT SELECT ON genie_users,genie_tenants,genie_memberships,genie_sessions TO genie_export_worker;
GRANT DELETE ON genie_sessions TO genie_export_worker;
GRANT EXECUTE ON FUNCTION genie_current_capabilities(text),genie_claim_member_export(),
 genie_finish_member_export(uuid,uuid,text) TO genie_export_worker;
COMMIT;
