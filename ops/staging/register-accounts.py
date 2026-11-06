#!/usr/bin/env python3
"""Root operator only. No credentials or identity exports are written to stdout."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import sqlite3
import subprocess
import time
import uuid
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--account-id', required=True, type=uuid.UUID)
parser.add_argument('--expected-config-sha256', required=True)
args = parser.parse_args()
assert os.geteuid() == 0, 'Root console required'
lock = open('/run/lock/sho-sso-env-reload.lock', 'a')
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
r = Path('/home/deploy/aplyd-accounts-stage')
p = r / 'private/config.json'
original = p.read_bytes()
assert hashlib.sha256(original).hexdigest() == args.expected_config_sha256, 'Accounts config changed; review again'
config = json.loads(original)
client_id = 'aplyd-genie-staging'
assert config['issuer'] == 'https://accounts.aplyd.org'
assert not any(c['client_id'] == client_id for c in config['clients']), 'Client already exists; inspect, do not rotate'
private = Path('/opt/aplyd-genie-staging/private')
private.mkdir(mode=0o700, exist_ok=True)
os.chmod(private, 0o700)
assert not (private / 'identity.json').exists(), 'Prior registration state exists; inspect first'
backup = private / ('accounts-before-' + str(int(time.time())))
backup.mkdir(mode=0o700)
(backup / 'config.json').write_bytes(original)
os.chmod(backup / 'config.json', 0o600)
source = sqlite3.connect(config['database'], timeout=5)
source.backup(sqlite3.connect(backup / 'accounts.sqlite'))
os.chmod(backup / 'accounts.sqlite', 0o600)
account_id = str(args.account_id)
account = source.execute('SELECT id,enabled FROM accounts WHERE id=?', (account_id,)).fetchone()
assert account == (account_id, 1), 'Reviewed existing account must be enabled'
assert not source.execute('SELECT 1 FROM links WHERE app=? AND account_id=?', (client_id, account_id)).fetchone()
identity = {'account_id': account_id, 'user_id': str(uuid.uuid4()), 'tenant_id': str(uuid.uuid4()),
            'review_reference': 'GENIE-2: owner-approved staging registration 2026-11-06'}
secret = secrets.token_urlsafe(48)
client = {'client_id': client_id, 'client_name': 'Aplyd Genie Staging', 'client_secret': secret,
          'redirect_uris': ['https://staging.genie.aplyd.org/auth/callback'],
          'response_types': ['code'], 'grant_types': ['authorization_code'],
          'token_endpoint_auth_method': 'client_secret_basic', 'id_token_signed_response_alg': 'RS256'}
config['clients'].append(client)
stat = p.stat()
def replace_config(data):
    temporary = p.with_name('config.genie.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as out:
        out.write(data); out.flush(); os.fsync(out.fileno())
    os.chown(temporary, stat.st_uid, stat.st_gid)
    os.replace(temporary, p)
def restart():
    subprocess.run(['runuser', '-u', 'deploy', '--', 'env', 'XDG_RUNTIME_DIR=/run/user/1000',
                    'systemctl', '--user', 'restart', 'aplyd-accounts.service'], check=True, timeout=30)
try:
    source.execute('BEGIN IMMEDIATE')
    source.execute('INSERT INTO links(app,account_id,local_id,enabled) VALUES (?,?,?,1)',
                   (client_id, account_id, identity['user_id']))
    source.commit()
    replace_config((json.dumps(config, indent=2) + '\n').encode())
    restart()
    for attempt in range(20):
        try:
            request = urllib.request.Request('https://accounts.aplyd.org/internal/session/status',
                data=json.dumps({'client_id': client_id, 'client_secret': secret,
                                 'sub': account_id, 'uid': 'genie-registration-probe'}).encode(),
                headers={'Content-Type': 'application/json', 'Host': 'accounts.aplyd.org'})
            with urllib.request.urlopen(request, timeout=3) as response:
                assert json.load(response) == {'active': False}
            break
        except Exception:
            if attempt == 19: raise
            time.sleep(0.25)
    for name, value in [('identity.json', json.dumps(identity)), ('oidc-secret', secret)]:
        fd = os.open(private / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as out: out.write(value + '\n')
    assert json.loads(p.read_text())['clients'][:-1] == json.loads(original)['clients']
    print('genie_staging_accounts_registered; existing clients preserved; private backup retained')
except Exception:
    # Never restore the entire shared SQLite database over concurrent session activity.
    replace_config(original)
    source.execute('DELETE FROM links WHERE app=? AND account_id=? AND local_id=?',
                   (client_id, account_id, identity['user_id']))
    source.commit()
    restart()
    raise
finally:
    source.close()
