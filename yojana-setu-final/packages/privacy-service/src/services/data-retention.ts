/**
 * Data Retention Engine
 *
 * Enforces data lifecycle policies across all services.
 *
 * Responsibilities:
 *  1. Scheduled deletion — runs nightly via cron, deletes expired records
 *  2. Right to erasure — processes user deletion requests within 30 days (PDPB)
 *  3. Anonymisation — replaces PII with pseudonymous tokens for records
 *     that must be kept for audit (e.g. application records for 7 years)
 *  4. Retention schedule verification — checks all data classes are
 *     within their permitted retention windows
 *
 * Architecture:
 *  Each service owns its own data deletion — the privacy service issues
 *  deletion commands, individual services execute them. This keeps the
 *  privacy service from needing direct DB access into other services.
 */

import { Pool } from 'pg';
import { createHash, randomBytes } from 'crypto';
import {
  type DeletionRequest,
  type DeletionResult,
  DeletionStatus,
  generateUUID,
} from '@yojana-setu/shared';
import { RETENTION_PERIODS, logger } from '../config/logger';

// ─── DB Pool ──────────────────────────────────────────────────────────────────

let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env['DATABASE_URL'],
      max: 5,
      ssl: process.env['NODE_ENV'] === 'production' ? { rejectUnauthorized: true } : false,
    });
  }
  return pool;
}

// ─── Service Endpoints (called to trigger data deletion in each service) ──────

const SERVICE_DELETION_URLS: Record<string, string> = {
  profile:         process.env['PROFILE_SERVICE_URL']    ?? 'http://profile-service:3001',
  document:        process.env['DOCUMENT_SERVICE_URL']   ?? 'http://document-service:3004',
  voice:           process.env['VOICE_SERVICE_URL']      ?? 'http://voice-service:3003',
  scheme:          process.env['SCHEME_SERVICE_URL']     ?? 'http://scheme-service:3002',
  application:     process.env['APPLICATION_SERVICE_URL'] ?? 'http://application-service:3006',
};

// ─── Pseudonymisation ────────────────────────────────────────────────────────

/**
 * Generates a stable pseudonymous token for a user.
 * Used for anonymising audit records that must be retained
 * but no longer need to be linked to a real identity.
 *
 * The salt is stored in the privacy service DB — destroying it
 * makes re-identification impossible.
 */
export function pseudonymise(userId: string, salt: string): string {
  return createHash('sha256')
    .update(`${userId}:${salt}`)
    .digest('hex')
    .slice(0, 24);
}

export function generateSalt(): string {
  return randomBytes(32).toString('hex');
}

// ─── Deletion Request Management ─────────────────────────────────────────────

export async function createDeletionRequest(
  userId: string,
  requestedBy: 'user' | 'admin' | 'system',
  reason: string,
): Promise<DeletionRequest> {
  // Check for in-flight active applications — cannot delete if applications pending
  const blockingApplications = await checkBlockingApplications(userId);
  const isBlocked = blockingApplications.length > 0;

  const result = await getPool().query<{
    request_id: string;
    user_id: string;
    status: string;
    requested_at: Date;
    scheduled_deletion_at: Date;
    completed_at: Date | null;
    blocking_reason: string | null;
  }>(
    `INSERT INTO deletion_requests
       (request_id, user_id, status, requested_by, reason,
        requested_at, scheduled_deletion_at, blocking_reason)
     VALUES ($1, $2, $3, $4, $5, NOW(),
             NOW() + INTERVAL '30 days',
             $6)
     RETURNING *`,
    [
      generateUUID(),
      userId,
      isBlocked ? DeletionStatus.BLOCKED : DeletionStatus.SCHEDULED,
      requestedBy,
      reason,
      isBlocked
        ? `Active applications: ${blockingApplications.join(', ')}`
        : null,
    ],
  );

  const row = result.rows[0]!;

  logger.info('Deletion request created', {
    userId,
    requestId: row.request_id,
    status: row.status,
    scheduledAt: row.scheduled_deletion_at,
    isBlocked,
  });

  return {
    requestId: row.request_id,
    userId: row.user_id,
    status: row.status as DeletionStatus,
    requestedAt: row.requested_at,
    scheduledDeletionAt: row.scheduled_deletion_at,
    completedAt: row.completed_at ?? undefined,
    blockingReason: row.blocking_reason ?? undefined,
  };
}

export async function processDeletionRequest(requestId: string): Promise<DeletionResult> {
  const requestResult = await getPool().query<{
    request_id: string;
    user_id: string;
    status: string;
  }>(
    'SELECT * FROM deletion_requests WHERE request_id = $1',
    [requestId],
  );

  if (!requestResult.rows[0]) {
    return { requestId, success: false, error: 'Deletion request not found' };
  }

  const request = requestResult.rows[0];
  const userId = request.user_id;

  // Verify no blocking conditions remain
  const blocking = await checkBlockingApplications(userId);
  if (blocking.length > 0) {
    return {
      requestId,
      success: false,
      error: `Cannot delete: active applications ${blocking.join(', ')}`,
    };
  }

  const deletionResults: Record<string, boolean> = {};

  // Generate pseudonymous token for audit record retention
  const salt = generateSalt();
  const pseudoId = pseudonymise(userId, salt);

  // Store the pseudonymisation mapping (destroy later to complete erasure)
  await getPool().query(
    `INSERT INTO pseudonymisation_keys (user_id, pseudo_id, salt, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE SET pseudo_id = $2, salt = $3`,
    [userId, pseudoId, salt],
  );

  // Issue deletion commands to each service
  await Promise.allSettled(
    Object.entries(SERVICE_DELETION_URLS).map(async ([service, baseUrl]) => {
      try {
        const response = await fetch(`${baseUrl}/internal/delete-user`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, pseudoId }),
          signal: AbortSignal.timeout(30_000),
        });
        deletionResults[service] = response.ok;
      } catch (err) {
        deletionResults[service] = false;
        logger.error('Deletion failed for service', {
          service, userId, error: err instanceof Error ? err.message : 'Unknown',
        });
      }
    }),
  );

  const allSucceeded = Object.values(deletionResults).every(Boolean);

  // Mark request complete
  await getPool().query(
    `UPDATE deletion_requests
     SET status = $2, completed_at = NOW(), deletion_results = $3
     WHERE request_id = $1`,
    [
      requestId,
      allSucceeded ? DeletionStatus.COMPLETED : DeletionStatus.PARTIAL,
      JSON.stringify(deletionResults),
    ],
  );

  logger.info('Deletion request processed', {
    requestId,
    userId,
    pseudoId,
    results: deletionResults,
    allSucceeded,
  });

  return {
    requestId,
    success: allSucceeded,
    deletionResults,
    pseudoId,
    completedAt: new Date(),
  };
}

// ─── Scheduled Retention Enforcement ─────────────────────────────────────────

/**
 * Runs nightly. Finds and deletes all data past its retention window.
 * Each service is responsible for its own data; this orchestrates the calls.
 */
export async function enforceRetentionPolicies(): Promise<{
  deletedItems: Record<string, number>;
  errors: string[];
}> {
  const deletedItems: Record<string, number> = {};
  const errors: string[] = [];

  // 1. Delete expired documents (90 days after completion)
  try {
    const response = await fetch(
      `${SERVICE_DELETION_URLS['document']}/internal/expire-documents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retentionDays: RETENTION_PERIODS.DOCUMENTS }),
        signal: AbortSignal.timeout(60_000),
      },
    );
    const data = await response.json() as { deletedCount: number };
    deletedItems['documents'] = data.deletedCount ?? 0;
  } catch (err) {
    errors.push(`Document retention error: ${err instanceof Error ? err.message : 'Unknown'}`);
  }

  // 2. Anonymise inactive profiles (2 years)
  try {
    const response = await fetch(
      `${SERVICE_DELETION_URLS['profile']}/internal/anonymise-inactive`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inactiveDays: RETENTION_PERIODS.INACTIVE_PROFILE }),
        signal: AbortSignal.timeout(60_000),
      },
    );
    const data = await response.json() as { anonymisedCount: number };
    deletedItems['inactive_profiles'] = data.anonymisedCount ?? 0;
  } catch (err) {
    errors.push(`Profile anonymisation error: ${err instanceof Error ? err.message : 'Unknown'}`);
  }

  // 3. Purge old conversation history (12 months)
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_PERIODS.CONVERSATION_HISTORY);

    const result = await getPool().query<{ count: string }>(
      `WITH deleted AS (
         DELETE FROM conversation_history
         WHERE occurred_at < $1
         RETURNING 1
       ) SELECT COUNT(*) FROM deleted`,
      [cutoff],
    );
    deletedItems['conversation_history'] = parseInt(result.rows[0]!.count, 10);
  } catch (err) {
    errors.push(`Conversation history error: ${err instanceof Error ? err.message : 'Unknown'}`);
  }

  // 4. Process overdue deletion requests
  const overdueRequests = await getPool().query<{ request_id: string }>(
    `SELECT request_id FROM deletion_requests
     WHERE status = 'scheduled'
       AND scheduled_deletion_at <= NOW()`,
  );

  for (const row of overdueRequests.rows) {
    const result = await processDeletionRequest(row.request_id);
    if (!result.success) {
      errors.push(`Deletion request ${row.request_id} failed: ${result.error ?? 'Unknown'}`);
    }
  }
  deletedItems['deletion_requests_processed'] = overdueRequests.rows.length;

  logger.info('Retention policies enforced', { deletedItems, errorCount: errors.length });
  return { deletedItems, errors };
}

// ─── Data Export (Right to Access, Req 9.5) ──────────────────────────────────

/**
 * Generates a complete data export for a user.
 * Called when user requests their data under PDPB right to access.
 */
export async function generateDataExport(userId: string): Promise<{
  exportId: string;
  generatedAt: Date;
  data: Record<string, unknown>;
}> {
  const exportId = generateUUID();

  // Collect data from all services
  const [profileData, applicationData, consentHistory] = await Promise.allSettled([
    fetch(`${SERVICE_DELETION_URLS['profile']}/internal/export/${userId}`)
      .then((r) => r.json()),
    fetch(`${SERVICE_DELETION_URLS['application']}/applications/user/${userId}`)
      .then((r) => r.json()),
    getPool().query<{ purpose: string; status: string; created_at: Date }>(
      `SELECT purpose, status, created_at FROM consent_records
       WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    ).then((r) => r.rows),
  ]);

  const exportData = {
    exportId,
    userId,
    generatedAt: new Date().toISOString(),
    profile: profileData.status === 'fulfilled' ? profileData.value : null,
    applications: applicationData.status === 'fulfilled' ? applicationData.value : null,
    consentHistory: consentHistory.status === 'fulfilled' ? consentHistory.value : [],
    retentionPolicies: RETENTION_PERIODS,
    privacyNoticeUrl: 'https://yojana-setu.gov.in/privacy/v2',
  };

  logger.info('Data export generated', { userId, exportId });

  return { exportId, generatedAt: new Date(), data: exportData };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function checkBlockingApplications(userId: string): Promise<string[]> {
  try {
    const response = await fetch(
      `${SERVICE_DELETION_URLS['application']}/applications/user/${userId}`,
    );
    const data = await response.json() as { data: Array<{ referenceNumber: string; status: string }> };
    const active = (data.data ?? []).filter(
      (a) => !['withdrawn', 'rejected', 'disbursed', 'completed'].includes(a.status),
    );
    return active.map((a) => a.referenceNumber);
  } catch {
    return []; // If we can't check, don't block deletion
  }
}
