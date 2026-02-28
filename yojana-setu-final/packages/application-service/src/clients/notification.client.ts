/**
 * Notification Client
 *
 * Sends application status update notifications to users via WhatsApp.
 * Uses pre-approved WhatsApp Business templates for transactional messages
 * (required for messages sent outside the 24-hour reply window).
 *
 * Template names are pre-registered with Meta/Twilio.
 * Each template has language variants registered separately.
 */

import {
  type ApplicationFull as Application,
  type ApplicationEvent,
  ApplicationStatus,
  ApplicationEventType,
  type SupportedLanguage,
} from '@yojana-setu/shared';
import { logger } from '../config/logger';

const WHATSAPP_SERVICE_URL =
  process.env['WHATSAPP_SERVICE_URL'] ?? 'http://whatsapp-service:3005';

// ─── Template Names (pre-registered with Meta/Twilio) ─────────────────────────

const TEMPLATES: Partial<Record<ApplicationEventType, string>> = {
  [ApplicationEventType.SUBMITTED]:           'application_submitted',
  [ApplicationEventType.REVIEW_STARTED]:      'application_under_review',
  [ApplicationEventType.DOCUMENTS_REQUESTED]: 'documents_required',
  [ApplicationEventType.APPROVED]:            'application_approved',
  [ApplicationEventType.REJECTED]:            'application_rejected',
  [ApplicationEventType.DISBURSED]:           'benefit_disbursed',
};

// ─── Notification Sender ──────────────────────────────────────────────────────

export async function notifyUserOfStatusChange(
  phoneNumber: string,
  application: Application,
  event: ApplicationEvent,
  language: SupportedLanguage,
): Promise<void> {
  const templateName = TEMPLATES[event.eventType];
  if (!templateName) return; // No template for this event type

  const parameters = buildTemplateParameters(application, event);

  try {
    const response = await fetch(`${WHATSAPP_SERVICE_URL}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber,
        templateName: `${templateName}_${language}`,
        parameters,
        fallbackTemplateName: `${templateName}_en`,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`Notification service returned ${response.status}`);
    }

    logger.info('Status notification sent', {
      phoneNumber,
      applicationId: application.applicationId,
      eventType: event.eventType,
      language,
    });
  } catch (err) {
    // Notification failures must never block application processing
    logger.error('Failed to send status notification', {
      phoneNumber,
      applicationId: application.applicationId,
      error: err instanceof Error ? err.message : 'Unknown',
    });
  }
}

// ─── Template Parameter Builder ───────────────────────────────────────────────

function buildTemplateParameters(
  application: Application,
  event: ApplicationEvent,
): string[] {
  // Parameters are positional — {{1}}, {{2}}, {{3}} in the template
  const base = [
    application.referenceNumber,                 // {{1}} — always reference number
    formatDate(event.occurredAt),                 // {{2}} — date of event
  ];

  switch (event.eventType) {
    case ApplicationEventType.SUBMITTED:
      return [...base, 'within 15 working days'];  // {{3}} — expected timeline

    case ApplicationEventType.DOCUMENTS_REQUESTED:
      return [...base, event.note ?? 'additional documents'];  // {{3}} — what's needed

    case ApplicationEventType.APPROVED:
      return [
        ...base,
        application.disbursementAmountINR
          ? `₹${application.disbursementAmountINR.toLocaleString('en-IN')}`
          : 'as per scheme guidelines',              // {{3}} — benefit amount
      ];

    case ApplicationEventType.REJECTED:
      return [...base, application.rejectionReason ?? 'see details'];  // {{3}} — reason

    case ApplicationEventType.DISBURSED:
      return [
        application.referenceNumber,
        application.disbursementAmountINR
          ? `₹${application.disbursementAmountINR.toLocaleString('en-IN')}`
          : 'the approved amount',
        formatDate(application.disbursementDate ?? event.occurredAt),
      ];

    default:
      return base;
  }
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
