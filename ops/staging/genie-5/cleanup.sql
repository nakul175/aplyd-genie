-- Approved synthetic workspace cleanup only. Keep test data and audit history.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('genie-membership:95cdd7a0-7124-46e8-bbb8-d6cbf58b9b0d',0));
DO $$ BEGIN
 IF current_database()<>'genie_staging' THEN RAISE EXCEPTION 'staging database required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM genie_tenants WHERE id='95cdd7a0-7124-46e8-bbb8-d6cbf58b9b0d' AND display_name='Genie QA Workspace B')
 OR (SELECT count(*) FROM genie_memberships WHERE tenant_id='95cdd7a0-7124-46e8-bbb8-d6cbf58b9b0d')<>2
 OR EXISTS(SELECT 1 FROM genie_memberships WHERE tenant_id='95cdd7a0-7124-46e8-bbb8-d6cbf58b9b0d'
   AND user_id NOT IN ('00806ac8-a336-45ff-a79e-ae578b489609','378430ab-a834-40cb-b3c8-aa12dfffffa6'))
 THEN RAISE EXCEPTION 'synthetic fixture identity boundary changed'; END IF;
END $$;
UPDATE genie_tenants SET enabled=false WHERE id='95cdd7a0-7124-46e8-bbb8-d6cbf58b9b0d';
WITH changed AS (
 UPDATE genie_memberships SET status='disabled',version=version+1
 WHERE tenant_id='95cdd7a0-7124-46e8-bbb8-d6cbf58b9b0d' AND status='active' RETURNING tenant_id,user_id,role
)
INSERT INTO genie_membership_audit(tenant_id,actor_id,target_id,action,before_state,after_state)
SELECT tenant_id,'00806ac8-a336-45ff-a79e-ae578b489609',user_id,'deactivated',
 jsonb_build_object('status','active','role',role),
 jsonb_build_object('status','disabled','role',role,'via','GENIE-5 owner-approved operator fixture cleanup') FROM changed;
DELETE FROM genie_sessions WHERE tenant_id='95cdd7a0-7124-46e8-bbb8-d6cbf58b9b0d';
COMMIT;
