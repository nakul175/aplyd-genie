#!/usr/bin/env python3
"""Temporary same-origin QA forms; protected application handlers remain unchanged."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

parser=argparse.ArgumentParser()
parser.add_argument('--remove',action='store_true')
parser.add_argument('--dedicated-qa',action='store_true')
args=parser.parse_args()
assert os.geteuid()==0
lock=open('/run/lock/aplyd-caddy.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
base=Path('/opt/aplyd-genie-staging')
fixture=json.loads((base/('private/genie3-qa-login.json' if args.dedicated_qa else 'private/genie3-fixture.json')).read_text())
assert fixture['state'] in ('applied','applied_pending_invitation')
target=str(uuid.UUID(fixture['user_id'] if args.dedicated_qa else fixture['recipient_user_id']))
label='Genie Staging QA Member' if args.dedicated_qa else 'HS QA Viewer'
html=("<!doctype html><html lang='en'><meta charset='utf-8'><title>Genie staging permission checks</title><main>"
      f"<h1>Genie staging permission checks</h1><p>Temporary acceptance fixture. These requests target only {label} in the dedicated Genie staging workspace.</p>"
      "<form method='post' action='/workspace/members/invite'>"
      f"<input type='hidden' name='target' value='{target}'><input type='hidden' name='role' value='member'>"
      "<button>Attempt invitation as ordinary member</button></form>"
      "<form method='post' action='/workspace/members/change'>"
      f"<input type='hidden' name='target' value='{target}'><input type='hidden' name='role' value='member'>"
      "<input type='hidden' name='status' value='disabled'><input type='hidden' name='version' value='1'>"
      "<button>Attempt membership change as ordinary member</button></form></main></html>")
payload=('\n    # BEGIN GENIE3 TEMPORARY ACCEPTANCE FORM\n'
    '    @genie3Acceptance path /__genie3_acceptance\n'
    '    header @genie3Acceptance {\n'
    '        Content-Type "text/html; charset=utf-8"\n'
    '        Referrer-Policy "same-origin"\n'
    '        Cache-Control "no-store"\n'
    '        X-Content-Type-Options "nosniff"\n'
    '        Content-Security-Policy "default-src \'none\'; form-action \'self\'; frame-ancestors \'none\'; base-uri \'none\'"\n'
    '    }\n'
    '    respond @genie3Acceptance '+json.dumps(html)+' 200\n'
    '    # END GENIE3 TEMPORARY ACCEPTANCE FORM\n').encode()
p=Path('/etc/caddy/Caddyfile');original=p.read_bytes();stat=p.stat()
if args.remove:
    if b'# BEGIN GENIE3 TEMPORARY ACCEPTANCE FORM' not in original:
        print('genie3_test_form_not_installed');raise SystemExit(0)
    assert original.count(payload)==1,'Acceptance form changed; inspect before removal'
    updated=original.replace(payload,b'',1)
else:
    assert b'# BEGIN GENIE3 TEMPORARY ACCEPTANCE FORM' not in original
    marker=b'staging.genie.aplyd.org {\n'
    assert original.count(marker)==1
    updated=original.replace(marker,marker+payload,1)
backup=base/'private'/('Caddyfile-before-genie3-form-'+str(time.time_ns()))
backup.write_bytes(original);os.chmod(backup,0o600)

def replace(data,expected):
    temporary=p.with_name('Caddyfile.genie3-form')
    fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as out:out.write(data);out.flush();os.fsync(out.fileno())
    subprocess.run(['caddy','validate','--config',str(temporary),'--adapter','caddyfile'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    os.chmod(temporary,stat.st_mode&0o777);os.chown(temporary,stat.st_uid,stat.st_gid)
    assert p.read_bytes()==expected,'Concurrent route change; inspect before retry'
    os.replace(temporary,p)

assert p.read_bytes()==original,'Concurrent route change; inspect before retry'
replace(updated,original)
try:subprocess.run(['systemctl','reload','caddy'],check=True,timeout=30)
except Exception:
    assert p.read_bytes()==updated,'Concurrent route change; manual rollback required'
    replace(original,updated);subprocess.run(['systemctl','reload','caddy'],check=True,timeout=30)
    raise
print('genie3_test_form_removed' if args.remove else 'genie3_test_form_installed; no authorization or credential handling changed')
