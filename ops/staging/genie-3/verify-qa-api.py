#!/usr/bin/env python3
"""Real credential/OIDC API acceptance. No browser browser-cookie lookup or session exports."""
import http.cookiejar, json, signal, ssl, sys, urllib.error, urllib.parse, urllib.request
from pathlib import Path
SOURCE='https://sheethappensofficer.aplyd.org'; ACCOUNTS='https://accounts.aplyd.org'; GENIE='https://staging.genie.aplyd.org'
ALLOWED={SOURCE,ACCOUNTS,GENIE}
ROOT=Path('/opt/aplyd-genie-staging/private')
REPORT=ROOT/'genie3-qa-api-acceptance.json'
class QualificationError(Exception):pass
class BoundRedirect(urllib.request.HTTPRedirectHandler):
 max_redirections=20
 def redirect_request(self,req,fp,code,msg,headers,newurl):
  u=urllib.parse.urlsplit(newurl)
  if u.scheme+'://'+u.netloc not in ALLOWED:raise QualificationError('unexpected_redirect_destination')
  return super().redirect_request(req,fp,code,msg,headers,newurl)
jar=http.cookiejar.CookieJar()
client=urllib.request.build_opener(BoundRedirect(),urllib.request.HTTPCookieProcessor(jar),urllib.request.HTTPSHandler(context=ssl.create_default_context()))
client.addheaders=[('User-Agent','Aplyd-Genie-approved-staging-acceptance/1.0')]
report={'story':'GENIE-3','method':'real HTTPS password login and server-handled Accounts OIDC; in-memory standard cookie jar','checks':[],'status':'running'}
def save():
 import os
 fd=os.open(REPORT,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
 with os.fdopen(fd,'w') as f:json.dump(report,f,indent=2);f.write('\n')
def check(name,condition,status=None):
 report['checks'].append({'name':name,'passed':bool(condition),**({'http_status':status} if status is not None else {})});save()
 if not condition:raise QualificationError(name)
def request(origin,path,payload=None):
 if origin not in ALLOWED or not path.startswith('/'):raise QualificationError('invalid_request_destination')
 headers={'Accept':'application/json'}
 data=None
 if payload is not None:headers.update({'Content-Type':'application/json','Origin':origin});data=json.dumps(payload).encode()
 req=urllib.request.Request(origin+path,data=data,headers=headers)
 try:
  with client.open(req,timeout=20) as r:return r.status,r.read(1024*1024)
 except urllib.error.HTTPError as e:return e.code,e.read(16384)
def object_body(raw):
 try:return json.loads(raw)
 except ValueError:return {}
def main():
 signal.alarm(600)
 fixture=json.loads((ROOT/'genie3-qa-login.json').read_text())
 assert fixture['name']=='Genie Staging QA Member' and fixture['email']=='genie.qa.member@aplyd.org'
 assert fixture['user_id']=='378430ab-a834-40cb-b3c8-aa12dfffffa6'
 status,raw=request(SOURCE,'/api/auth/signin',{'email':fixture['email'],'password':fixture['password']})
 user=object_body(raw).get('user',{})
 check('normal_password_login_exact_synthetic_upstream_identity',status==200 and user.get('id')==fixture['upstream_user_id'] and user.get('orgRole')=='MEMBER',status)
 # Standard HTTPS redirects and cookies perform the actual code/PKCE flow.
 # No direct token exchange, server-side session insertion, stored-session lookup or auth mocking.
 status,raw=request(GENIE,'/auth/sign-in')
 check('real_accounts_oidc_reaches_protected_workspace',status==200 and b'Aplyd Genie workspace' in raw,status)
 status,raw=request(GENIE,'/api/auth/session');session=object_body(raw)
 check('authenticated_genie_identity_and_tenant_match_reviewed_fixture',status==200 and session.get('authenticated') is True and session.get('userId')==fixture['user_id'] and session.get('tenantId')==fixture['tenant_id'],status)
 status,raw=request(GENIE,'/api/workspace/members')
 check('ordinary_member_administrator_read_denied',status==403 and object_body(raw).get('error')=='administrator_required',status)
 actions={'change':{'target':fixture['user_id'],'status':'disabled','role':'member','version':'1'},'invite':{'target':fixture['user_id'],'role':'member'},'revoke':{'invitationId':'00000000-0000-4000-8000-000000000000'}}
 for action,payload in actions.items():
  status,raw=request(GENIE,'/api/workspace/members/'+action,payload)
  check('ordinary_member_'+action+'_denied',status==403 and object_body(raw).get('error')=='administrator_required',status)
 report['status']='ordinary_checks_passed_waiting_for_owner_ui_deactivation';save()
 print('ORDINARY_API_CHECKS_PASSED; use owner UI to deactivate dedicated QA member, then enter DEACTIVATED',flush=True)
 if input().strip()!='DEACTIVATED':raise QualificationError('operator_deactivation_confirmation_missing')
 for path in ('/api/auth/session','/workspace','/api/workspace/members'):
  status,raw=request(GENIE,path)
  check('deactivated_member_read_denied_'+path,status==401 and (object_body(raw).get('error')=='authentication_required' or path=='/workspace'),status)
 for action,payload in actions.items():
  status,raw=request(GENIE,'/api/workspace/members/'+action,payload)
  check('deactivated_member_'+action+'_denied',status==401 and object_body(raw).get('error')=='authentication_required',status)
 report['status']='passed';save();print('GENIE3_REAL_API_ACCEPTANCE_PASSED',len(report['checks']),'checks; no route changes, mock authentication, browser-cookie lookup or session exports',flush=True)
try:main()
except Exception as e:
 report['status']='failed';report['failure_class']=type(e).__name__
 if isinstance(e,QualificationError):report['failed_check']=str(e)
 save();print('GENIE3_API_ACCEPTANCE_FAILED',report.get('failed_check',report['failure_class']),flush=True);sys.exit(1)
