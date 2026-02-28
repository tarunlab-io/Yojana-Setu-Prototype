-- Yojana-Setu Database Schema
-- PostgreSQL 16

-- ─── Extensions ───────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── User Profiles ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone_number    VARCHAR(15) UNIQUE NOT NULL,
  -- Demographics stored as encrypted JSONB
  demographics    BYTEA NOT NULL,                     -- AES-256 encrypted JSON
  socioeconomic   BYTEA NOT NULL,                     -- AES-256 encrypted JSON
  preferences     JSONB NOT NULL DEFAULT '{}',
  consent_records JSONB NOT NULL DEFAULT '[]',
  completion_score INTEGER NOT NULL DEFAULT 0 CHECK (completion_score BETWEEN 0 AND 100),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_profiles_phone ON user_profiles(phone_number);

-- ─── Government Schemes ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS government_schemes (
  scheme_id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  official_name           VARCHAR(500) NOT NULL,
  popular_name            VARCHAR(500),
  short_description       TEXT NOT NULL,
  full_description        TEXT NOT NULL,
  simplified_explanation  TEXT,
  category                VARCHAR(50) NOT NULL,
  level                   VARCHAR(10) NOT NULL CHECK (level IN ('central', 'state')),
  state_code              VARCHAR(10),
  ministry                VARCHAR(200) NOT NULL,
  status                  VARCHAR(20) NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'inactive', 'expired', 'upcoming')),
  eligibility_criteria    JSONB NOT NULL DEFAULT '{}',
  required_documents      JSONB NOT NULL DEFAULT '[]',
  benefit_details         JSONB NOT NULL DEFAULT '{}',
  translations            JSONB NOT NULL DEFAULT '{}',
  application_deadline    TIMESTAMPTZ,
  application_url         TEXT,
  official_notification_url TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_schemes_status ON government_schemes(status);
CREATE INDEX idx_schemes_category ON government_schemes(category);
CREATE INDEX idx_schemes_level ON government_schemes(level);
CREATE INDEX idx_schemes_state ON government_schemes(state_code) WHERE state_code IS NOT NULL;
CREATE INDEX idx_schemes_eligibility ON government_schemes USING GIN (eligibility_criteria);

-- ─── Documents ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS documents (
  document_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  document_type     VARCHAR(50) NOT NULL,
  storage_key       TEXT NOT NULL,               -- S3 object key
  encrypted_key     TEXT,                        -- Encrypted storage key for sensitive docs
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'processing', 'valid', 'invalid', 'expired', 'unclear')),
  validation_result JSONB,
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ
);

CREATE INDEX idx_documents_user ON documents(user_id);
CREATE INDEX idx_documents_type ON documents(document_type);
CREATE INDEX idx_documents_status ON documents(status);

-- ─── Applications ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS applications (
  application_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tracking_reference      VARCHAR(20) UNIQUE NOT NULL,  -- YS-YYYY-NNNNN
  user_id                 UUID NOT NULL REFERENCES user_profiles(user_id),
  scheme_id               UUID NOT NULL REFERENCES government_schemes(scheme_id),
  status                  VARCHAR(30) NOT NULL DEFAULT 'draft'
                            CHECK (status IN (
                              'draft','submitted','under_review',
                              'additional_docs_required','approved',
                              'rejected','disbursement_pending','completed'
                            )),
  status_history          JSONB NOT NULL DEFAULT '[]',
  submitted_document_ids  UUID[] NOT NULL DEFAULT '{}',
  rejection_reason        TEXT,
  corrective_actions      JSONB,
  next_steps              JSONB,
  expected_disbursement_date TIMESTAMPTZ,
  notification_channel    VARCHAR(20) NOT NULL DEFAULT 'whatsapp',
  external_reference_id   TEXT,
  submitted_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_applications_user ON applications(user_id);
CREATE INDEX idx_applications_scheme ON applications(scheme_id);
CREATE INDEX idx_applications_status ON applications(status);
CREATE INDEX idx_applications_tracking ON applications(tracking_reference);

-- Sequence for tracking reference generation
CREATE SEQUENCE IF NOT EXISTS application_sequence START 1;

-- ─── Conversation Sessions ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversation_sessions (
  session_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES user_profiles(user_id),
  phone_number    VARCHAR(15) NOT NULL,
  channel         VARCHAR(20) NOT NULL DEFAULT 'whatsapp',
  context         JSONB NOT NULL DEFAULT '{}',
  history         JSONB NOT NULL DEFAULT '[]',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  message_count   INTEGER NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_phone ON conversation_sessions(phone_number);
CREATE INDEX idx_sessions_user ON conversation_sessions(user_id);
CREATE INDEX idx_sessions_active ON conversation_sessions(is_active) WHERE is_active = TRUE;

-- ─── Notifications ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  notification_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES user_profiles(user_id),
  phone_number    VARCHAR(15) NOT NULL,
  type            VARCHAR(50) NOT NULL,
  channel         VARCHAR(20) NOT NULL DEFAULT 'whatsapp',
  message         TEXT NOT NULL,
  template_name   VARCHAR(100),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','sent','failed','delivered')),
  scheduled_at    TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  metadata        JSONB DEFAULT '{}'
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_status ON notifications(status);
CREATE INDEX idx_notifications_scheduled ON notifications(scheduled_at) WHERE status = 'pending';

-- ─── Updated At Trigger ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_schemes_updated_at
  BEFORE UPDATE ON government_schemes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_applications_updated_at
  BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
