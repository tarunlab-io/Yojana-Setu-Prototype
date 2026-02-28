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
import {
  computeContentHashForTest,
} from '../../services/audit-logger.test-helpers';
import { ConsentPurpose } from '@yojana-setu/shared';
import { RETENTION_PERIODS } from '../../config/logger';

// ─── Consent Purpose Classification ──────────────────────────────────────────

describe('Consent purpose classification', () => {
  it('PROFILE_DATA is a required purpose', () => {
    expect(isRequiredPurpose(ConsentPurpose.PROFILE_DATA)).toBe(true);
  });

  it('SCHEME_MATCHING is a required purpose', () => {
    expect(isRequiredPurpose(ConsentPurpose.SCHEME_MATCHING)).toBe(true);
  });

  it('THIRD_PARTY_SHARING is a required purpose', () => {
    expect(isRequiredPurpose(ConsentPurpose.THIRD_PARTY_SHARING)).toBe(true);
  });

  it('ANALYTICS is an optional purpose', () => {
    expect(isOptionalPurpose(ConsentPurpose.ANALYTICS)).toBe(true);
  });

  it('NOTIFICATIONS is an optional purpose', () => {
    expect(isOptionalPurpose(ConsentPurpose.NOTIFICATIONS)).toBe(true);
  });

  it('no purpose is both required and optional', () => {
    for (const purpose of Object.values(ConsentPurpose)) {
      const req = isRequiredPurpose(purpose);
      const opt = isOptionalPurpose(purpose);
      expect(req && opt).toBe(false);
    }
  });

  it('getRequiredPurposes returns all required purposes', () => {
    const required = getRequiredPurposes();
    expect(required).toContain(ConsentPurpose.PROFILE_DATA);
    expect(required).toContain(ConsentPurpose.SCHEME_MATCHING);
    expect(required).toContain(ConsentPurpose.THIRD_PARTY_SHARING);
  });
});

// ─── getMissingRequiredConsents ───────────────────────────────────────────────

describe('getMissingRequiredConsents', () => {
  it('returns empty array when all required consents are granted', () => {
    const all = getRequiredPurposes();
    expect(getMissingRequiredConsents(all)).toHaveLength(0);
  });

  it('returns missing purposes when none are granted', () => {
    const missing = getMissingRequiredConsents([]);
    expect(missing.length).toBeGreaterThan(0);
    for (const m of missing) {
      expect(isRequiredPurpose(m)).toBe(true);
    }
  });

  it('returns only the missing purposes', () => {
    const granted = [ConsentPurpose.PROFILE_DATA]; // Missing SCHEME_MATCHING, THIRD_PARTY_SHARING
    const missing = getMissingRequiredConsents(granted);
    expect(missing).not.toContain(ConsentPurpose.PROFILE_DATA);
    expect(missing).toContain(ConsentPurpose.SCHEME_MATCHING);
    expect(missing).toContain(ConsentPurpose.THIRD_PARTY_SHARING);
  });

  it('optional purposes are never in the missing list', () => {
    const missing = getMissingRequiredConsents([]);
    for (const m of missing) {
      expect(isOptionalPurpose(m)).toBe(false);
    }
  });
});

// ─── Pseudonymisation ─────────────────────────────────────────────────────────

describe('pseudonymise', () => {
  it('produces a consistent output for the same userId and salt', () => {
    const userId = 'user-123';
    const salt = 'test-salt-abc';
    expect(pseudonymise(userId, salt)).toBe(pseudonymise(userId, salt));
  });

  it('produces different tokens for different userIds with the same salt', () => {
    const salt = 'same-salt';
    const a = pseudonymise('user-A', salt);
    const b = pseudonymise('user-B', salt);
    expect(a).not.toBe(b);
  });

  it('produces different tokens for the same userId with different salts', () => {
    const userId = 'user-123';
    const a = pseudonymise(userId, 'salt-1');
    const b = pseudonymise(userId, 'salt-2');
    expect(a).not.toBe(b);
  });

  it('pseudo-token is 24 hex characters', () => {
    const token = pseudonymise('user-abc', 'salt-xyz');
    expect(token).toMatch(/^[a-f0-9]{24}$/);
  });

  it('pseudo-token does not contain the original userId', () => {
    const userId = 'priya-sharma-1234';
    const token = pseudonymise(userId, generateSalt());
    expect(token).not.toContain(userId);
    expect(token).not.toContain('priya');
  });
});

describe('generateSalt', () => {
  it('generates a 64-character hex string', () => {
    const salt = generateSalt();
    expect(salt).toMatch(/^[a-f0-9]{64}$/);
  });

  it('generates unique salts on each call', () => {
    const salts = new Set(Array.from({ length: 20 }, generateSalt));
    expect(salts.size).toBe(20);
  });
});

// ─── Retention Periods ────────────────────────────────────────────────────────

describe('Retention periods configuration', () => {
  it('consent records are retained forever (null)', () => {
    expect(RETENTION_PERIODS.CONSENT_RECORDS).toBeNull();
  });

  it('active profiles are retained forever (null)', () => {
    expect(RETENTION_PERIODS.ACTIVE_PROFILE).toBeNull();
  });

  it('application records are retained for 7 years', () => {
    expect(RETENTION_PERIODS.APPLICATION_RECORDS).toBe(365 * 7);
  });

  it('documents are retained for 90 days', () => {
    expect(RETENTION_PERIODS.DOCUMENTS).toBe(90);
  });

  it('inactive profiles are deleted after 2 years', () => {
    expect(RETENTION_PERIODS.INACTIVE_PROFILE).toBe(365 * 2);
  });

  it('all finite retention periods are positive integers', () => {
    for (const [key, value] of Object.entries(RETENTION_PERIODS)) {
      if (value !== null) {
        expect(typeof value).toBe('number');
        expect(value).toBeGreaterThan(0);
        expect(Number.isInteger(value)).toBe(true);
      }
    }
  });

  it('audit logs outlive documents and conversation history', () => {
    expect(RETENTION_PERIODS.AUDIT_LOGS).toBeGreaterThan(RETENTION_PERIODS.DOCUMENTS);
    expect(RETENTION_PERIODS.AUDIT_LOGS).toBeGreaterThan(
      RETENTION_PERIODS.CONVERSATION_HISTORY,
    );
  });

  it('application records outlive audit logs', () => {
    expect(RETENTION_PERIODS.APPLICATION_RECORDS).toBeGreaterThan(
      RETENTION_PERIODS.AUDIT_LOGS,
    );
  });
});
