import http.cookiejar,json,os,signal,ssl,subprocess,sys,urllib.error,urllib.parse,urllib.request
from pathlib import Path
SOURCE='https://sheethappensofficer.aplyd.org';ACCOUNTS='https://accounts.aplyd.org';GENIE='https://staging.genie.aplyd.org';ALLOWED={SOURCE,ACCOUNTS,GENIE}
ROOT=Path('/opt/aplyd-genie-staging/private');REPORT=ROOT/'genie4-live-acceptance.json';base=ROOT.parent
class Failure(Exception):pass
class Redirect(urllib.request.HTTPRedirectHandler):
 max_redirections=20
 def redirect_request(self,req,fp,code,msg,headers,newurl):
  u=urllib.parse.urlsplit(newurl)
  if u.scheme+'://'+u.netloc not in ALLOWED:raise Failure('unexpected_redirect')
  return super().redirect_request(req,fp,code,msg,headers,newurl)
jar=http.cookiejar.CookieJar();client=urllib.request.build_opener(Redirect(),urllib.request.HTTPCookieProcessor(jar),urllib.request.HTTPSHandler(context=ssl.create_default_context()))
report={'story':'GENIE-4','revision':'1e74e5e0fa5138d812c71f0bf06257c67fd2a9ba','method':'normal HTTPS password/Accounts OIDC, in-memory cookies; normal owner UI; isolated real worker','checks':[],'status':'running'}
def save():
 fd=os.open(REPORT,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
 with os.fdopen(fd,'w') as f:json.dump(report,f,indent=2);f.write('\n')
def check(name,condition,status=None):
 report['checks'].append({'name':name,'passed':bool(condition),**({'http_status':status} if status is not None else {})});save()
 if not condition:raise Failure(name)
def request(path,payload=None,origin=GENIE):
 assert origin in ALLOWED and path.startswith('/')
 headers={'Accept':'application/json'};data=None
 if payload is not None:headers.update({'Origin':origin,'Content-Type':'application/json'});data=json.dumps(payload).encode()
 try:
  with client.open(urllib.request.Request(origin+path,data=data,headers=headers),timeout=20) as r:return r.status,r.read(2_000_000)
 except urllib.error.HTTPError as e:return e.code,e.read(16384)
def obj(raw):
 try:return json.loads(raw)
 except ValueError:return {}
def wait(phase):
 report['status']='waiting_'+phase;save();print('WAIT_'+phase,flush=True)
 if input().strip()!=phase:raise Failure('missing_operator_'+phase)
 report['status']='running';save()
def denied(name,path,payload=None,status=403):
 code,raw=request(path,payload);check(name,code==status,code)
def worker(expected):
 cmd=['docker','run','--rm','--network','host','--memory','256m','--cpus','0.5','--user','1000:1000','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--env-file',str(ROOT/'export-worker.env'),'-v',str((base/'current').resolve())+':/app:ro','-w','/app','node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9','node','src/export-worker.mjs','--once']
 r=subprocess.run(cmd,capture_output=True,text=True,timeout=45)
 check('real_worker_'+expected,r.returncode==0 and 'genie_export_'+expected in r.stdout)
def main():
 signal.alarm(2400);fixture=json.loads((ROOT/'genie3-qa-login.json').read_text());qa=fixture['user_id']
 assert fixture['name']=='Genie Staging QA Member' and fixture['email']=='genie.qa.member@aplyd.org'
 code,raw=request('/api/auth/signin',{'email':fixture['email'],'password':fixture['password']},SOURCE)
 check('real_password_login_exact_ordinary_upstream_identity',code==200 and obj(raw).get('user',{}).get('id')==fixture['upstream_user_id'] and obj(raw).get('user',{}).get('orgRole')=='MEMBER',code)
 code,raw=request('/auth/sign-in');check('real_accounts_oidc_workspace',code==200 and b'Aplyd Genie workspace' in raw,code)
 code,raw=request('/api/auth/session');check('exact_genie_qa_identity_and_tenant',code==200 and obj(raw).get('userId')==qa and obj(raw).get('tenantId')==fixture['tenant_id'],code)
 denied('ordinary_member_read_denied','/api/workspace/members');denied('ordinary_member_export_denied','/api/workspace/member-exports',{})
 wait('READER')
 code,raw=request('/workspace/members');check('reader_ui_has_members_without_mutation_controls',code==200 and b'Genie Staging QA Member' in raw and b'Save membership' not in raw,code)
 code,raw=request('/api/workspace/members');check('reader_api_allowed',code==200 and len(obj(raw).get('page',{}).get('items',[]))>=2,code)
 code,raw=request('/api/tools/members.list',{});check('reader_registered_tool_allowed',code==200,code)
 change={'target':qa,'status':'disabled','role':'member','version':'1'}
 denied('reader_direct_mutation_denied','/api/workspace/members/change',change);denied('reader_tool_mutation_denied','/api/tools/members.change',change)
 denied('reader_cannot_manage_roles','/api/workspace/roles/save',{'name':'GENIE-4 Forbidden','grants':[]})
 code,raw=request('/api/workspace/member-exports',{'userId':'00000000-0000-4000-8000-000000000000'});job=obj(raw).get('id');check('reader_queued_server_scoped_export',code==202 and bool(job) and sorted(obj(raw))==['id','status'],code)
 report['denied_job_id']=job;save();wait('REMOVE_READER')
 denied('same_session_read_lost','/api/workspace/members');denied('same_session_tool_lost','/api/tools/members.list',{})
 code,raw=request('/workspace');check('same_session_navigation_updates',code==200 and b'/workspace/members' not in raw,code)
 worker('denied');denied('revoked_export_result_denied','/api/workspace/member-exports/'+job)
 wait('RESTORE_READER')
 code,raw=request('/api/workspace/member-exports/'+job);check('revoked_queued_job_is_denied_without_result',code==200 and obj(raw).get('status')=='denied' and obj(raw).get('result') is None,code)
 code,raw=request('/api/workspace/member-exports',{});completed=obj(raw).get('id');check('restored_reader_can_queue',code==202 and bool(completed),code)
 worker('completed');code,raw=request('/api/workspace/member-exports/'+completed)
 check('completed_export_visible_to_creator',code==200 and obj(raw).get('status')=='completed' and len(obj(raw).get('result',{}).get('items',[]))>=2,code)
 check('completed_export_has_no_internal_principal_or_lease',not any(key in raw.decode() for key in ['sessionHash','sealed_upstream','lease','session_hash']))
 report['completed_job_id']=completed;save();wait('REMOVE_COMPLETED')
 denied('completed_export_access_lost_on_same_session','/api/workspace/member-exports/'+completed)
 wait('STEWARD')
 code,raw=request('/workspace/roles');check('steward_ui_only_own_grants_available',code==200 and b'Create role' in raw,code)
 denied('steward_cannot_grant_membership_mutation','/api/workspace/roles/save',{'name':'GENIE-4 Forbidden escalation','grants':[{'resource':'workspace.members','action':'manage'}]})
 denied('steward_cannot_grant_invitations','/api/workspace/roles/save',{'name':'GENIE-4 Forbidden invitations','grants':[{'resource':'workspace.invitations','action':'create'}]})
 denied('steward_cannot_mutate_administrator','/api/workspace/members/change',{'target':'00806ac8-a336-45ff-a79e-ae578b489609','role':'member','status':'disabled','version':'1'})
 denied('steward_browser_claims_do_not_grant_authority','/api/tools/members.change',dict(change,userId='00806ac8-a336-45ff-a79e-ae578b489609',role='admin',permissions=['*']))
 code,raw=request('/api/workspace/roles/save',{'name':'GENIE-4 QA Delegated Reader','grants':[{'resource':'workspace.members','action':'read'}]});narrow=obj(raw).get('id');check('steward_can_create_narrow_role',code==200 and bool(narrow),code)
 code,raw=request('/api/workspace/members');version=next(x['version'] for x in obj(raw)['page']['items'] if x['userId']==qa)
 code,raw=request('/api/workspace/roles/assign',{'target':qa,'roleId':narrow,'assigned':True,'version':version});check('steward_can_assign_narrow_role',code==200,code)
 report['delegated_role_id']=narrow;save();wait('STRONGER_ROLE')
 code,raw=request('/api/workspace/roles');roles=obj(raw).get('page',{}).get('items',[]);strong=next(x for x in roles if x['name']=='GENIE-4 QA Reader')
 denied('steward_cannot_edit_stronger_existing_role','/api/workspace/roles/save',{'roleId':strong['id'],'version':strong['version'],'name':'GENIE-4 QA Reader','grants':[]})
 code,raw=request('/api/workspace/members');version=next(x['version'] for x in obj(raw)['page']['items'] if x['userId']==qa)
 denied('steward_cannot_assign_stronger_role','/api/workspace/roles/assign',{'target':qa,'roleId':strong['id'],'assigned':True,'version':version})
 report['status']='functional_checks_passed_waiting_cleanup';save();wait('CLEANUP')
 for path in ['/api/auth/session','/workspace','/api/tools/members.list']:
  denied('cleanup_revokes_qa_session_'+path,path,{} if path.startswith('/api/tools') else None,401)
 report['status']='passed';save();print('GENIE4_LIVE_ACCEPTANCE_PASSED',len(report['checks']),'checks',flush=True)
try:main()
except Exception as error:
 report['status']='failed';report['failure_class']=type(error).__name__
 if isinstance(error,Failure):report['failed_check']=str(error)
 save();print('GENIE4_LIVE_ACCEPTANCE_FAILED',report.get('failed_check',report['failure_class']),flush=True);sys.exit(1)
