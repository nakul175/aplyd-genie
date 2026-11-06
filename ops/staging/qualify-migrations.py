#!/usr/bin/env python3
"""Exercise failure rollback, replay and checksum guards in a separate synthetic database."""
import os
from pathlib import Path
import shutil
import subprocess

assert os.geteuid() == 0
os.umask(0o022)
root = Path('/opt/aplyd-genie-staging')
release = root / 'releases/82c0f3e'
fixture = root / 'qualification-82c0f3e-v2'
fixture.mkdir(mode=0o755)
(fixture / 'scripts').mkdir()
(fixture / 'migrations').mkdir()
(fixture / 'node_modules').mkdir()
shutil.copy(release / 'scripts/migrate.mjs', fixture / 'scripts/migrate.mjs')
for p in (release / 'migrations').glob('*.sql'): shutil.copy(p, fixture / 'migrations' / p.name)
name = 'genie_qual_82c0f3e_v2'
def sql(query, database=name):
    return subprocess.check_output(['docker', 'exec', 'aplyd-genie-staging-database-1', 'psql',
        '-v', 'ON_ERROR_STOP=1', '-tA', '-U', 'genie_migrator', '-d', database, '-c', query], text=True).strip()
sql('CREATE DATABASE ' + name, 'postgres')
sql('REVOKE ALL ON DATABASE ' + name + ' FROM PUBLIC', 'postgres')
env = root / 'private/qualification-v2.env'
fd = os.open(env, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as out:
    out.write((root / 'private/migration.env').read_text().replace('/genie_staging', '/' + name))
command = ['docker','run','--rm','--network','host','--memory','256m','--cpus','0.5','--user','1000:1000',
    '--env-file',str(env),'-v',str(fixture)+':/app:ro','-v',str(release/'node_modules')+':/app/node_modules:ro',
    '-w','/app','node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9','node','scripts/migrate.mjs']
def run(expected):
    result = subprocess.run(command, capture_output=True, text=True)
    assert result.returncode == expected, f'Expected exit {expected}, got {result.returncode}: {result.stdout[-500:]} {result.stderr[-500:]}'
first = fixture / 'migrations/001_identity_sessions.sql'
original = first.read_bytes()
first.write_bytes(original + b'\nSELECT genie_intentional_missing_function();\n')
run(1)
assert sql("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'") == '0'
first.write_bytes(original)
run(0); run(0)
assert sql('SELECT count(*) FROM genie_migrations') == '2'
first.write_bytes(original + b'\n-- deliberate checksum mismatch\n')
run(1)
assert sql('SELECT count(*) FROM genie_migrations') == '2'
first.write_bytes(original)
print('migration_qualification_passed: failed DDL rolled back; actual pg replay idempotent; checksum mismatch rejected')
