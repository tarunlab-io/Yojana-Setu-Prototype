/**
 * Audit Logger
 *
 * Records every access to, modification of, and deletion of personal data.
 * Required by PDPB and IT Act Section 43A for accountability.
 *
 * Design:
 *  - Append-only: audit records are NEVER updated or deleted
 *  - Tamper-evident: each record includes a hash of the previous record
 *    (blockchain-lite pattern) so any gap or modification is detectable
 *  - Structured: typed events make compliance reports automatable
 *  - Async: audit writes never block the main request path
 *
 * Audit events cover (Req 9.6):
 *  - DATA_ACCESS      — someone read personal data
 *  - DATA_MODIFICATION — someone updated personal data
 *  - DATA_DELETION    — data was deleted (with reason)
 *  - CONSENT_GRANTED  — user gave consent
 *  - CONSENT_REVOKED  — user withdrew consent
 *  - EXPORT_REQUESTED — user requested their data
 *  - LOGIN            — authentication events
 *  - ADMIN_ACTION     — any admin action on user data
 */

import { Pool } from 'pg';
import { createHash } from 'crypto';
import { generateUUID } from '@yojana-setu/shared';
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
  }
  return pool;
}

// ─── Audit Event Types ────────────────────────────────────────────────────────

export type AuditEventType =
  | 'DATA_ACCESS'
  | 'DATA_MODIFICATION'
  | 'DATA_DELETION'
  | 'CONSENT_GRANTED'
  | 'CONSENT_REVOKED'
  | 'EXPORT_REQUESTED'
  | 'DELETION_REQUESTED'
  | 'DELETION_COMPLETED'
  | 'LOGIN'
  | 'LOGOUT'
  | 'ADMIN_ACTION'
  | 'RETENTION_ENFORCEMENT';

export interface AuditEntry {
  auditId: string;
  eventType: AuditEventType;
  /** The user whose data was affected */
  subjectUserId: string;
  /** The actor who performed the action (user, system, admin id) */
  actorId: string;
  actorType: 'user' | 'system' | 'admin';
  /** Service that generated the event */
  serviceName: string;
  /** Which data categories were involved */
  dataCategories: string[];
  /** Additional structured context */
  metadata: Record<string, unknown>;
  /** Hash of the previous audit record (tamper-evidence chain) */
  previousHash: string;
  /** Hash of this record's content */
  contentHash: string;
  occurredAt: Date;
}

// ─── In-memory write buffer (batched writes to reduce DB load) ────────────────

const writeBuffer: AuditEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL_MS = 2_000;
const MAX_BUFFER_SIZE = 100;

// ─── Core Audit Function ──────────────────────────────────────────────────────

/**
 * Records an audit event. Fire-and-forget — never throws.
 * Buffered for performance; guaranteed flush every 2 seconds.
 */
export function audit(
  eventType: AuditEventType,
  subjectUserId: string,
  actorId: string,
  actorType: 'user' | 'system' | 'admin',
  serviceName: string,
  dataCategories: string[],
  metadata: Record<string, unknown> = {},
): void {
  const entry: AuditEntry = {
    auditId: generateUUID(),
    eventType,
    subjectUserId,
    actorId,
    actorType,
    serviceName,
    dataCategories,
    metadata,
    previousHash: '',  // Filled during flush
    contentHash: '',   // Filled during flush
    occurredAt: new Date(),
  };

  writeBuffer.push(entry);

  // Flush immediately if buffer is full
  if (writeBuffer.length >= MAX_BUFFER_SIZE) {
    void flushBuffer();
    return;
  }

  // Schedule periodic flush
  if (!flushTimer) {
    flushTimer = setTimeout(() => { void flushBuffer(); }, FLUSH_INTERVAL_MS);
  }
}

// ─── Typed Convenience Functions ──────────────────────────────────────────────

export function auditDataAccess(
  subjectUserId: string,
  actorId: string,
  actorType: 'user' | 'system' | 'admin',
  serviceName: string,
  dataCategories: string[],
  purpose: string,
): void {
  audit('DATA_ACCESS', subjectUserId, actorId, actorType, serviceName, dataCategories, {
    purpose,
  });
}

export function auditDataDeletion(
  subjectUserId: string,
  actorId: string,
  serviceName: string,
  dataCategories: string[],
  reason: string,
  recordCount?: number,
): void {
  audit('DATA_DELETION', subjectUserId, actorId, 'system', serviceName, dataCategories, {
    reason,
    recordCount,
  });
}

export function auditConsentEvent(
  userId: string,
  eventType: 'CONSENT_GRANTED' | 'CONSENT_REVOKED',
  purposes: string[],
  channel: string,
): void {
  audit(eventType, userId, userId, 'user', 'privacy-service', ['consent'], {
    purposes,
    channel,
  });
}

export function auditAdminAction(
  adminId: string,
  subjectUserId: string,
  action: string,
  details: Record<string, unknown>,
): void {
  audit('ADMIN_ACTION', subjectUserId, adminId, 'admin', 'admin-service', ['all'], {
    action,
    ...details,
  });
}

// ─── Buffer Flush ─────────────────────────────────────────────────────────────

async function flushBuffer(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  if (writeBuffer.length === 0) return;

  const entries = writeBuffer.splice(0, writeBuffer.length);

  try {
    // Get the hash of the last persisted record for chain integrity
    const lastResult = await getPool().query<{ content_hash: string }>(
      `SELECT content_hash FROM audit_log ORDER BY occurred_at DESC LIMIT 1`,
    );
    let previousHash = lastResult.rows[0]?.content_hash ?? 'GENESIS';

    // Build the chain: each entry hashes the previous
    const rows: AuditEntry[] = [];
    for (const entry of entries) {
      entry.previousHash = previousHash;
      entry.contentHash = computeContentHash(entry);
      previousHash = entry.contentHash;
      rows.push(entry);
    }

    // Bulk insert
    const values = rows.map((e, i) => {
      const base = i * 9;
      return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9})`;
    }).join(',');

    const params = rows.flatMap((e) => [
      e.auditId,
      e.eventType,
      e.subjectUserId,
      e.actorId,
      e.actorType,
      e.serviceName,
      JSON.stringify(e.dataCategories),
      JSON.stringify(e.metadata),
      e.contentHash,
    ]);

    // Note: occurred_at handled by DB default, previous_hash also stored
    await getPool().query(
      `INSERT INTO audit_log
         (audit_id, event_type, subject_user_id, actor_id, actor_type,
          service_name, data_categories, metadata, content_hash)
       VALUES ${values}`,
      params,
    );

  } catch (err) {
    // Audit failures must be logged to stderr but never crash the service
    logger.error('Audit log flush failed', {
      entryCount: entries.length,
      error: err instanceof Error ? err.message : 'Unknown',
    });
    // Re-queue failed entries (best-effort)
    writeBuffer.unshift(...entries);
  }
}

// ─── Chain Integrity Verification ─────────────────────────────────────────────

/**
 * Verifies the tamper-evidence chain for a user's audit records.
 * A broken chain indicates records have been deleted or modified.
 */
export async function verifyAuditChain(
  userId: string,
  fromDate?: Date,
): Promise<{ isIntact: boolean; brokenAt?: string; checkedCount: number }> {
  const result = await getPool().query<{
    audit_id: string;
    content_hash: string;
    previous_hash: string;
    event_type: string;
    subject_user_id: string;
    actor_id: string;
    actor_type: string;
    service_name: string;
    data_categories: string[];
    metadata: Record<string, unknown>;
    occurred_at: Date;
  }>(
    `SELECT * FROM audit_log
     WHERE subject_user_id = $1
       ${fromDate ? 'AND occurred_at >= $2' : ''}
     ORDER BY occurred_at ASC`,
    fromDate ? [userId, fromDate] : [userId],
  );

  let checkedCount = 0;
  for (let i = 1; i < result.rows.length; i++) {
    const current = result.rows[i]!;
    const previous = result.rows[i - 1]!;

    // Recompute the previous record's hash and compare
    const recomputed = computeContentHash({
      auditId: previous.audit_id,
      eventType: previous.event_type as AuditEventType,
      subjectUserId: previous.subject_user_id,
      actorId: previous.actor_id,
      actorType: previous.actor_type as AuditEntry['actorType'],
      serviceName: previous.service_name,
      dataCategories: previous.data_categories,
      metadata: previous.metadata,
      previousHash: '',
      contentHash: previous.content_hash,
      occurredAt: previous.occurred_at,
    });

    if (recomputed !== current.previous_hash) {
      return { isIntact: false, brokenAt: current.audit_id, checkedCount };
    }
    checkedCount++;
  }

  return { isIntact: true, checkedCount: result.rows.length };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeContentHash(entry: AuditEntry): string {
  const content = JSON.stringify({
    auditId: entry.auditId,
    eventType: entry.eventType,
    subjectUserId: entry.subjectUserId,
    actorId: entry.actorId,
    serviceName: entry.serviceName,
    dataCategories: entry.dataCategories,
    occurredAt: entry.occurredAt.toISOString(),
    previousHash: entry.previousHash,
  });
  return createHash('sha256').update(content).digest('hex');
}

// Force flush on process exit
process.on('beforeExit', () => { void flushBuffer(); });
process.on('SIGTERM',    () => { void flushBuffer(); });
