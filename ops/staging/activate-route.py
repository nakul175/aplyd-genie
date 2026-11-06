#!/usr/bin/env python3
"""Append the staging-only route under a lock, validating before hot reload."""
import fcntl
import os
from pathlib import Path
import subprocess
import time

assert os.geteuid() == 0
lock = open('/run/lock/aplyd-caddy.lock', 'a')
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
p = Path('/etc/caddy/Caddyfile')
original = p.read_bytes()
assert b'staging.genie.aplyd.org' not in original, 'Route exists; inspect before changing'
fragment = Path('/opt/aplyd-genie-staging/current/ops/staging/Caddyfile.fragment').read_bytes()
backup = Path('/opt/aplyd-genie-staging/private') / ('Caddyfile-before-' + str(int(time.time())))
backup.write_bytes(original); os.chmod(backup, 0o600)
temporary = p.with_name('Caddyfile.genie-candidate')
fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'wb') as out:
    out.write(original + b'\n' + fragment); out.flush(); os.fsync(out.fileno())
subprocess.run(['caddy', 'validate', '--config', str(temporary), '--adapter', 'caddyfile'], check=True,
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
assert p.read_bytes() == original, 'Concurrent Caddy change; inspect before retry'
os.chmod(temporary, p.stat().st_mode & 0o777)
os.replace(temporary, p)
try:
    subprocess.run(['systemctl', 'reload', 'caddy'], check=True, timeout=30)
    print('genie_staging_route_active; existing route bytes preserved; private backup retained')
except Exception:
    p.write_bytes(original)
    subprocess.run(['systemctl', 'reload', 'caddy'], check=True, timeout=30)
    raise
