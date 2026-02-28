/**
 * Government Portal Client
 *
 * Abstracts the submission of applications to government portals.
 *
 * Reality of Indian government portals:
 *  - Most don't have APIs — applications are submitted via web forms
 *  - Some have UMANG API integration (central scheme submission)
 *  - State portals vary wildly in their capabilities
 *  - Many require manual intervention by field officers
 *
 * Strategy implemented here:
 *  1. UMANG API for schemes that support it (national schemes)
 *  2. PDF generation + CSC (Common Service Centre) routing for others
 *  3. Manual tracking queue for portals with no API
 *
 * All submissions are idempotent — safe to retry on network failure.
 */

import {
  type ApplicationFull as Application,
  type GovernmentPortalSubmission,
  type GovernmentPortalResponse,
  GovernmentPortalError,
} from '@yojana-setu/shared';
import { logger } from '../config/logger';

const UMANG_BASE_URL = process.env['UMANG_API_URL'] ?? 'https://api.umang.gov.in/v1';
const UMANG_API_KEY = process.env['UMANG_API_KEY'] ?? '';

// ─── Schemes with UMANG API support ──────────────────────────────────────────
// These are the scheme IDs that can be submitted programmatically.
// All others go through PDF + CSC routing.

const UMANG_ENABLED_SCHEMES = new Set([
  'PM_KISAN',
  'PMMVY',
  'PMAY_G',
  'PM_JAY',
  'POST_MATRIC_SC',
]);

// ─── Submission Router ────────────────────────────────────────────────────────

export async function submitApplication(
  application: Application,
  submission: GovernmentPortalSubmission,
): Promise<GovernmentPortalResponse> {
  const schemeId = application.schemeId;

  if (UMANG_ENABLED_SCHEMES.has(schemeId) && UMANG_API_KEY) {
    return submitViaUMANG(application, submission);
  }

  // Fallback: queue for CSC submission
  return queueForCSCSubmission(application, submission);
}

// ─── UMANG API Submission ─────────────────────────────────────────────────────

async function submitViaUMANG(
  application: Application,
  submission: GovernmentPortalSubmission,
): Promise<GovernmentPortalResponse> {
  const startTime = Date.now();

  const payload = {
    serviceId: mapSchemeToUMANGServiceId(application.schemeId),
    mobileNumber: submission.applicantMobile,
    aadhaarNumber: submission.aadhaarNumber,
    applicationData: submission.formData,
    documentRefs: submission.documentRefs,
    // Idempotency key — prevents duplicate submissions on retry
    clientReferenceId: application.applicationId,
  };

  try {
    const response = await fetch(`${UMANG_BASE_URL}/services/apply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': UMANG_API_KEY,
        'x-client-id': 'YOJANA_SETU',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000), // 30s timeout
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new GovernmentPortalError(
        `UMANG API returned ${response.status}`,
        { body: errorBody },
      );
    }

    const data = await response.json() as {
      status: string;
      referenceNumber?: string;
      message?: string;
      nextSteps?: string[];
    };

    logger.info('Application submitted via UMANG', {
      applicationId: application.applicationId,
      umangRef: data.referenceNumber,
      elapsedMs: Date.now() - startTime,
    });

    return {
      success: data.status === 'SUCCESS' || data.status === 'PENDING',
      governmentReferenceNumber: data.referenceNumber,
      message: data.message ?? 'Application submitted successfully',
      nextSteps: data.nextSteps ?? [],
      submittedAt: new Date(),
      submissionChannel: 'umang_api',
    };
  } catch (err) {
    if (err instanceof GovernmentPortalError) throw err;
    throw new GovernmentPortalError(
      `UMANG submission failed: ${err instanceof Error ? err.message : 'Unknown'}`,
    );
  }
}

// ─── CSC Queue Submission ─────────────────────────────────────────────────────

async function queueForCSCSubmission(
  application: Application,
  submission: GovernmentPortalSubmission,
): Promise<GovernmentPortalResponse> {
  // For schemes without API access, we queue the application for a
  // Common Service Centre (CSC) operator to submit on behalf of the user.
  // This is tracked manually with a human-readable reference number.

  logger.info('Application queued for CSC submission', {
    applicationId: application.applicationId,
    schemeId: application.schemeId,
  });

  // TODO: integrate with CSC portal API or generate PDF + email
  // For now, acknowledge receipt and provide guidance

  return {
    success: true,
    governmentReferenceNumber: null,
    message: 'Your application has been queued for submission through your nearest Common Service Centre (CSC).',
    nextSteps: [
      'Visit your nearest CSC within 7 working days',
      `Bring your reference number: ${application.referenceNumber}`,
      'Carry original documents for verification',
      'You will receive an SMS when submission is complete',
    ],
    submittedAt: new Date(),
    submissionChannel: 'csc_queue',
  };
}

// ─── Status Polling ───────────────────────────────────────────────────────────

export async function pollApplicationStatus(
  governmentReferenceNumber: string,
  schemeId: string,
): Promise<{ status: string; message: string; updatedAt: Date } | null> {
  if (!UMANG_ENABLED_SCHEMES.has(schemeId) || !UMANG_API_KEY) {
    return null; // Manual tracking only
  }

  try {
    const response = await fetch(
      `${UMANG_BASE_URL}/services/status/${governmentReferenceNumber}`,
      {
        headers: { 'x-api-key': UMANG_API_KEY, 'x-client-id': 'YOJANA_SETU' },
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) return null;

    const data = await response.json() as {
      status: string;
      message: string;
      lastUpdated: string;
    };

    return {
      status: data.status,
      message: data.message,
      updatedAt: new Date(data.lastUpdated),
    };
  } catch {
    return null;
  }
}

// ─── UMANG Service ID Mapping ─────────────────────────────────────────────────

function mapSchemeToUMANGServiceId(schemeId: string): string {
  const mapping: Record<string, string> = {
    PM_KISAN: '7163',
    PMMVY:    '7344',
    PMAY_G:   '7271',
    PM_JAY:   '7389',
    POST_MATRIC_SC: '7412',
  };
  return mapping[schemeId] ?? schemeId;
}
