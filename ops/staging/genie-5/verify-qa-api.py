import copy,http.cookiejar,json,os,signal,ssl,subprocess,sys,urllib.error,urllib.parse,urllib.request
from pathlib import Path
SOURCE='https://sheethappensofficer.aplyd.org';ACCOUNTS='https://accounts.aplyd.org';GENIE='https://staging.genie.aplyd.org';ALLOWED={SOURCE,ACCOUNTS,GENIE}
BASE=Path('/opt/aplyd-genie-staging');PRIVATE=BASE/'private';REPORT=PRIVATE/'genie5-live-acceptance.json'
A='6d83d9a9-2f2f-4d3e-9c40-3131335f2025';B='95cdd7a0-7124-46e8-bbb8-d6cbf58b9b0d'
REV='f05382771e6343d5c217a1212a64509919df890e'
class Failure(Exception):pass
class Redirect(urllib.request.HTTPRedirectHandler):
 max_redirections=20
 def redirect_request(self,req,fp,code,msg,headers,newurl):
  u=urllib.parse.urlsplit(newurl)
  if u.scheme+'://'+u.netloc not in ALLOWED:raise Failure('unexpected_redirect')
  return super().redirect_request(req,fp,code,msg,headers,newurl)
def opener(jar):return urllib.request.build_opener(Redirect(),urllib.request.HTTPCookieProcessor(jar),urllib.request.HTTPSHandler(context=ssl.create_default_context()))
jar=http.cookiejar.CookieJar();client=opener(jar)
report={'story':'GENIE-5','revision':REV,'method':'normal HTTPS password and Accounts OIDC; native workspace forms; persisted conversations and real worker; in-memory cookies only','checks':[],'status':'running'}
def save():
 fd=os.open(REPORT,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
 with os.fdopen(fd,'w') as f:json.dump(report,f,indent=2);f.write('\n')
def check(name,ok,status=None):
 report['checks'].append({'name':name,'passed':bool(ok),**({'http_status':status} if status is not None else {})});save()
 if not ok:raise Failure(name)
def request(path,payload=None,*,form=False,origin=GENIE,transport=client):
 assert origin in ALLOWED and path.startswith('/')
 headers={'Accept':'application/json'};data=None
 if payload is not None:
  headers.update({'Origin':origin,'Content-Type':'application/x-www-form-urlencoded' if form else 'application/json'})
  data=(urllib.parse.urlencode(payload) if form else json.dumps(payload)).encode()
 try:
  with transport.open(urllib.request.Request(origin+path,data=data,headers=headers),timeout=20) as r:return r.status,r.read(2_000_000)
 except urllib.error.HTTPError as e:return e.code,e.read(16384)
def obj(raw):
 try:return json.loads(raw)
 except ValueError:return {}
def expect(name,path,status,payload=None,**kwargs):
 actual,raw=request(path,payload,**kwargs);check(name,actual==status,actual);return raw
def worker(expected):
 cmd=['docker','run','--rm','--network','host','--memory','256m','--cpus','0.5','--user','1000:1000','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--env-file',str(PRIVATE/'export-worker.env'),'-v',str((BASE/'current').resolve())+':/app:ro','-w','/app','node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9','node','src/export-worker.mjs','--once']
 r=subprocess.run(cmd,capture_output=True,text=True,timeout=45);check('real_worker_'+expected,r.returncode==0 and 'genie_export_'+expected in r.stdout)
def main():
 signal.alarm(600);assert (BASE/'current').resolve().name==REV[:7]
 qa=json.loads((PRIVATE/'genie3-qa-login.json').read_text());assert qa['name']=='Genie Staging QA Member' and qa['tenant_id']==A
 raw=expect('normal_qa_password_login','/api/auth/signin',200,{'email':qa['email'],'password':qa['password']},origin=SOURCE)
 check('exact_synthetic_upstream_member',obj(raw).get('user',{}).get('id')==qa['upstream_user_id'] and obj(raw).get('user',{}).get('orgRole')=='MEMBER')
 raw=expect('normal_oidc_chooser','/auth/sign-in',200)
 check('both_workspaces_visible_without_silent_choice',b'Choose a workspace' in raw and b'Genie QA Workspace B' in raw and b'Aplyd Genie workspace' not in raw)
 expect('no_session_before_explicit_choice','/api/auth/session',401)
 raw=expect('native_initial_choice_a','/auth/workspace',200,{'tenantId':A},form=True)
 check('active_workspace_a_visible',b'Active workspace: <strong>Workspace</strong>' in raw)
 raw=expect('exact_qa_identity_and_a_context','/api/auth/session',200)
 check('qa_identity_matches_reviewed_fixture',obj(raw)=={'authenticated':True,'userId':qa['user_id'],'tenantId':A})
 expect('foreign_workspace_denied','/api/workspaces/switch',403,{'tenantId':'00000000-0000-4000-8000-000000000000'})
 raw=expect('foreign_switch_did_not_rotate','/api/workspaces',200);check('both_reviewed_choices_only',{x['tenantId'] for x in obj(raw)['items']}=={A,B} and obj(raw)['active']['tenantId']==A)
 ca=obj(expect('create_real_a_conversation','/api/workspace/conversations',201,{'title':'GENIE-5 fixture A','content':'Synthetic conversation A','tenantId':B,'ownerId':'forged'}))['id']
 expect('append_real_a_message','/api/workspace/conversations/'+ca+'/messages',201,{'content':'Synthetic follow-up A'})
 raw=expect('a_search_resource','/api/workspace/search?q=Workspace%20owner',200);check('a_has_only_a_member_label',[x['label'] for x in obj(raw)['items']]==['Workspace owner'])
 job=obj(expect('queue_actual_export_in_a','/api/workspace/member-exports',202,{'tenantId':B}))['id']
 # Copy only the harness's own in-memory cookie objects for a single retired-token replay.
 retired=http.cookiejar.CookieJar()
 for item in jar:retired.set_cookie(copy.copy(item))
 raw=expect('native_switch_to_b','/workspace/switch',200,{'tenantId':B},form=True)
 check('active_workspace_b_visible',b'Active workspace: <strong>Genie QA Workspace B</strong>' in raw)
 expect('retired_browser_token_rejected','/api/auth/session',409,transport=opener(retired));retired.clear()
 expect('a_conversation_unavailable_in_b','/api/workspace/conversations/'+ca,404)
 expect('a_conversation_cannot_append_from_b','/api/workspace/conversations/'+ca+'/messages',404,{'content':'Out-of-scope synthetic attempt'})
 raw=expect('no_a_search_result_in_b','/api/workspace/search?q=GENIE-5%20fixture&tenantId='+A,200);check('forged_search_tenant_ignored',obj(raw)['items']==[])
 cb=obj(expect('create_real_b_conversation','/api/workspace/conversations',201,{'title':'GENIE-5 fixture B','content':'Synthetic conversation B','tenantId':A}))['id']
 raw=expect('b_conversation_search','/api/workspace/search?q=GENIE-5%20fixture',200);check('b_search_returns_only_b_conversation',[x['id'] for x in obj(raw)['items']]==[cb])
 raw=expect('b_native_resource_search','/workspace/search?q=Genie%20QA%20B',200);check('b_ui_shows_b_resources_only',b'Genie QA B Owner' in raw and b'Genie QA B Member' in raw and b'Workspace owner' not in raw)
 expect('b_cannot_open_a_queued_job','/api/workspace/member-exports/'+job,404)
 worker('completed');expect('b_cannot_open_a_completed_job','/api/workspace/member-exports/'+job,404)
 expect('switch_back_a','/api/workspaces/switch',200,{'tenantId':A})
 raw=expect('a_opens_original_job_result','/api/workspace/member-exports/'+job,200)
 check('job_completed_only_in_original_a_scope',obj(raw)['status']=='completed' and {x['name'] for x in obj(raw)['result']['items']}=={'Workspace owner','Genie Staging QA Member'})
 expect('b_conversation_unavailable_in_a','/api/workspace/conversations/'+cb,404)
 raw=expect('a_original_conversation_persisted','/api/workspace/conversations/'+ca,200);check('a_messages_unchanged_after_switch',[x['content'] for x in obj(raw)['messages']]==['Synthetic conversation A','Synthetic follow-up A'])
 denied=obj(expect('queue_second_original_job','/api/workspace/member-exports',202,{}))['id']
 expect('switch_before_family_logout','/api/workspaces/switch',200,{'tenantId':B})
 expect('sign_out_browser_family','/auth/sign-out',200,{})
 expect('signed_out_browser_has_no_scope','/api/workspaces',401)
 worker('denied')
 report['completed_job_id']=job;report['denied_job_id']=denied;report['status']='functional_checks_passed_cleanup_pending';save()
 print('GENIE5_LIVE_FUNCTIONAL_CHECKS_PASSED',len(report['checks']),flush=True)
try:main()
except Exception as error:
 report['status']='failed';report['failure_class']=type(error).__name__
 if isinstance(error,Failure):report['failed_check']=str(error)
 save();print('GENIE5_LIVE_ACCEPTANCE_FAILED',report.get('failed_check',report['failure_class']),flush=True);sys.exit(1)
