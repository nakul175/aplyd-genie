from pathlib import Path
import datetime,json,subprocess,uuid
base=Path('/opt/aplyd-genie-staging')
private=base/'private'
release=(base/'current').resolve()
assert release.name=='f053827'
psql=['docker','exec','-i','aplyd-genie-staging-database-1','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','genie_migrator','-d','genie_staging']
def sql(query):
 return subprocess.check_output(psql+['-c',query],text=True).strip()
a='6d83d9a9-2f2f-4d3e-9c40-3131335f2025'
b='95cdd7a0-7124-46e8-bbb8-d6cbf58b9b0d'
qa='378430ab-a834-40cb-b3c8-aa12dfffffa6'
owner='00806ac8-a336-45ff-a79e-ae578b489609'
report_path=private/'genie5-live-acceptance.json'
report=json.loads(report_path.read_text())
assert report['status']=='functional_checks_passed_cleanup_pending' and all(c['passed'] for c in report['checks'])
for key,status in [('completed_job_id','completed'),('denied_job_id','denied')]:
 job=str(uuid.UUID(report[key]))
 assert sql(f"SELECT tenant_id||':'||status FROM genie_member_exports WHERE id='{job}' AND creator_id='{qa}'")==f'{a}:{status}'
assert sql(f"SELECT status||':'||role FROM genie_memberships WHERE user_id='{qa}' AND tenant_id='{a}'")=='disabled:member'
assert sql(f"SELECT count(*) FROM genie_member_roles WHERE user_id='{qa}'")== '0'
assert sql("SELECT count(*) FROM genie_role_permissions p JOIN genie_roles r ON r.id=p.role_id WHERE r.name='GENIE-5 QA Reader'")== '0'
with (release/'ops/staging/genie-5/cleanup.sql').open('rb') as source:
 subprocess.run(psql,stdin=source,stdout=subprocess.DEVNULL,check=True)
assert sql(f"SELECT enabled FROM genie_tenants WHERE id='{b}'")=='f'
assert sql(f"SELECT count(*) FROM genie_memberships WHERE tenant_id='{b}' AND status='active'")=='0'
assert sql(f"SELECT count(*) FROM genie_sessions WHERE tenant_id='{b}' OR user_id='{qa}'")=='0'
assert sql(f"SELECT status||':'||role FROM genie_memberships WHERE user_id='{owner}' AND tenant_id='{a}'")=='active:admin'
assert sql(f"SELECT count(*) FROM genie_member_exports WHERE (creator_id='{qa}' OR tenant_id='{b}') AND status IN ('queued','running')")=='0'
assert sql("SELECT has_function_privilege('genie_export_worker','genie_search_workspace(text,text)','execute')")=='f'
assert sql("SELECT has_function_privilege('genie_runtime','genie_claim_member_export()','execute')")=='f'
report['status']='passed'
report['verified_at']=datetime.datetime.now(datetime.timezone.utc).isoformat()
report['cleanup']={'workspace_b_disabled':True,'workspace_b_active_memberships':0,'qa_sessions':0,'qa_role_assignments':0,'temporary_grants':0,'pending_fixture_exports':0,'original_owner_active':True,'completed_and_denied_jobs_bound_to_a':True}
report_path.write_text(json.dumps(report,indent=2)+'\n')
receipt_path=base/'DEPLOYED.json'
receipt=json.loads(receipt_path.read_text())
assert receipt['revision']==report['revision']
receipt.update(status='GENIE-5 accepted staging; merge pending',acceptance_checks=len(report['checks']),cleanup=report['cleanup'])
receipt_path.write_text(json.dumps(receipt,indent=2)+'\n')
print('GENIE5_CLEANUP_VERIFIED')
print('SANITIZED_REPORT='+json.dumps(report,separators=(',',':')))
