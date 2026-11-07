from pathlib import Path
import subprocess,json
base=Path('/opt/aplyd-genie-staging')
release=(base/'current').resolve()
assert release.name=='f053827'
a='6d83d9a9-2f2f-4d3e-9c40-3131335f2025'
b='95cdd7a0-7124-46e8-bbb8-d6cbf58b9b0d'
qa='378430ab-a834-40cb-b3c8-aa12dfffffa6'
owner='00806ac8-a336-45ff-a79e-ae578b489609'
psql=['docker','exec','-i','aplyd-genie-staging-database-1','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','genie_migrator','-d','genie_staging']
def apply(query):
 subprocess.run(psql,input=query,text=True,stdout=subprocess.DEVNULL,check=True)
locks=f"""BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('genie-membership:{a}',0));
SELECT pg_advisory_xact_lock(hashtextextended('genie-membership:{b}',0));
"""
apply(locks+f"""
DO $$ BEGIN
 IF current_database()<>'genie_staging' OR
 (SELECT count(*) FROM genie_tenants WHERE id IN ('{a}','{b}') AND enabled)<>2 OR
 (SELECT count(*) FROM genie_memberships WHERE tenant_id IN ('{a}','{b}') AND user_id='{owner}' AND status='active' AND role='admin')<>2 OR
 (SELECT count(*) FROM genie_memberships WHERE user_id='{qa}' AND role='member' AND
 ((tenant_id='{a}' AND status='disabled') OR (tenant_id='{b}' AND status='active')))<>2 OR
 EXISTS(SELECT 1 FROM genie_member_roles WHERE user_id='{qa}') OR
 EXISTS(SELECT 1 FROM genie_roles WHERE tenant_id IN ('{a}','{b}') AND lower(name)='genie-5 qa reader') OR
 EXISTS(SELECT 1 FROM genie_member_exports WHERE status IN ('queued','running'))
 THEN RAISE EXCEPTION 'fixture baseline changed'; END IF;
END $$;
UPDATE genie_memberships SET status='active',version=version+1 WHERE tenant_id='{a}' AND user_id='{qa}';
INSERT INTO genie_membership_audit(tenant_id,actor_id,target_id,action,before_state,after_state)
VALUES('{a}','{owner}','{qa}','reactivated','{{"status":"disabled","role":"member"}}',
 '{{"status":"active","role":"member","via":"GENIE-5 owner-approved operator fixture"}}');
INSERT INTO genie_roles(tenant_id,name) SELECT id,'GENIE-5 QA Reader' FROM genie_tenants WHERE id IN ('{a}','{b}');
INSERT INTO genie_role_permissions SELECT tenant_id,id,'workspace.members','read' FROM genie_roles WHERE tenant_id IN ('{a}','{b}') AND name='GENIE-5 QA Reader';
INSERT INTO genie_member_roles SELECT tenant_id,'{qa}',id FROM genie_roles WHERE tenant_id IN ('{a}','{b}') AND name='GENIE-5 QA Reader';
UPDATE genie_memberships SET version=version+1 WHERE tenant_id IN ('{a}','{b}') AND user_id='{qa}';
INSERT INTO genie_permission_audit(tenant_id,actor_id,role_id,action,before_state,after_state)
SELECT tenant_id,'{owner}',id,'role_created','{{"name":null,"grants":[]}}',
 '{{"name":"GENIE-5 QA Reader","grants":[{{"resource":"workspace.members","action":"read"}}],"via":"GENIE-5 owner-approved operator fixture"}}'
FROM genie_roles WHERE tenant_id IN ('{a}','{b}') AND name='GENIE-5 QA Reader';
INSERT INTO genie_permission_audit(tenant_id,actor_id,role_id,target_id,action,before_state,after_state)
SELECT tenant_id,'{owner}',id,'{qa}','role_assigned','{{"assigned":false}}','{{"assigned":true,"via":"GENIE-5 owner-approved operator fixture"}}'
FROM genie_roles WHERE tenant_id IN ('{a}','{b}') AND name='GENIE-5 QA Reader';
COMMIT;
""")
print('GENIE5_TEMPORARY_QA_READY',flush=True)
try:
 exec(compile(ACCEPTANCE_SOURCE,'genie-5-acceptance.py','exec'),{})
finally:
 apply(locks+f"""
 WITH removed AS (
 DELETE FROM genie_member_roles m USING genie_roles r WHERE m.role_id=r.id AND m.tenant_id=r.tenant_id
 AND m.user_id='{qa}' AND r.tenant_id IN ('{a}','{b}') AND r.name='GENIE-5 QA Reader' RETURNING m.tenant_id,m.role_id
 )
 INSERT INTO genie_permission_audit(tenant_id,actor_id,role_id,target_id,action,before_state,after_state)
 SELECT tenant_id,'{owner}',role_id,'{qa}','role_unassigned','{{"assigned":true}}',
 '{{"assigned":false,"via":"GENIE-5 owner-approved operator cleanup"}}' FROM removed;
 WITH removed AS (
 DELETE FROM genie_role_permissions p USING genie_roles r WHERE p.role_id=r.id AND p.tenant_id=r.tenant_id
 AND r.tenant_id IN ('{a}','{b}') AND r.name='GENIE-5 QA Reader' AND p.resource='workspace.members' AND p.action='read'
 RETURNING p.tenant_id,p.role_id
 )
 INSERT INTO genie_permission_audit(tenant_id,actor_id,role_id,action,before_state,after_state)
 SELECT tenant_id,'{owner}',role_id,'role_updated','{{"name":"GENIE-5 QA Reader","grants":[{{"resource":"workspace.members","action":"read"}}]}}',
 '{{"name":"GENIE-5 QA Reader","grants":[],"via":"GENIE-5 owner-approved operator cleanup"}}' FROM removed;
 UPDATE genie_roles SET version=version+1 WHERE tenant_id IN ('{a}','{b}') AND name='GENIE-5 QA Reader';
 WITH changed AS (
 UPDATE genie_memberships SET status='disabled',version=version+1 WHERE tenant_id='{a}' AND user_id='{qa}' AND status='active' AND role='member'
 RETURNING user_id)
 INSERT INTO genie_membership_audit(tenant_id,actor_id,target_id,action,before_state,after_state)
 SELECT '{a}','{owner}',user_id,'deactivated','{{"status":"active","role":"member"}}',
 '{{"status":"disabled","role":"member","via":"GENIE-5 owner-approved operator cleanup"}}' FROM changed;
 DELETE FROM genie_sessions WHERE user_id='{qa}' AND tenant_id IN ('{a}','{b}');
 COMMIT;
 """)
 with (release/'ops/staging/genie-5/cleanup.sql').open('rb') as source:
  subprocess.run(psql,stdin=source,stdout=subprocess.DEVNULL,check=True)
 print('GENIE5_FIXTURE_ACCESS_REMOVED',flush=True)
