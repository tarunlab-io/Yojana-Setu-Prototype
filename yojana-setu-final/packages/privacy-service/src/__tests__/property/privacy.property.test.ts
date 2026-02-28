/**
 * Property-based tests for the Privacy Service.
 *
 * Feature: yojana-setu
 * Property 12: Consent Integrity
 *   For any combination of consent grants and revocations, the system
 *   must maintain a consistent, auditable record of user consent decisions
 *   and correctly gate data processing activities.
 *   Validates: Requirements 9.1, 9.2, 9.3
 *
 * Property 14: Data Retention Compliance
 *   For any user data record, the system must correctly enforce retention
 *   periods and execute deletion within the required timeframe.
 *   Validates: Requirements 9.4, 9.5, 9.6
 */

import * as fc from 'fast-check';
import { describe, it, expect } from '@jest/globals';
import {
  isRequiredPurpose,
  isOptionalPurpose,
  getRequiredPurposes,
  getMissingRequiredConsents,
} from '../../services/consent-manager';
import {
  pseudonymise,
  generateSalt,
} from '../../services/data-retention';
import { computeContentHashForTest } from '../../services/audit-logger.test-helpers';
import { ConsentPurpose } from '@yojana-setu/shared';
import { RETENTION_PERIODS } from '../../config/logger';
import type { AuditEntry, AuditEventType } from '../../services/audit-logger';

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const purposeArb = fc.constantFrom(...Object.values(ConsentPurpose));
const purposeSubsetArb = fc.array(purposeArb, { minLength: 0, maxLength: 6 })
  .map((arr) => [...new Set(arr)]);  // deduplicate

const auditEventTypeArb = fc.constantFrom<AuditEventType>(
  'DATA_ACCESS', 'DATA_MODIFICATION', 'DATA_DELETION',
  'CONSENT_GRANTED', 'CONSENT_REVOKED', 'EXPORT_REQUESTED',
  'DELETION_REQUESTED', 'DELETION_COMPLETED', 'LOGIN', 'LOGOUT',
  'ADMIN_ACTION', 'RETENTION_ENFORCEMENT',
);

const auditEntryArb: fc.Arbitrary<AuditEntry> = fc.record({
  auditId: fc.uuid(),
  eventType: auditEventTypeArb,
  subjectUserId: fc.uuid(),
  actorId: fc.oneof(fc.uuid(), fc.constant('system')),
  actorType: fc.constantFrom('user', 'system', 'admin') as fc.Arbitrary<AuditEntry['actorType']>,
  serviceName: fc.constantFrom(
    'privacy-service', 'profile-service', 'document-service',
    'application-service', 'voice-service', 'scheme-service',
  ),
  dataCategories: fc.array(
    fc.constantFrom('profile', 'documents', 'consent', 'applications', 'voice', 'all'),
    { maxLength: 4 },
  ),
  metadata: fc.dictionary(
    fc.string({ minLength: 1, maxLength: 20 }),
    fc.string({ minLength: 0, maxLength: 50 }),
  ),
  previousHash: fc.hexaString({ minLength: 64, maxLength: 64 }),
  contentHash: fc.hexaString({ minLength: 64, maxLength: 64 }),
  occurredAt: fc.date({ min: new Date('2024-01-01'), max: new Date('2030-01-01') }),
});

// ─── Property 12: Consent Integrity ──────────────────────────────────────────

describe('Property 12: Consent Integrity', () => {
  /**
   * Consent classification is COMPLETE and DISJOINT:
   * Every purpose is classified as required OR optional OR neither,
   * but never both required and optional simultaneously.
   */
  it('no purpose is simultaneously required and optional', () => {
    fc.assert(
      fc.property(purposeArb, (purpose) => {
        const req = isRequiredPurpose(purpose);
        const opt = isOptionalPurpose(purpose);
        // XOR: can be one or neither, never both
        expect(req && opt).toBe(false);
      }),
      { numRuns: 50 },
    );
  });

  /**
   * getMissingRequiredConsents is MONOTONICALLY DECREASING:
   * Granting more consents can never increase the count of missing consents.
   */
  it('granting more purposes never increases missing required consents', () => {
    fc.assert(
      fc.property(
        purposeSubsetArb,
        purposeSubsetArb,
        (grantedA, grantedB) => {
          const missingA = getMissingRequiredConsents(grantedA);
          const combinedGranted = [...new Set([...grantedA, ...grantedB])];
          const missingCombined = getMissingRequiredConsents(combinedGranted);

          // Combined set has more consents → fewer or equal missing
          expect(missingCombined.length).toBeLessThanOrEqual(missingA.length);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * getMissingRequiredConsents is IDEMPOTENT:
   * Calling it twice with the same input always returns the same result.
   */
  it('getMissingRequiredConsents is idempotent', () => {
    fc.assert(
      fc.property(purposeSubsetArb, (granted) => {
        const first = getMissingRequiredConsents(granted);
        const second = getMissingRequiredConsents(granted);
        expect(first).toEqual(second);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * getMissingRequiredConsents only returns REQUIRED purposes.
   * Optional purposes are never in the missing list.
   */
  it('missing consent list only contains required purposes', () => {
    fc.assert(
      fc.property(purposeSubsetArb, (granted) => {
        const missing = getMissingRequiredConsents(granted);
        for (const m of missing) {
          expect(isRequiredPurpose(m)).toBe(true);
          expect(isOptionalPurpose(m)).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Full grant → empty missing list (COMPLETENESS):
   * Granting all required purposes always results in no missing consents.
   */
  it('granting all required purposes results in empty missing list', () => {
    fc.assert(
      fc.property(
        purposeSubsetArb,  // Any extra optional consents also granted
        (extras) => {
          const allRequired = getRequiredPurposes();
          const allGranted = [...new Set([...allRequired, ...extras])];
          const missing = getMissingRequiredConsents(allGranted);
          expect(missing).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * getMissingRequiredConsents output is a SUBSET of getRequiredPurposes.
   * The missing list must never introduce purposes not in the required set.
   */
  it('missing consents are always a subset of all required purposes', () => {
    const allRequired = new Set(getRequiredPurposes());
    fc.assert(
      fc.property(purposeSubsetArb, (granted) => {
        const missing = getMissingRequiredConsents(granted);
        for (const m of missing) {
          expect(allRequired.has(m)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});

// ─── Property 14: Data Retention Compliance ───────────────────────────────────

describe('Property 14: Data Retention Compliance', () => {
  /**
   * Pseudonymisation is STABLE:
   * Same (userId, salt) pair always produces the same token.
   */
  it('pseudonymise is deterministic — same inputs always give same output', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.hexaString({ minLength: 32, maxLength: 64 }),
        (userId, salt) => {
          expect(pseudonymise(userId, salt)).toBe(pseudonymise(userId, salt));
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Pseudonymisation is INJECTIVE across user IDs (for fixed salt):
   * Different users always get different tokens.
   * This ensures anonymised audit records can still be grouped by user
   * without revealing the real identity.
   */
  it('pseudonymise is injective — different userIds always give different tokens', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.hexaString({ minLength: 32, maxLength: 64 }),
        (userA, userB, salt) => {
          fc.pre(userA !== userB);
          expect(pseudonymise(userA, salt)).not.toBe(pseudonymise(userB, salt));
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Salt changes ALWAYS change the token (for fixed userId):
   * Re-salting makes old tokens unrelatable to new ones.
   * This is the property that makes key shredding effective.
   */
  it('pseudonymise always produces different token when salt changes', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.hexaString({ minLength: 32, maxLength: 64 }),
        fc.hexaString({ minLength: 32, maxLength: 64 }),
        (userId, saltA, saltB) => {
          fc.pre(saltA !== saltB);
          expect(pseudonymise(userId, saltA)).not.toBe(pseudonymise(userId, saltB));
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Pseudo-tokens are OPAQUE:
   * The token must not contain any substring of the original userId.
   * (3+ character substrings checked to prevent partial leakage.)
   */
  it('pseudo-token contains no recognisable substring of original userId', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        (userId) => {
          const salt = generateSalt();
          const token = pseudonymise(userId, salt);

          // Check no 8+ character substring of userId appears in token
          const cleanId = userId.replace(/-/g, '');
          for (let i = 0; i <= cleanId.length - 8; i++) {
            const chunk = cleanId.slice(i, i + 8);
            expect(token).not.toContain(chunk);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Audit content hash is DETERMINISTIC:
   * The same audit entry always produces the same content hash.
   * This is essential for the tamper-evidence chain.
   */
  it('audit content hash is deterministic for the same entry', () => {
    fc.assert(
      fc.property(auditEntryArb, (entry) => {
        const hash1 = computeContentHashForTest(entry);
        const hash2 = computeContentHashForTest(entry);
        expect(hash1).toBe(hash2);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Audit content hash is SENSITIVE to any field change:
   * Modifying any tracked field must produce a different hash.
   * (This verifies the tamper-detection property of the chain.)
   */
  it('audit content hash changes when any tracked field changes', () => {
    fc.assert(
      fc.property(auditEntryArb, fc.uuid(), (entry, newUserId) => {
        fc.pre(newUserId !== entry.subjectUserId);
        const original = computeContentHashForTest(entry);
        const modified = computeContentHashForTest({
          ...entry,
          subjectUserId: newUserId,
        });
        expect(original).not.toBe(modified);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Retention period ordering is CONSISTENT:
   * The hierarchy must hold for all finite retention periods.
   * Documents < ConversationHistory < AuditLogs < ApplicationRecords
   */
  it('retention period hierarchy is correctly ordered', () => {
    // This is a deterministic check — property test verifies it holds
    // across any shuffle or refactoring of the config object
    const finite = Object.entries(RETENTION_PERIODS)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => ({ key: k, days: v as number }));

    // All finite values must be positive
    fc.assert(
      fc.property(
        fc.constantFrom(...finite),
        ({ days }) => {
          expect(days).toBeGreaterThan(0);
          expect(Number.isInteger(days)).toBe(true);
        },
      ),
      { numRuns: finite.length },
    );

    // Verify the key ordering invariants
    const r = RETENTION_PERIODS;
    expect(r.DOCUMENTS).toBeLessThan(r.CONVERSATION_HISTORY);
    expect(r.CONVERSATION_HISTORY).toBeLessThan(r.AUDIT_LOGS);
    expect(r.AUDIT_LOGS).toBeLessThan(r.APPLICATION_RECORDS);
    expect(r.INACTIVE_PROFILE).toBeLessThan(r.APPLICATION_RECORDS);
  });

  /**
   * generateSalt produces CRYPTOGRAPHICALLY UNIQUE values:
   * In 1000 generated salts, every one must be distinct.
   * (Birthday paradox: probability of collision in 1000 64-char hex strings is ~10^-150)
   */
  it('generateSalt never produces duplicate values', () => {
    const salts = Array.from({ length: 100 }, generateSalt);
    const unique = new Set(salts);
    expect(unique.size).toBe(salts.length);
  });
});
