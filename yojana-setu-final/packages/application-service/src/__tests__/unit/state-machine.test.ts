import { describe, it, expect } from '@jest/globals';
import {
  isValidTransition,
  assertValidTransition,
  isTerminalState,
  getAllowedTransitions,
  generateReferenceNumber,
  buildStatusEvent,
  getExpectedCompletionDate,
  isOverdue,
} from '../../services/application-state-machine';
import {
  ApplicationStatus,
  ApplicationEventType,
  InvalidStatusTransitionError,
} from '@yojana-setu/shared';

// ─── isValidTransition ────────────────────────────────────────────────────────

describe('isValidTransition', () => {
  describe('valid transitions', () => {
    const validPaths: [ApplicationStatus, ApplicationStatus][] = [
      [ApplicationStatus.DRAFT,              ApplicationStatus.SUBMITTED],
      [ApplicationStatus.DRAFT,              ApplicationStatus.WITHDRAWN],
      [ApplicationStatus.SUBMITTED,          ApplicationStatus.UNDER_REVIEW],
      [ApplicationStatus.SUBMITTED,          ApplicationStatus.DOCUMENTS_REQUIRED],
      [ApplicationStatus.SUBMITTED,          ApplicationStatus.WITHDRAWN],
      [ApplicationStatus.UNDER_REVIEW,       ApplicationStatus.APPROVED],
      [ApplicationStatus.UNDER_REVIEW,       ApplicationStatus.REJECTED],
      [ApplicationStatus.UNDER_REVIEW,       ApplicationStatus.DOCUMENTS_REQUIRED],
      [ApplicationStatus.DOCUMENTS_REQUIRED, ApplicationStatus.UNDER_REVIEW],
      [ApplicationStatus.DOCUMENTS_REQUIRED, ApplicationStatus.WITHDRAWN],
      [ApplicationStatus.APPROVED,           ApplicationStatus.DISBURSED],
    ];

    for (const [from, to] of validPaths) {
      it(`allows ${from} → ${to}`, () => {
        expect(isValidTransition(from, to)).toBe(true);
      });
    }
  });

  describe('invalid transitions', () => {
    const invalidPaths: [ApplicationStatus, ApplicationStatus][] = [
      [ApplicationStatus.DRAFT,     ApplicationStatus.APPROVED],
      [ApplicationStatus.DRAFT,     ApplicationStatus.DISBURSED],
      [ApplicationStatus.SUBMITTED, ApplicationStatus.DISBURSED],
      [ApplicationStatus.APPROVED,  ApplicationStatus.REJECTED],
      [ApplicationStatus.APPROVED,  ApplicationStatus.UNDER_REVIEW],
      [ApplicationStatus.DISBURSED, ApplicationStatus.APPROVED],     // terminal
      [ApplicationStatus.REJECTED,  ApplicationStatus.UNDER_REVIEW], // terminal
      [ApplicationStatus.WITHDRAWN, ApplicationStatus.SUBMITTED],    // terminal
    ];

    for (const [from, to] of invalidPaths) {
      it(`blocks ${from} → ${to}`, () => {
        expect(isValidTransition(from, to)).toBe(false);
      });
    }
  });

  it('self-transitions are invalid', () => {
    for (const status of Object.values(ApplicationStatus)) {
      expect(isValidTransition(status, status)).toBe(false);
    }
  });
});

// ─── assertValidTransition ────────────────────────────────────────────────────

describe('assertValidTransition', () => {
  it('does not throw for valid transitions', () => {
    expect(() =>
      assertValidTransition('app-1', ApplicationStatus.DRAFT, ApplicationStatus.SUBMITTED),
    ).not.toThrow();
  });

  it('throws InvalidStatusTransitionError for invalid transitions', () => {
    expect(() =>
      assertValidTransition('app-1', ApplicationStatus.DISBURSED, ApplicationStatus.APPROVED),
    ).toThrow(InvalidStatusTransitionError);
  });

  it('includes applicationId in the error', () => {
    try {
      assertValidTransition('app-xyz', ApplicationStatus.REJECTED, ApplicationStatus.SUBMITTED);
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidStatusTransitionError);
      expect((err as Error).message).toContain('app-xyz');
    }
  });
});

// ─── isTerminalState ──────────────────────────────────────────────────────────

describe('isTerminalState', () => {
  it('correctly identifies terminal states', () => {
    expect(isTerminalState(ApplicationStatus.DISBURSED)).toBe(true);
    expect(isTerminalState(ApplicationStatus.REJECTED)).toBe(true);
    expect(isTerminalState(ApplicationStatus.WITHDRAWN)).toBe(true);
  });

  it('correctly identifies non-terminal states', () => {
    expect(isTerminalState(ApplicationStatus.DRAFT)).toBe(false);
    expect(isTerminalState(ApplicationStatus.SUBMITTED)).toBe(false);
    expect(isTerminalState(ApplicationStatus.UNDER_REVIEW)).toBe(false);
    expect(isTerminalState(ApplicationStatus.DOCUMENTS_REQUIRED)).toBe(false);
    expect(isTerminalState(ApplicationStatus.APPROVED)).toBe(false);
  });
});

// ─── getAllowedTransitions ────────────────────────────────────────────────────

describe('getAllowedTransitions', () => {
  it('returns empty array for terminal states', () => {
    expect(getAllowedTransitions(ApplicationStatus.DISBURSED)).toHaveLength(0);
    expect(getAllowedTransitions(ApplicationStatus.REJECTED)).toHaveLength(0);
    expect(getAllowedTransitions(ApplicationStatus.WITHDRAWN)).toHaveLength(0);
  });

  it('returns at least one transition for non-terminal states', () => {
    const nonTerminal = [
      ApplicationStatus.DRAFT,
      ApplicationStatus.SUBMITTED,
      ApplicationStatus.UNDER_REVIEW,
      ApplicationStatus.DOCUMENTS_REQUIRED,
      ApplicationStatus.APPROVED,
    ];
    for (const status of nonTerminal) {
      expect(getAllowedTransitions(status).length).toBeGreaterThan(0);
    }
  });

  it('all returned transitions are valid', () => {
    for (const status of Object.values(ApplicationStatus)) {
      for (const next of getAllowedTransitions(status)) {
        expect(isValidTransition(status, next)).toBe(true);
      }
    }
  });
});

// ─── generateReferenceNumber ──────────────────────────────────────────────────

describe('generateReferenceNumber', () => {
  it('generates correctly formatted reference number', () => {
    const ref = generateReferenceNumber(142);
    expect(ref).toMatch(/^YS-\d{4}-\d{5}$/);
    expect(ref).toContain('YS-');
    expect(ref.split('-')[2]).toBe('00142');
  });

  it('pads sequence number with leading zeros', () => {
    expect(generateReferenceNumber(1).split('-')[2]).toBe('00001');
    expect(generateReferenceNumber(9999).split('-')[2]).toBe('09999');
    expect(generateReferenceNumber(99999).split('-')[2]).toBe('99999');
  });

  it('includes the current year', () => {
    const ref = generateReferenceNumber(1);
    const year = new Date().getFullYear().toString();
    expect(ref).toContain(year);
  });
});

// ─── buildStatusEvent ─────────────────────────────────────────────────────────

describe('buildStatusEvent', () => {
  it('builds a well-formed event with all required fields', () => {
    const event = buildStatusEvent(
      'app-1',
      ApplicationStatus.DRAFT,
      ApplicationStatus.SUBMITTED,
      'user',
      'Submitted via WhatsApp',
    );
    expect(event.applicationId).toBe('app-1');
    expect(event.fromStatus).toBe(ApplicationStatus.DRAFT);
    expect(event.toStatus).toBe(ApplicationStatus.SUBMITTED);
    expect(event.triggeredBy).toBe('user');
    expect(event.note).toBe('Submitted via WhatsApp');
    expect(event.eventType).toBe(ApplicationEventType.SUBMITTED);
    expect(event.occurredAt).toBeInstanceOf(Date);
    expect(event.eventId).toBeTruthy();
  });

  it('maps each target status to the correct event type', () => {
    const mappings: [ApplicationStatus, ApplicationEventType][] = [
      [ApplicationStatus.SUBMITTED,          ApplicationEventType.SUBMITTED],
      [ApplicationStatus.UNDER_REVIEW,       ApplicationEventType.REVIEW_STARTED],
      [ApplicationStatus.DOCUMENTS_REQUIRED, ApplicationEventType.DOCUMENTS_REQUESTED],
      [ApplicationStatus.APPROVED,           ApplicationEventType.APPROVED],
      [ApplicationStatus.REJECTED,           ApplicationEventType.REJECTED],
      [ApplicationStatus.DISBURSED,          ApplicationEventType.DISBURSED],
      [ApplicationStatus.WITHDRAWN,          ApplicationEventType.WITHDRAWN],
    ];

    for (const [toStatus, expectedEventType] of mappings) {
      const event = buildStatusEvent(
        'app-1', ApplicationStatus.DRAFT, toStatus, 'system',
      );
      expect(event.eventType).toBe(expectedEventType);
    }
  });
});

// ─── getExpectedCompletionDate ────────────────────────────────────────────────

describe('getExpectedCompletionDate', () => {
  it('returns null for terminal states', () => {
    expect(getExpectedCompletionDate(ApplicationStatus.DISBURSED, new Date())).toBeNull();
    expect(getExpectedCompletionDate(ApplicationStatus.REJECTED, new Date())).toBeNull();
    expect(getExpectedCompletionDate(ApplicationStatus.WITHDRAWN, new Date())).toBeNull();
  });

  it('returns a future date for non-terminal states', () => {
    const now = new Date();
    const expected = getExpectedCompletionDate(ApplicationStatus.UNDER_REVIEW, now);
    expect(expected).not.toBeNull();
    expect(expected!.getTime()).toBeGreaterThan(now.getTime());
  });

  it('skips weekends when calculating business days', () => {
    // Use a Monday as reference — 15 business days forward should not land on weekend
    const monday = new Date('2024-01-08'); // Monday
    const result = getExpectedCompletionDate(ApplicationStatus.UNDER_REVIEW, monday);
    expect(result).not.toBeNull();
    const day = result!.getDay();
    expect(day).not.toBe(0); // Not Sunday
    expect(day).not.toBe(6); // Not Saturday
  });
});

// ─── isOverdue ────────────────────────────────────────────────────────────────

describe('isOverdue', () => {
  it('returns false for recent applications', () => {
    const recent = new Date(); // Just now
    expect(isOverdue(ApplicationStatus.UNDER_REVIEW, recent)).toBe(false);
  });

  it('returns true for applications stuck long past expected window', () => {
    const veryOld = new Date('2020-01-01');
    expect(isOverdue(ApplicationStatus.UNDER_REVIEW, veryOld)).toBe(true);
  });

  it('returns false for terminal states regardless of age', () => {
    const veryOld = new Date('2020-01-01');
    expect(isOverdue(ApplicationStatus.DISBURSED, veryOld)).toBe(false);
    expect(isOverdue(ApplicationStatus.REJECTED, veryOld)).toBe(false);
  });
});
