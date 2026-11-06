CREATE TABLE genie_rate_limits (
  key_hash char(64) PRIMARY KEY,
  hits integer NOT NULL CHECK (hits >= 0),
  reset_at timestamptz NOT NULL
);
CREATE INDEX genie_rate_expiry ON genie_rate_limits(reset_at);
