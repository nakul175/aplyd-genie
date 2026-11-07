#!/usr/bin/env python3
"""Apply the exact reviewed staging grants and create a server-only worker credential.

Run only after action-time approval and migration005–007. No existing credential changes.
"""
import argparse
import hashlib
import os
from pathlib import Path
import secrets
import subprocess

parser=argparse.ArgumentParser()
parser.add_argument('--release',type=Path,required=True)
args=parser.parse_args()
assert os.geteuid()==0
os.umask(0o077)
base=Path('/opt/aplyd-genie-staging')
release=args.release.resolve()
assert release.parent==base/'releases' and release.is_dir()
private=base/'private'
env=private/'export-worker.env'
assert not env.exists(),'Worker configuration already exists; inspect instead of replaying'
def sql(source):
    result=subprocess.run(['docker','exec','-i','aplyd-genie-staging-database-1','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','genie_migrator','-d','genie_staging'],input=source,text=True,capture_output=True)
    if result.returncode:raise RuntimeError('Worker grant operation failed; private configuration retained for reviewed recovery')
    return result.stdout.strip()
for name in ['005_resource_permissions.sql','006_permission_aware_memberships.sql','007_authorized_exports.sql']:
    expected=hashlib.sha256((release/'migrations'/name).read_bytes()).hexdigest()
    assert sql("SELECT checksum FROM genie_migrations WHERE name='"+name+"'")==expected,'Reviewed migration is not applied'
assert sql("SELECT count(*) FROM pg_roles WHERE rolname='genie_export_worker'")=='0'
# Restrict the app's existing server-only environment to the worker's required configuration.
allowed={'GENIE_ORIGIN','GENIE_IDENTITY_ISSUER','GENIE_OIDC_CLIENT_ID','GENIE_OIDC_CLIENT_SECRET','GENIE_SESSION_KEY','NODE_ENV'}
lines=[line for line in (private/'runtime.env').read_text().splitlines() if line.partition('=')[0] in allowed]
assert {line.partition('=')[0] for line in lines}>=allowed-{'NODE_ENV'}
password=secrets.token_hex(36)
lines.append('DATABASE_URL=postgresql://genie_export_worker:'+password+'@127.0.0.1:5547/genie_staging')
fd=os.open(env,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as out:out.write('\n'.join(lines)+'\n');out.flush();os.fsync(out.fileno())
source=(release/'ops/staging/genie-4/grants.sql').read_text()
assert source.rstrip().endswith('COMMIT;')
# Password exists only in process memory, stdin and the root-only env file; never argv/output.
source=source.rstrip()[:-len('COMMIT;')]+"ALTER ROLE genie_export_worker LOGIN PASSWORD '"+password+"';\nCOMMIT;\n"
sql(source)
assert sql("SELECT has_function_privilege('genie_runtime','genie_claim_member_export()','execute')")=='f'
assert sql("SELECT has_table_privilege('genie_export_worker','genie_member_exports','select')")=='f'
print('genie4_reviewed_grants_and_private_worker_configuration_prepared')
