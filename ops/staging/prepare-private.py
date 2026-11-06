#!/usr/bin/env python3
"""Generate dedicated staging secrets on the target host only, after registration approval."""
import base64
import json
import os
from pathlib import Path
import secrets

assert os.geteuid() == 0
p = Path('/opt/aplyd-genie-staging/private')
identity = json.loads((p / 'identity.json').read_text())
owner_password, runtime_password = secrets.token_urlsafe(36), secrets.token_urlsafe(36)
def write(name, text):
    fd = os.open(p / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as out: out.write(text)
write('database.env', f'POSTGRES_USER=genie_migrator\nPOSTGRES_DB=genie_staging\nPOSTGRES_PASSWORD={owner_password}\n')
write('migration.env', f'DATABASE_URL=postgresql://genie_migrator:{owner_password}@127.0.0.1:5547/genie_staging\n')
write('runtime.env', '\n'.join([
    f'DATABASE_URL=postgresql://genie_runtime:{runtime_password}@127.0.0.1:5547/genie_staging',
    'PORT=3910', 'NODE_ENV=production', 'GENIE_TRUST_PROXY=loopback',
    'GENIE_ORIGIN=https://staging.genie.aplyd.org', 'GENIE_IDENTITY_ISSUER=https://accounts.aplyd.org',
    'GENIE_OIDC_CLIENT_ID=aplyd-genie-staging',
    'GENIE_OIDC_CLIENT_SECRET=' + (p / 'oidc-secret').read_text().strip(),
    'GENIE_SESSION_KEY=' + base64.b64encode(secrets.token_bytes(32)).decode(), '']))
# All interpolated values are generated UUIDs or URL-safe random values, never arbitrary user SQL.
import uuid
for key in ['user_id', 'account_id', 'tenant_id']: uuid.UUID(identity[key])
write('provision.sql', f"""BEGIN;
CREATE ROLE genie_runtime LOGIN PASSWORD '{runtime_password}';
REVOKE ALL ON DATABASE genie_staging FROM PUBLIC;
GRANT CONNECT ON DATABASE genie_staging TO genie_runtime;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO genie_runtime;
GRANT SELECT ON genie_users,genie_tenants,genie_memberships TO genie_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON genie_sessions,genie_login_transactions,genie_rate_limits TO genie_runtime;
INSERT INTO genie_users(id,issuer,subject,enabled) VALUES ('{identity['user_id']}','https://accounts.aplyd.org','{identity['account_id']}',true);
INSERT INTO genie_tenants(id,enabled) VALUES ('{identity['tenant_id']}',true);
INSERT INTO genie_memberships(user_id,tenant_id,status,review_reference)
 VALUES ('{identity['user_id']}','{identity['tenant_id']}','active','GENIE-2 owner-approved staging acceptance 2026-11-06');
COMMIT;
""")
print('genie_private_environment_prepared; secrets withheld')
