CREATE TABLE genie_users (
  id uuid PRIMARY KEY,
  issuer text NOT NULL,
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
  enabled boolean NOT NULL DEFAULT false,
  UNIQUE (issuer, subject)
);

CREATE TABLE genie_tenants (
  id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false
);

CREATE TABLE genie_memberships (
  user_id uuid NOT NULL REFERENCES genie_users(id),
  tenant_id uuid NOT NULL REFERENCES genie_tenants(id),
  status text NOT NULL DEFAULT 'disabled' CHECK (status IN ('active', 'disabled')),
  review_reference text NOT NULL CHECK (length(trim(review_reference)) > 0),
  PRIMARY KEY (user_id, tenant_id)
);

CREATE TABLE genie_login_transactions (
  state_hash char(64) PRIMARY KEY,
  browser_hash char(64) NOT NULL,
  sealed_transaction text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX genie_login_expiry ON genie_login_transactions (expires_at);

CREATE TABLE genie_sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES genie_users(id),
  tenant_id uuid NOT NULL REFERENCES genie_tenants(id),
  sealed_upstream text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, tenant_id) REFERENCES genie_memberships(user_id, tenant_id)
);
CREATE INDEX genie_session_expiry ON genie_sessions (expires_at);
