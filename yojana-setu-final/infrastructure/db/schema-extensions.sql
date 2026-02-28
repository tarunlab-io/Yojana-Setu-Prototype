-- ─── Yojana-Setu Complete Schema ─────────────────────────────────────────────
-- PostgreSQL 16 — append to init.sql or run as migration
-- Adds tables missing from the initial scaffold

-- ─── Application Events (event sourcing for application-service) ──────────────

CREATE TABLE IF NOT EXISTS application_events (
  event_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID        NOT NULL REFERENCES applications(application_id) ON DELETE CASCADE,
  event_type      TEXT        NOT NULL,
  from_status     TEXT,
  to_status       TEXT        NOT NULL,
  triggered_by    TEXT        NOT NULL CHECK (triggered_by IN ('user','system','government')),
  note            TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_app_events_application ON application_events(application_id, occurred_at);

-- Extend applications table with additional columns for application-service
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS reference_number      TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS last_status_change_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS document_ids          TEXT[]      DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS form_data             JSONB       DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS government_reference  TEXT,
  ADD COLUMN IF NOT EXISTS disbursement_amount_inr NUMERIC,
  ADD COLUMN IF NOT EXISTS disbursement_date     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at            TIMESTAMPTZ DEFAULT NOW();

-- ─── Consent Records (privacy-service) ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS consent_records (
  consent_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID        NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  purpose                 TEXT        NOT NULL,
  status                  TEXT        NOT NULL CHECK (status IN ('active','revoked','superseded')),
  granted_at              TIMESTAMPTZ,
  revoked_at              TIMESTAMPTZ,
  privacy_notice_version  TEXT        NOT NULL DEFAULT '2024-v2',
  channel                 TEXT        NOT NULL DEFAULT 'whatsapp',
  language                TEXT        NOT NULL DEFAULT 'hi',
  ip_hash                 TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consent_user_purpose
  ON consent_records(user_id, purpose, status);

-- ─── Deletion Requests (privacy-service) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS deletion_requests (
  request_id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL,
  status                TEXT        NOT NULL CHECK (
                          status IN ('scheduled','blocked','processing','completed','partial','failed')),
  requested_by          TEXT        NOT NULL CHECK (requested_by IN ('user','admin','system')),
  reason                TEXT,
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scheduled_deletion_at TIMESTAMPTZ NOT NULL,
  completed_at          TIMESTAMPTZ,
  blocking_reason       TEXT,
  deletion_results      JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deletion_scheduled
  ON deletion_requests(scheduled_deletion_at) WHERE status = 'scheduled';

-- ─── Pseudonymisation Keys (privacy-service) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS pseudonymisation_keys (
  user_id     UUID        PRIMARY KEY,
  pseudo_id   TEXT        NOT NULL UNIQUE,
  salt        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  shredded_at TIMESTAMPTZ
);

-- ─── Audit Log (privacy-service) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
  audit_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type        TEXT        NOT NULL,
  subject_user_id   UUID        NOT NULL,
  actor_id          TEXT        NOT NULL,
  actor_type        TEXT        NOT NULL CHECK (actor_type IN ('user','system','admin')),
  service_name      TEXT        NOT NULL,
  data_categories   JSONB       NOT NULL DEFAULT '[]',
  metadata          JSONB       NOT NULL DEFAULT '{}',
  content_hash      TEXT        NOT NULL,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_subject_user
  ON audit_log(subject_user_id, occurred_at DESC);

-- Prevent modifications to audit log at DB level
-- REVOKE UPDATE, DELETE ON audit_log FROM yojana_setu_app;

-- ─── Conversation History (privacy-service retention) ─────────────────────────

CREATE TABLE IF NOT EXISTS conversation_history (
  history_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID        NOT NULL REFERENCES conversation_sessions(session_id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  user_input   TEXT,
  response_enc BYTEA,
  intent       TEXT,
  language     TEXT        NOT NULL DEFAULT 'hi',
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conv_history_user
  ON conversation_history(user_id, occurred_at DESC);

-- ─── Document Repository Extended (document-service) ─────────────────────────

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS original_filename TEXT,
  ADD COLUMN IF NOT EXISTS mime_type         TEXT,
  ADD COLUMN IF NOT EXISTS file_size_bytes   INTEGER,
  ADD COLUMN IF NOT EXISTS validation_result JSONB;

-- ─── Scheme Eligibility Cache (scheme-service) ────────────────────────────────

CREATE TABLE IF NOT EXISTS eligibility_cache (
  cache_key       TEXT        PRIMARY KEY,
  user_id         UUID        NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  scheme_id       UUID        NOT NULL REFERENCES government_schemes(scheme_id) ON DELETE CASCADE,
  eligibility_score NUMERIC   NOT NULL CHECK (eligibility_score BETWEEN 0 AND 1),
  explanation     TEXT,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_eligibility_cache_user
  ON eligibility_cache(user_id, computed_at DESC);

CREATE INDEX IF NOT EXISTS idx_eligibility_cache_expires
  ON eligibility_cache(expires_at) WHERE expires_at > NOW();

-- ─── Seed: Test User for Integration Tests ────────────────────────────────────
-- Only inserted if running in non-production environments

DO $$
BEGIN
  IF current_setting('app.environment', TRUE) != 'production' THEN
    INSERT INTO user_profiles (
      user_id, phone_number, demographics, socioeconomic,
      preferences, completion_score
    ) VALUES (
      '00000000-0000-0000-0000-000000000001',
      '+919999999999',
      -- Placeholder encrypted bytes (real service encrypts this)
      '\x706c61636568f6c646572'::bytea,
      '\x706c61636568f6c646572'::bytea,
      '{"preferredLanguage":"hi","preferredChannel":"whatsapp","notificationsEnabled":true}',
      75
    ) ON CONFLICT (phone_number) DO NOTHING;
  END IF;
END $$;
