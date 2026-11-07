from pathlib import Path
import datetime,json,os,subprocess
base=Path('/opt/aplyd-genie-staging');private=base/'private'
assert (base/'current').resolve().name=='1e74e5e'
def sql(query):return subprocess.check_output(['docker','exec','aplyd-genie-staging-database-1','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','genie_migrator','-d','genie_staging','-c',query],text=True).strip()
qa='378430ab-a834-40cb-b3c8-aa12dfffffa6';tenant='6d83d9a9-2f2f-4d3e-9c40-3131335f2025'
assert sql("SELECT status||':'||role FROM genie_memberships WHERE user_id='"+qa+"' AND tenant_id='"+tenant+"'")=='disabled:member'
assert sql("SELECT count(*) FROM genie_sessions WHERE user_id='"+qa+"'")=='0'
assert sql("SELECT count(*) FROM genie_member_roles WHERE user_id='"+qa+"'")=='0'
assert sql("SELECT count(*) FROM genie_role_permissions p JOIN genie_roles r ON r.id=p.role_id WHERE r.name LIKE 'GENIE-4 QA %'")=='0'
assert sql("SELECT count(*) FROM genie_permission_audit WHERE tenant_id='"+tenant+"'")=='15'
assert sql("SELECT count(*) FROM genie_permission_audit WHERE tenant_id='"+tenant+"' AND actor_id='"+qa+"' AND action IN ('role_created','role_assigned')")=='2'
assert sql("SELECT count(*) FROM genie_permission_audit WHERE tenant_id='"+tenant+"' AND action='role_created' AND after_state->>'name' LIKE 'GENIE-4 Forbidden%'")=='0'
assert sql("SELECT count(*) FROM genie_member_exports WHERE status IN ('queued','running')")=='0'
assert sql("SELECT has_function_privilege('genie_runtime','genie_claim_member_export()','execute')")=='f'
assert sql("SELECT has_table_privilege('genie_export_worker','genie_member_exports','select')")=='f'
assert sql("SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname='genie_export_worker'")=='f'
assert (private/'export-worker.env').stat().st_mode&0o777==0o600
report=json.loads((private/'genie4-live-acceptance.json').read_text());assert report['status']=='passed' and len(report['checks'])==35 and all(c['passed'] for c in report['checks'])
report['verified_at']=datetime.datetime.now(datetime.timezone.utc).isoformat()
report['cleanup']={'qa_disabled_ordinary_member':True,'qa_sessions':0,'qa_role_assignments':0,'temporary_role_grants':0,'pending_exports':0,'policy_audit_records':15,'qa_delegation_audit_records':2,'forbidden_role_creations':0,'worker_credential_mode':'0600','worker_cannot_read_job_table':True,'app_cannot_claim_jobs':True,'worker_superuser_or_role_admin':False}
(private/'genie4-live-acceptance.json').write_text(json.dumps(report,indent=2)+'\n')
receipt=json.loads((base/'DEPLOYED.json').read_text());receipt.update({'status':'GENIE-4 accepted staging; merge pending','acceptance_checks':35,'cleanup':'QA disabled/member, zero sessions/assignments/grants; no pending exports; 15 policy audit events verified; worker isolated; no persistent worker activated'})
(base/'DEPLOYED.json').write_text(json.dumps(receipt,indent=2)+'\n')
print('GENIE4_FINAL_SQL_VERIFIED')
print('SANITIZED_REPORT='+json.dumps(report,separators=(',',':')))
