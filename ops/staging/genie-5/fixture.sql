-- Staging only, after approval. Creates only the reviewed synthetic second workspace.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('genie-membership:95cdd7a0-7124-46e8-bbb8-d6cbf58b9b0d',0));
DO $$ BEGIN
 IF current_database()<>'genie_staging' THEN RAISE EXCEPTION 'staging database required'; END IF;
 IF EXISTS(SELECT 1 FROM genie_tenants WHERE id='95cdd7a0-7124-46e8-bbb8-d6cbf58b9b0d') THEN RAISE EXCEPTION 'fixture exists; inspect before replay'; END IF;
 IF NOT EXISTS(SELECT 1 FROM genie_memberships m JOIN genie_users u ON u.id=m.user_id
   WHERE m.user_id='00806ac8-a336-45ff-a79e-ae578b489609' AND m.tenant_id='6d83d9a9-2f2f-4d3e-9c40-3131335f2025'
   AND m.status='active' AND m.role='admin' AND u.enabled) THEN RAISE EXCEPTION 'owner baseline changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM genie_memberships m JOIN genie_users u ON u.id=m.user_id
   WHERE m.user_id='378430ab-a834-40cb-b3c8-aa12dfffffa6' AND m.tenant_id='6d83d9a9-2f2f-4d3e-9c40-3131335f2025'
   AND m.status='disabled' AND m.role='member' AND u.enabled) THEN RAISE EXCEPTION 'QA baseline changed'; END IF;
 IF (SELECT count(*) FROM genie_migrations WHERE name IN ('008_workspace_sessions.sql','009_workspace_conversations_search.sql'))<>2
 THEN RAISE EXCEPTION 'reviewed workspace migrations required'; END IF;
END $$;
INSERT INTO genie_tenants(id,enabled,display_name) VALUES('95cdd7a0-7124-46e8-bbb8-d6cbf58b9b0d',true,'Genie QA Workspace B');
INSERT INTO genie_memberships(user_id,tenant_id,status,review_reference,role) VALUES
 ('00806ac8-a336-45ff-a79e-ae578b489609','95cdd7a0-7124-46e8-bbb8-d6cbf58b9b0d','active','GENIE-5 approved synthetic second workspace owner','admin'),
 ('378430ab-a834-40cb-b3c8-aa12dfffffa6','95cdd7a0-7124-46e8-bbb8-d6cbf58b9b0d','active','GENIE-5 approved synthetic second workspace QA','member');
INSERT INTO genie_workspace_people(tenant_id,user_id,display_name,review_reference) VALUES
 ('95cdd7a0-7124-46e8-bbb8-d6cbf58b9b0d','00806ac8-a336-45ff-a79e-ae578b489609','Genie QA B Owner','GENIE-5 reviewed synthetic resource'),
 ('95cdd7a0-7124-46e8-bbb8-d6cbf58b9b0d','378430ab-a834-40cb-b3c8-aa12dfffffa6','Genie QA B Member','GENIE-5 reviewed synthetic resource');
COMMIT;
