#!/usr/bin/env python3
"""Approved GENIE-3 synthetic identity only. Dry-run by default; no secret output."""
import argparse, base64, fcntl, getpass, hashlib, json, os, secrets, sqlite3, subprocess, time, urllib.parse, uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');a=p.parse_args()
assert os.geteuid()==0
base=Path('/opt/aplyd-genie-staging/private'); receipt=base/'genie3-qa-login.json'
assert not receipt.exists(), 'Prior provisioning receipt exists; inspect instead of replaying'
locks=[]
for name in ('/run/lock/sho-sso-env-reload.lock','/run/lock/aplyd-genie-staging.lock'):
 f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
pid=subprocess.check_output(['systemctl','show','sho','--property=MainPID','--value'],text=True).strip()
e=dict(x.split('=',1) for x in Path('/proc/'+pid+'/environ').read_text().split('\0') if '=' in x)
u=urllib.parse.urlsplit(e.get('DIRECT_DATABASE_URL') or e['DATABASE_URL'])
assert u.scheme=='postgresql' and u.hostname=='private-sho-db-do-user-45345612-0.k.db.ondigitalocean.com' and u.port==25060 and u.path=='/defaultdb'
assert dict(urllib.parse.parse_qsl(u.query)).get('sslmode') in ('require','verify-ca','verify-full')
pe=os.environ.copy();pe.update(PGHOST=u.hostname,PGPORT=str(u.port or 5432),PGUSER=urllib.parse.unquote(u.username or ''),PGPASSWORD=urllib.parse.unquote(u.password or ''),PGDATABASE=u.path.lstrip('/'),PGSSLMODE=dict(urllib.parse.parse_qsl(u.query))['sslmode'])
def run(cmd,**kwargs):
 r=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,**kwargs)
 if r.returncode: raise RuntimeError('Operator subprocess failed; private review required')
 return r.stdout.decode().strip()
def sho(sql):return run(['psql','-X','-q','-tA','-v','ON_ERROR_STOP=1'],input=sql.encode(),env=pe)
def genie(sql):return run(['docker','exec','-i','aplyd-genie-staging-database-1','psql','-X','-q','-tA','-v','ON_ERROR_STOP=1','-U','genie_migrator','-d','genie_staging'],input=sql.encode())
def lit(x):return "'"+str(x).replace("'","''")+"'"
email='genie.qa.member@aplyd.org';name='Genie Staging QA Member';workspace_name='Genie staging acceptance'
assert email not in [x.strip().lower() for x in e.get('SUPER_ADMIN_EMAILS','').split(',')]
assert sho('SELECT count(*) FROM "User" WHERE email='+lit(email)+' OR name='+lit(name))=='0'
assert sho('SELECT count(*) FROM "Workspace" WHERE name='+lit(workspace_name))=='0'
auth=Path('/opt/sho/current/src/lib/auth.ts').read_text()
assert 'N: 16384, r: 8, p: 1' in auth and 'scrypt(pw, salt, 64' in auth
schema=sho("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='User' AND column_name IN ('id','workspaceId','email','name','passwordHash','emailVerifiedAt','orgRole','tempPasswordAt')")
assert schema=='8'
cfg=json.loads(Path('/home/deploy/aplyd-accounts-stage/private/config.json').read_text())
assert cfg['issuer']=='https://accounts.aplyd.org' and cfg['upstream']['origin']=='https://sheethappensofficer.aplyd.org'
client=next(c for c in cfg['clients'] if c['client_id']=='aplyd-genie-staging')
assert client['redirect_uris']==['https://staging.genie.aplyd.org/auth/callback']
db=sqlite3.connect(cfg['database'],timeout=5)
assert db.execute('SELECT count(*) FROM accounts WHERE email=? OR name=?',(email,name)).fetchone()==(0,)
identity=json.loads((base/'identity.json').read_text());tenant=str(uuid.UUID(identity['tenant_id']));owner=str(uuid.UUID(identity['user_id']))
assert genie("SELECT count(*) FROM genie_memberships WHERE user_id="+lit(owner)+" AND tenant_id="+lit(tenant)+" AND status='active' AND role='admin'")=='1'
if not a.apply:
 print('qa_identity_dry_run_pass: exact identity absent; new workspace absent; live hash/schema/client and administrator verified; no writes');raise SystemExit(0)
password=getpass.getpass('NEW_QA_PASSWORD (hidden): ')
assert 24<=len(password)<=100 and any(c.isupper() for c in password) and any(c.isdigit() for c in password)
record={'email':email,'name':name,'password':password,'upstream_user_id':str(uuid.uuid4()),'upstream_workspace_id':str(uuid.uuid4()),'account_id':str(uuid.uuid4()),'user_id':str(uuid.uuid4()),'tenant_id':tenant,'state':'prepared','approval':'GENIE-3 dedicated QA identity explicitly approved 2026-11-06'}
backup=base/('genie3-new-qa-before-'+str(int(time.time())));backup.mkdir(mode=0o700)
copy=sqlite3.connect(backup/'accounts.sqlite');db.backup(copy);copy.close();os.chmod(backup/'accounts.sqlite',0o600)
for filename,cmd,env in [('upstream-identity.sql',['pg_dump','--data-only','--table=public.User','--table=public.Workspace'],pe),('genie.sql',['docker','exec','aplyd-genie-staging-database-1','pg_dump','-U','genie_migrator','-d','genie_staging'],None)]:
 # Quoted table patterns preserve PostgreSQL mixed-case names.
 if filename=='upstream-identity.sql':cmd=['pg_dump','--data-only','--table=public."User"','--table=public."Workspace"']
 r=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env)
 assert r.returncode==0,'Backup failed'
 fd=os.open(backup/filename,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'wb') as f:f.write(r.stdout)
fd=os.open(receipt,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:json.dump(record,f);f.flush();os.fsync(f.fileno())
def save(state):
 record['state']=state
 with receipt.open('w') as f:json.dump(record,f);f.flush();os.fsync(f.fileno())
salt=secrets.token_bytes(16);key=hashlib.scrypt(password.encode(),salt=salt,n=16384,r=8,p=1,dklen=64,maxmem=64*1024*1024)
hashed='scrypt$'+base64.b64encode(salt).decode()+'$'+base64.b64encode(key).decode()
uid=record['upstream_user_id'];wid=record['upstream_workspace_id'];aid=record['account_id'];gid=record['user_id']
try:
 sho('BEGIN; SELECT pg_advisory_xact_lock(734192801); INSERT INTO "Workspace"(id,name,"createdAt") VALUES ('+lit(wid)+','+lit(workspace_name)+',CURRENT_TIMESTAMP); INSERT INTO "User"(id,"workspaceId",email,name,"passwordHash","emailVerifiedAt","orgRole","createdAt") VALUES ('+','.join(map(lit,[uid,wid,email,name,hashed]))+",CURRENT_TIMESTAMP,'MEMBER',CURRENT_TIMESTAMP); COMMIT;")
 save('upstream_created')
 assert sho('SELECT count(*) FROM "Project" WHERE "workspaceId"='+lit(wid))=='0'
 assert sho('SELECT count(*) FROM "User" WHERE "workspaceId"='+lit(wid))=='1'
 db.execute('BEGIN IMMEDIATE')
 db.execute('INSERT INTO accounts(id,sho_id,email,name,enabled,suite_role) VALUES(?,?,?,?,1,?)',(aid,uid,email,name,'user'))
 db.execute('INSERT INTO links(app,account_id,local_id,enabled) VALUES(?,?,?,1)',('aplyd-genie-staging',aid,gid));db.commit();save('accounts_created')
 genie('BEGIN; INSERT INTO genie_users(id,issuer,subject,enabled) VALUES ('+lit(gid)+",'https://accounts.aplyd.org',"+lit(aid)+',true); INSERT INTO genie_workspace_people(tenant_id,user_id,display_name,review_reference) VALUES ('+','.join(map(lit,[tenant,gid,name,record['approval']]))+'); COMMIT;')
 assert genie('SELECT count(*) FROM genie_memberships WHERE user_id='+lit(gid))=='0'
 assert db.execute('SELECT app FROM links WHERE account_id=?',(aid,)).fetchall()==[('aplyd-genie-staging',)]
 save('applied_pending_invitation')
 print('qa_identity_created: ordinary upstream user in new empty workspace; ordinary Accounts identity; Genie staging link/contact only; no membership until real invitation acceptance; private receipt mode0600')
except Exception:
 db.rollback()
 db.execute('UPDATE accounts SET enabled=0 WHERE id=? AND sho_id=?',(aid,uid));db.commit()
 sho('UPDATE "User" SET "deactivatedAt"=CURRENT_TIMESTAMP WHERE id='+lit(uid)+' AND "workspaceId"='+lit(wid))
 save('quarantined_after_failure')
 raise
finally:db.close()
