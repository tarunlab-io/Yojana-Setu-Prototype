/**
 * Test helpers — exports internal pure functions for unit testing.
 * Only imported by test files, never in production code.
 */

import { createHash } from 'crypto';
import type { AuditEntry } from './audit-logger';

export function computeContentHashForTest(entry: AuditEntry): string {
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
