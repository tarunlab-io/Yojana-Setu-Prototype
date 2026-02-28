/**
 * Consent Manager
 *
 * Manages granular, revocable consent records for all data processing
 * activities. Implements the requirements of India's Personal Data
 * Protection Bill (PDPB) and IT Act Section 43A.
 *
 * Consent Model:
 *  - Granular: separate consent for each processing purpose
 *  - Informed: consent is tied to a specific version of the privacy notice
 *  - Freely given: users can refuse without losing core service
 *  - Revocable: withdrawal at any time triggers deletion cascade
 *  - Auditable: full consent history retained forever
 *
 * Consent Purposes (Req 9.1–9.3):
 *  PROFILE_DATA         — store demographics for scheme matching
 *  DOCUMENT_STORAGE     — store documents for application submission
 *  SCHEME_MATCHING      — use profile to score scheme eligibility
 *  NOTIFICATIONS        — send status updates via WhatsApp
 *  ANALYTICS            — aggregate usage analytics (optional)
 *  THIRD_PARTY_SHARING  — share data with government portals (required for application)
 */

import { Pool } from 'pg';
import {
  type PrivacyConsentRecord as ConsentRecord,
  type ConsentGrant,
  ConsentPurpose,
  ConsentStatus,
  type SupportedLanguage,
  ConsentRequiredError,
  generateUUID,
} from '@yojana-setu/shared';
import { logger } from '../config/logger';

// ─── DB Pool ──────────────────────────────────────────────────────────────────

let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env['DATABASE_URL'],
      max: 5,
      ssl: process.env['NODE_ENV'] === 'production' ? { rejectUnauthorized: true } : false,
    });
    pool.on('error', (err) => logger.error('PG pool error', { error: err.message }));
  }
  return pool;
}

// ─── Privacy Notice Versions ──────────────────────────────────────────────────

const CURRENT_PRIVACY_NOTICE_VERSION = '2024-v2';
const CURRENT_NOTICE_URL = 'https://yojana-setu.gov.in/privacy/v2';

// ─── Required vs Optional Purposes ───────────────────────────────────────────

/** These purposes are required for the service to function at all */
const REQUIRED_PURPOSES = new Set([
  ConsentPurpose.PROFILE_DATA,
  ConsentPurpose.SCHEME_MATCHING,
  ConsentPurpose.THIRD_PARTY_SHARING, // Cannot submit to government without this
]);

/** These are optional — user can opt out without losing core service */
const OPTIONAL_PURPOSES = new Set([
  ConsentPurpose.NOTIFICATIONS,
  ConsentPurpose.ANALYTICS,
]);

// ─── Consent Repository ───────────────────────────────────────────────────────

interface ConsentRow {
  consent_id: string;
  user_id: string;
  purpose: string;
  status: string;
  granted_at: Date | null;
  revoked_at: Date | null;
  privacy_notice_version: string;
  channel: string;
  language: string;
  ip_hash: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToConsent(row: ConsentRow): ConsentRecord {
  return {
    consentId: row.consent_id,
    userId: row.user_id,
    purpose: row.purpose as ConsentPurpose,
    status: row.status as ConsentStatus,
    grantedAt: row.granted_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
    privacyNoticeVersion: row.privacy_notice_version,
    channel: row.channel,
    language: row.language as SupportedLanguage,
    ipHash: row.ip_hash ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Core Consent Operations ──────────────────────────────────────────────────

/**
 * Records consent grant for one or more purposes.
 * Creates a new record if none exists; updates if already recorded.
 * Immutable audit trail: old consent records are never deleted, only superseded.
 */
export async function grantConsent(
  userId: string,
  purposes: ConsentPurpose[],
  channel: string,
  language: SupportedLanguage,
  ipHash?: string,
): Promise<ConsentRecord[]> {
  const results: ConsentRecord[] = [];

  for (const purpose of purposes) {
    // Append-only: archive old record first, then insert new
    await getPool().query(
      `UPDATE consent_records
       SET status = 'superseded', updated_at = NOW()
       WHERE user_id = $1 AND purpose = $2 AND status = 'active'`,
      [userId, purpose],
    );

    const result = await getPool().query<ConsentRow>(
      `INSERT INTO consent_records
         (consent_id, user_id, purpose, status, granted_at,
          privacy_notice_version, channel, language, ip_hash)
       VALUES ($1, $2, $3, 'active', NOW(), $4, $5, $6, $7)
       RETURNING *`,
      [
        generateUUID(),
        userId,
        purpose,
        CURRENT_PRIVACY_NOTICE_VERSION,
        channel,
        language,
        ipHash ?? null,
      ],
    );

    results.push(rowToConsent(result.rows[0]!));
  }

  logger.info('Consent granted', {
    userId,
    purposes,
    version: CURRENT_PRIVACY_NOTICE_VERSION,
    channel,
  });

  return results;
}

/**
 * Revokes consent for specific purposes.
 * MUST trigger deletion cascade for associated data (Req 9.4).
 * Returns list of data categories that must now be deleted.
 */
export async function revokeConsent(
  userId: string,
  purposes: ConsentPurpose[],
): Promise<{ revokedPurposes: ConsentPurpose[]; dataDeletionRequired: string[] }> {
  const revokedPurposes: ConsentPurpose[] = [];
  const dataDeletionRequired: string[] = [];

  for (const purpose of purposes) {
    const result = await getPool().query<ConsentRow>(
      `UPDATE consent_records
       SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
       WHERE user_id = $1 AND purpose = $2 AND status = 'active'
       RETURNING *`,
      [userId, purpose],
    );

    if (result.rowCount && result.rowCount > 0) {
      revokedPurposes.push(purpose);

      // Map purpose to data categories that must be deleted
      const deletionMap: Partial<Record<ConsentPurpose, string[]>> = {
        [ConsentPurpose.PROFILE_DATA]:        ['profile', 'demographics'],
        [ConsentPurpose.DOCUMENT_STORAGE]:    ['documents', 'document_metadata'],
        [ConsentPurpose.SCHEME_MATCHING]:     ['eligibility_scores', 'scheme_matches'],
        [ConsentPurpose.NOTIFICATIONS]:       ['notification_preferences'],
        [ConsentPurpose.ANALYTICS]:           ['usage_events', 'analytics_data'],
        [ConsentPurpose.THIRD_PARTY_SHARING]: ['portal_submissions'],
      };

      dataDeletionRequired.push(...(deletionMap[purpose] ?? []));
    }
  }

  logger.info('Consent revoked', { userId, purposes: revokedPurposes, dataDeletionRequired });
  return { revokedPurposes, dataDeletionRequired };
}

/**
 * Checks if a user has active consent for a specific purpose.
 * Used as a pre-flight check before any data processing.
 * Throws ConsentRequiredError if consent is missing (Req 9.2).
 */
export async function requireConsent(
  userId: string,
  purpose: ConsentPurpose,
): Promise<void> {
  const result = await getPool().query<{ count: string }>(
    `SELECT COUNT(*) FROM consent_records
     WHERE user_id = $1 AND purpose = $2 AND status = 'active'`,
    [userId, purpose],
  );

  const hasConsent = parseInt(result.rows[0]!.count, 10) > 0;
  if (!hasConsent) {
    throw new ConsentRequiredError(purpose);
  }
}

/**
 * Returns the full consent status for a user across all purposes.
 * Used to display the privacy dashboard.
 */
export async function getConsentStatus(userId: string): Promise<{
  granted: ConsentPurpose[];
  pending: ConsentPurpose[];
  revoked: ConsentPurpose[];
  currentNoticeVersion: string;
  noticeUrl: string;
}> {
  const result = await getPool().query<ConsentRow>(
    `SELECT DISTINCT ON (purpose) *
     FROM consent_records
     WHERE user_id = $1
     ORDER BY purpose, created_at DESC`,
    [userId],
  );

  const granted: ConsentPurpose[] = [];
  const revoked: ConsentPurpose[] = [];
  const consentedPurposes = new Set<ConsentPurpose>();

  for (const row of result.rows) {
    const purpose = row.purpose as ConsentPurpose;
    consentedPurposes.add(purpose);
    if (row.status === 'active') {
      granted.push(purpose);
    } else if (row.status === 'revoked') {
      revoked.push(purpose);
    }
  }

  const allPurposes = Object.values(ConsentPurpose);
  const pending = allPurposes.filter((p) => !consentedPurposes.has(p));

  return {
    granted,
    pending,
    revoked,
    currentNoticeVersion: CURRENT_PRIVACY_NOTICE_VERSION,
    noticeUrl: CURRENT_NOTICE_URL,
  };
}

/**
 * Gets the full audit history for a user's consent decisions.
 * Returned in the data export (Req 9.5).
 */
export async function getConsentHistory(userId: string): Promise<ConsentRecord[]> {
  const result = await getPool().query<ConsentRow>(
    `SELECT * FROM consent_records
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );
  return result.rows.map(rowToConsent);
}

// ─── Consent Validation Helpers ───────────────────────────────────────────────

export function isRequiredPurpose(purpose: ConsentPurpose): boolean {
  return REQUIRED_PURPOSES.has(purpose);
}

export function isOptionalPurpose(purpose: ConsentPurpose): boolean {
  return OPTIONAL_PURPOSES.has(purpose);
}

export function getRequiredPurposes(): ConsentPurpose[] {
  return Array.from(REQUIRED_PURPOSES);
}

export function getMissingRequiredConsents(granted: ConsentPurpose[]): ConsentPurpose[] {
  const grantedSet = new Set(granted);
  return Array.from(REQUIRED_PURPOSES).filter((p) => !grantedSet.has(p));
}
