#!/usr/bin/env python3
"""Staging-only reviewed fixture bootstrap. Dry-run by default; apply needs owner approval."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import time
import uuid

parser=argparse.ArgumentParser()
parser.add_argument('--apply',action='store_true')
parser.add_argument('--release',required=True,type=Path)
parser.add_argument('--recipient-account-id',required=True,type=uuid.UUID)
args=parser.parse_args()
assert os.geteuid()==0
base=Path('/opt/aplyd-genie-staging')
identity=json.loads((base/'private/identity.json').read_text())
owner=str(uuid.UUID(identity['user_id']));tenant=str(uuid.UUID(identity['tenant_id']))
account_id=str(args.recipient_account_id)
config_path=Path('/home/deploy/aplyd-accounts-stage/private/config.json')
config=json.loads(config_path.read_text())
client=next(c for c in config['clients'] if c['client_id']=='aplyd-genie-staging')
assert config['issuer']=='https://accounts.aplyd.org'
assert client['redirect_uris']==['https://staging.genie.aplyd.org/auth/callback']

def sql(query):
    return subprocess.check_output(['docker','exec','aplyd-genie-staging-database-1','psql','-q','-tA','-v','ON_ERROR_STOP=1',
        '-U','genie_migrator','-d','genie_staging','-c',query],text=True).strip()

def inspect(database):
    target=database.execute('SELECT id,name,enabled,suite_role FROM accounts WHERE id=?',(account_id,)).fetchone()
    assert target==(account_id,'HS QA Viewer',1,'user'),'Expected reviewed ordinary QA identity changed'
    assert database.execute('SELECT enabled FROM accounts WHERE id=?',(identity['account_id'],)).fetchone()==(1,)
    assert not database.execute('SELECT 1 FROM links WHERE app=? AND account_id=?',('aplyd-genie-staging',account_id)).fetchone(),'Genie QA link already exists; inspect before changing it'
    row=json.loads(sql("SELECT row_to_json(x) FROM (SELECT m.status,coalesce(to_jsonb(m)->>'role','member') AS role,u.subject,u.enabled FROM genie_memberships m JOIN genie_users u ON u.id=m.user_id WHERE m.user_id='%s' AND m.tenant_id='%s') x"%(owner,tenant)))
    assert row=={'status':'active','role':'member','subject':identity['account_id'],'enabled':True},'Owner bootstrap baseline changed'

if not args.apply:
    db=sqlite3.connect('file:'+config['database']+'?mode=ro',uri=True)
    try:inspect(db)
    finally:db.close()
    print('dry_run_ready: current owner member; HS QA Viewer reviewed/enabled; no Genie recipient link; no data changed')
    raise SystemExit(0)

# Action-time approval applies only to this exact staging owner and QA identity.
locks=[]
for path in ['/run/lock/sho-sso-env-reload.lock','/run/lock/aplyd-genie-staging.lock']:
    handle=open(path,'a');fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(handle)
db=sqlite3.connect(config['database'],timeout=5)
inspect(db)
checksum=hashlib.sha256((args.release/'migrations/003_workspace_memberships.sql').read_bytes()).hexdigest()
assert sql("SELECT checksum FROM genie_migrations WHERE name='003_workspace_memberships.sql'")==checksum,'Reviewed migration 003 is not applied'
private=base/'private'
receipt=private/'genie3-fixture.json'
assert not receipt.exists(),'Prior bootstrap receipt exists; inspect instead of replaying'
backup=private/('genie3-before-bootstrap-'+str(int(time.time())))
backup.mkdir(mode=0o700)
with open(backup/'genie.sql','xb') as out:
    os.chmod(backup/'genie.sql',0o600)
    subprocess.run(['docker','exec','aplyd-genie-staging-database-1','pg_dump','-U','genie_migrator','-d','genie_staging'],stdout=out,check=True)
copy=sqlite3.connect(backup/'accounts.sqlite');db.backup(copy);copy.close();os.chmod(backup/'accounts.sqlite',0o600)
recipient=str(uuid.uuid4())
record={'owner_user_id':owner,'tenant_id':tenant,'recipient_account_id':account_id,'recipient_user_id':recipient,
        'review_reference':'GENIE-3 owner-approved staging administrator and ordinary QA invitation','state':'prepared'}
fd=os.open(receipt,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as out:json.dump(record,out);out.flush();os.fsync(out.fileno())
linked=False
try:
    db.execute('BEGIN IMMEDIATE')
    db.execute('INSERT INTO links(app,account_id,local_id,enabled) VALUES (?,?,?,1)',('aplyd-genie-staging',account_id,recipient))
    db.commit();linked=True
    # UUIDs were parsed above; names/references here are fixed reviewed literals.
    sql(f"""BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('genie-membership:{tenant}',0));
DO $$ BEGIN
 IF (SELECT count(*) FROM genie_memberships WHERE tenant_id='{tenant}' AND role='admin' AND status='active')<>0
 THEN RAISE EXCEPTION 'administrator already bootstrapped'; END IF;
 IF NOT EXISTS(SELECT 1 FROM genie_memberships WHERE user_id='{owner}' AND tenant_id='{tenant}' AND role='member' AND status='active')
 THEN RAISE EXCEPTION 'owner baseline changed'; END IF;
END $$;
UPDATE genie_memberships SET role='admin',version=version+1 WHERE user_id='{owner}' AND tenant_id='{tenant}';
DELETE FROM genie_sessions WHERE user_id='{owner}' AND tenant_id='{tenant}';
INSERT INTO genie_users(id,issuer,subject,enabled) VALUES ('{recipient}','https://accounts.aplyd.org','{account_id}',true);
INSERT INTO genie_workspace_people(tenant_id,user_id,display_name,review_reference) VALUES
 ('{tenant}','{owner}','Workspace owner','GENIE-3 owner-approved administrator bootstrap'),
 ('{tenant}','{recipient}','HS QA Viewer','GENIE-3 owner-approved reviewed QA recipient');
INSERT INTO genie_membership_audit(tenant_id,actor_id,target_id,action,before_state,after_state)
 VALUES ('{tenant}','{owner}','{owner}','role_changed','{{"role":"member","status":"active"}}',
 '{{"role":"admin","status":"active","via":"owner-approved operator bootstrap"}}');
GRANT EXECUTE ON FUNCTION genie_change_member(text,uuid,text,text,bigint),genie_create_invite(text,uuid,text,text),
 genie_revoke_invite(text,uuid),genie_invite_recipient(text,text,text),genie_accept_invite(text,text,text),
 genie_membership_page(text,text,text,text) TO genie_runtime;
COMMIT;""")
except Exception:
    if linked:
        db.execute('DELETE FROM links WHERE app=? AND account_id=? AND local_id=?',('aplyd-genie-staging',account_id,recipient));db.commit()
    record['state']='rolled_back';receipt.write_text(json.dumps(record)+'\n')
    raise
else:
    record['state']='applied';receipt.write_text(json.dumps(record)+'\n')
    print('genie3_bootstrap_applied: owner administrator; reviewed ordinary QA contact; narrow runtime entry-point grants; other app permissions unchanged')
finally:db.close()
