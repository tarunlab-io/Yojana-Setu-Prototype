-- ─── Privacy Service Schema ───────────────────────────────────────────────────
-- Append-only tables for consent records and audit logs.
-- Never update or delete from these tables directly — use the service API.

-- ─── Consent Records ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS consent_records (
  consent_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID        NOT NULL,
  purpose                 TEXT        NOT NULL,
  status                  TEXT        NOT NULL  -- 'active' | 'revoked' | 'superseded'
                          CHECK (status IN ('active', 'revoked', 'superseded')),
  granted_at              TIMESTAMPTZ,
  revoked_at              TIMESTAMPTZ,
  -- The specific version of the privacy notice the user consented to
  privacy_notice_version  TEXT        NOT NULL,
  channel                 TEXT        NOT NULL,  -- 'whatsapp' | 'api' | 'web'
  language                TEXT        NOT NULL DEFAULT 'hi',
  -- Hashed IP address (never store raw IPs)
  ip_hash                 TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast consent checks (high-frequency operation)
CREATE INDEX IF NOT EXISTS idx_consent_user_purpose_status
  ON consent_records (user_id, purpose, status);

-- Index for consent history queries
CREATE INDEX IF NOT EXISTS idx_consent_user_created
  ON consent_records (user_id, created_at DESC);

-- ─── Deletion Requests ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS deletion_requests (
  request_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID        NOT NULL,
  status                  TEXT        NOT NULL
                          CHECK (status IN ('scheduled', 'blocked', 'processing',
                                            'completed', 'partial', 'failed')),
  requested_by            TEXT        NOT NULL  -- 'user' | 'admin' | 'system'
                          CHECK (requested_by IN ('user', 'admin', 'system')),
  reason                  TEXT,
  requested_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scheduled_deletion_at   TIMESTAMPTZ NOT NULL,
  completed_at            TIMESTAMPTZ,
  blocking_reason         TEXT,
  -- JSON map of service → success/failure for partial deletions
  deletion_results        JSONB,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deletion_user_id
  ON deletion_requests (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deletion_scheduled
  ON deletion_requests (scheduled_deletion_at)
  WHERE status = 'scheduled';

-- ─── Pseudonymisation Keys ────────────────────────────────────────────────────
-- Stores the salt used to pseudonymise a user.
-- Destroying this row makes re-identification of anonymised records impossible.

CREATE TABLE IF NOT EXISTS pseudonymisation_keys (
  user_id     UUID        PRIMARY KEY,
  pseudo_id   TEXT        NOT NULL UNIQUE,
  salt        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- When this is set, the salt has been shredded and re-identification is impossible
  shredded_at TIMESTAMPTZ
);

-- ─── Audit Log ────────────────────────────────────────────────────────────────
-- Append-only. NEVER grant DELETE or UPDATE privileges on this table.
-- Tamper-evident chain: each row's content_hash covers the previous row's hash.

CREATE TABLE IF NOT EXISTS audit_log (
  audit_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type        TEXT        NOT NULL,
  subject_user_id   UUID        NOT NULL,
  actor_id          TEXT        NOT NULL,
  actor_type        TEXT        NOT NULL
                    CHECK (actor_type IN ('user', 'system', 'admin')),
  service_name      TEXT        NOT NULL,
  data_categories   JSONB       NOT NULL DEFAULT '[]',
  metadata          JSONB       NOT NULL DEFAULT '{}',
  -- SHA-256 hash of this record's content fields (tamper detection)
  content_hash      TEXT        NOT NULL,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent any UPDATE or DELETE on audit_log (enforced at DB level)
-- Run as superuser:
-- REVOKE UPDATE, DELETE ON audit_log FROM yojana_setu_app;

CREATE INDEX IF NOT EXISTS idx_audit_subject_user
  ON audit_log (subject_user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_event_type
  ON audit_log (event_type, occurred_at DESC);

-- ─── Conversation History (managed here for retention enforcement) ─────────────

CREATE TABLE IF NOT EXISTS conversation_history (
  history_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID        NOT NULL,
  user_id       UUID        NOT NULL,
  user_input    TEXT,
  -- Encrypted system response (contains PII)
  response_enc  BYTEA,
  intent        TEXT,
  language      TEXT        NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conv_history_user_occurred
  ON conversation_history (user_id, occurred_at DESC);

-- Partition by occurred_at for efficient retention enforcement (PostgreSQL 11+)
-- In production, convert to time-based partitioning:
-- CREATE TABLE conversation_history PARTITION BY RANGE (occurred_at);

-- ─── Row-level Security ───────────────────────────────────────────────────────
-- Ensures users can only access their own records via the app role.

ALTER TABLE consent_records    ENABLE ROW LEVEL SECURITY;
ALTER TABLE deletion_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log          ENABLE ROW LEVEL SECURITY;

-- The app role sees only its own user's records
-- (Admin role bypasses RLS via BYPASSRLS privilege)
CREATE POLICY user_isolation ON consent_records
  USING (user_id = current_setting('app.current_user_id', TRUE)::UUID);

CREATE POLICY user_isolation ON deletion_requests
  USING (user_id = current_setting('app.current_user_id', TRUE)::UUID);

-- Audit log: subject_user_id isolation (service accounts see all)
CREATE POLICY audit_user_isolation ON audit_log
  USING (
    subject_user_id = current_setting('app.current_user_id', TRUE)::UUID
    OR current_setting('app.role', TRUE) IN ('service', 'admin')
  );
