/**
 * Application State Machine
 *
 * Models the lifecycle of a welfare scheme application as a finite state machine.
 * All transitions are pure functions — no DB or network dependencies.
 *
 * Valid states and allowed transitions:
 *
 *  DRAFT ──► SUBMITTED ──► UNDER_REVIEW ──► APPROVED ──► DISBURSED
 *    │            │               │               │
 *    │            │               └──► REJECTED ◄─┘
 *    │            └──► WITHDRAWN
 *    └──► WITHDRAWN
 *
 * Additional metadata transitions:
 *  ANY STATE ──► DOCUMENTS_REQUIRED (documents missing/invalid)
 *  DOCUMENTS_REQUIRED ──► UNDER_REVIEW (documents uploaded and valid)
 */

import {
  ApplicationStatus,
  type ApplicationStatusTransition,
  type ApplicationEvent,
  ApplicationEventType,
  InvalidStatusTransitionError,
} from '@yojana-setu/shared';

// ─── Allowed Transitions ──────────────────────────────────────────────────────

type TransitionMap = Partial<Record<ApplicationStatus, Set<ApplicationStatus>>>;

const ALLOWED_TRANSITIONS: TransitionMap = {
  [ApplicationStatus.DRAFT]: new Set([
    ApplicationStatus.SUBMITTED,
    ApplicationStatus.WITHDRAWN,
  ]),
  [ApplicationStatus.SUBMITTED]: new Set([
    ApplicationStatus.UNDER_REVIEW,
    ApplicationStatus.DOCUMENTS_REQUIRED,
    ApplicationStatus.WITHDRAWN,
  ]),
  [ApplicationStatus.UNDER_REVIEW]: new Set([
    ApplicationStatus.APPROVED,
    ApplicationStatus.REJECTED,
    ApplicationStatus.DOCUMENTS_REQUIRED,
  ]),
  [ApplicationStatus.DOCUMENTS_REQUIRED]: new Set([
    ApplicationStatus.UNDER_REVIEW,
    ApplicationStatus.WITHDRAWN,
  ]),
  [ApplicationStatus.APPROVED]: new Set([
    ApplicationStatus.DISBURSED,
  ]),
  // Terminal states — no transitions allowed
  [ApplicationStatus.DISBURSED]: new Set(),
  [ApplicationStatus.REJECTED]: new Set(),
  [ApplicationStatus.WITHDRAWN]: new Set(),
};

// ─── Transition Validation ────────────────────────────────────────────────────

export function isValidTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from]?.has(to) ?? false;
}

export function assertValidTransition(
  applicationId: string,
  from: ApplicationStatus,
  to: ApplicationStatus,
): void {
  if (!isValidTransition(from, to)) {
    throw new InvalidStatusTransitionError(applicationId, from, to);
  }
}

export function isTerminalState(status: ApplicationStatus): boolean {
  const terminals = new Set([
    ApplicationStatus.DISBURSED,
    ApplicationStatus.REJECTED,
    ApplicationStatus.WITHDRAWN,
  ]);
  return terminals.has(status);
}

export function getAllowedTransitions(from: ApplicationStatus): ApplicationStatus[] {
  return Array.from(ALLOWED_TRANSITIONS[from] ?? []);
}

// ─── Reference Number Generation ─────────────────────────────────────────────

/**
 * Generates a human-readable application reference number.
 * Format: YS-YYYY-NNNNN (e.g. YS-2024-00142)
 * Designed to be easy to read aloud and remember.
 */
export function generateReferenceNumber(sequenceNumber: number): string {
  const year = new Date().getFullYear();
  const padded = String(sequenceNumber).padStart(5, '0');
  return `YS-${year}-${padded}`;
}

// ─── Event Builder ────────────────────────────────────────────────────────────

export function buildStatusEvent(
  applicationId: string,
  fromStatus: ApplicationStatus,
  toStatus: ApplicationStatus,
  triggeredBy: 'user' | 'system' | 'government',
  note?: string,
): ApplicationEvent {
  const eventTypeMap: Partial<Record<ApplicationStatus, ApplicationEventType>> = {
    [ApplicationStatus.SUBMITTED]:          ApplicationEventType.SUBMITTED,
    [ApplicationStatus.UNDER_REVIEW]:       ApplicationEventType.REVIEW_STARTED,
    [ApplicationStatus.DOCUMENTS_REQUIRED]: ApplicationEventType.DOCUMENTS_REQUESTED,
    [ApplicationStatus.APPROVED]:           ApplicationEventType.APPROVED,
    [ApplicationStatus.REJECTED]:           ApplicationEventType.REJECTED,
    [ApplicationStatus.DISBURSED]:          ApplicationEventType.DISBURSED,
    [ApplicationStatus.WITHDRAWN]:          ApplicationEventType.WITHDRAWN,
  };

  return {
    eventId: crypto.randomUUID(),
    applicationId,
    eventType: eventTypeMap[toStatus] ?? ApplicationEventType.STATUS_CHANGED,
    fromStatus,
    toStatus,
    triggeredBy,
    note: note ?? null,
    occurredAt: new Date(),
  };
}

// ─── SLA Tracking ────────────────────────────────────────────────────────────

/**
 * Expected processing time by status (in business days).
 * Used for progress estimation shown to users.
 */
const EXPECTED_DURATION_BUSINESS_DAYS: Partial<Record<ApplicationStatus, number>> = {
  [ApplicationStatus.SUBMITTED]:          1,   // Should be picked up in 1 day
  [ApplicationStatus.UNDER_REVIEW]:       15,  // Standard 15-day review window
  [ApplicationStatus.DOCUMENTS_REQUIRED]: 7,   // User has 7 days to provide docs
  [ApplicationStatus.APPROVED]:           10,  // Disbursement within 10 days of approval
};

export function getExpectedCompletionDate(
  currentStatus: ApplicationStatus,
  enteredStatusAt: Date,
): Date | null {
  const days = EXPECTED_DURATION_BUSINESS_DAYS[currentStatus];
  if (!days) return null;

  const result = new Date(enteredStatusAt);
  let businessDaysAdded = 0;

  while (businessDaysAdded < days) {
    result.setDate(result.getDate() + 1);
    const dayOfWeek = result.getDay();
    // Skip weekends (0 = Sunday, 6 = Saturday)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      businessDaysAdded++;
    }
  }

  return result;
}

export function isOverdue(
  currentStatus: ApplicationStatus,
  enteredStatusAt: Date,
): boolean {
  const expected = getExpectedCompletionDate(currentStatus, enteredStatusAt);
  if (!expected) return false;
  return new Date() > expected;
}
