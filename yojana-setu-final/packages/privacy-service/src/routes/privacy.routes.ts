import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import {
  grantConsent,
  revokeConsent,
  requireConsent,
  getConsentStatus,
  getConsentHistory,
  getMissingRequiredConsents,
} from '../services/consent-manager';
import {
  createDeletionRequest,
  processDeletionRequest,
  enforceRetentionPolicies,
  generateDataExport,
} from '../services/data-retention';
import {
  audit,
  auditConsentEvent,
  verifyAuditChain,
} from '../services/audit-logger';
import {
  ConsentPurpose,
  ValidationError,
  type SupportedLanguage,
} from '@yojana-setu/shared';
import { logger } from '../config/logger';

export const privacyRouter = Router();

// ─── GET /privacy/consent/:userId ─────────────────────────────────────────────
// Returns full consent status across all purposes

privacyRouter.get('/consent/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.params as { userId: string };
    const status = await getConsentStatus(userId);

    audit('DATA_ACCESS', userId, userId, 'user', 'privacy-service', ['consent'],
      { endpoint: 'GET /consent' });

    res.json({ success: true, data: status });
  } catch (err) { next(err); }
});

// ─── POST /privacy/consent ────────────────────────────────────────────────────
// Grant consent for one or more purposes

privacyRouter.post('/consent', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, purposes, channel, language, ipHash } = req.body as {
      userId: string;
      purposes: ConsentPurpose[];
      channel: string;
      language: SupportedLanguage;
      ipHash?: string;
    };

    if (!userId) throw new ValidationError('userId is required');
    if (!Array.isArray(purposes) || purposes.length === 0) {
      throw new ValidationError('purposes must be a non-empty array');
    }

    // Validate all purpose values
    const validPurposes = new Set(Object.values(ConsentPurpose));
    for (const p of purposes) {
      if (!validPurposes.has(p)) throw new ValidationError(`Invalid purpose: ${p}`);
    }

    const records = await grantConsent(
      userId, purposes, channel ?? 'whatsapp', language ?? 'hi', ipHash,
    );

    auditConsentEvent(userId, 'CONSENT_GRANTED', purposes, channel ?? 'whatsapp');

    res.status(201).json({ success: true, data: records, count: records.length });
  } catch (err) { next(err); }
});

// ─── DELETE /privacy/consent ──────────────────────────────────────────────────
// Revoke consent for one or more purposes

privacyRouter.delete('/consent', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, purposes } = req.body as {
      userId: string;
      purposes: ConsentPurpose[];
    };

    if (!userId) throw new ValidationError('userId is required');
    if (!Array.isArray(purposes) || purposes.length === 0) {
      throw new ValidationError('purposes must be a non-empty array');
    }

    const result = await revokeConsent(userId, purposes);
    auditConsentEvent(userId, 'CONSENT_REVOKED', purposes, 'api');

    res.json({
      success: true,
      data: result,
      message: result.dataDeletionRequired.length > 0
        ? `Consent revoked. The following data categories will be scheduled for deletion: ${result.dataDeletionRequired.join(', ')}`
        : 'Consent revoked.',
    });
  } catch (err) { next(err); }
});

// ─── GET /privacy/consent/:userId/history ─────────────────────────────────────

privacyRouter.get(
  '/consent/:userId/history',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.params as { userId: string };
      const history = await getConsentHistory(userId);
      res.json({ success: true, data: history, count: history.length });
    } catch (err) { next(err); }
  },
);

// ─── POST /privacy/deletion-request ───────────────────────────────────────────
// Right to erasure — user requests full data deletion

privacyRouter.post(
  '/deletion-request',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, reason } = req.body as { userId: string; reason?: string };
      if (!userId) throw new ValidationError('userId is required');

      const request = await createDeletionRequest(
        userId, 'user', reason ?? 'User requested account deletion',
      );

      audit('DELETION_REQUESTED', userId, userId, 'user', 'privacy-service',
        ['all'], { requestId: request.requestId });

      res.status(202).json({
        success: true,
        data: request,
        message: `Your deletion request has been received. All personal data will be permanently deleted by ${request.scheduledDeletionAt.toLocaleDateString('en-IN')}.${
          request.blockingReason
            ? ` Note: ${request.blockingReason}`
            : ''
        }`,
      });
    } catch (err) { next(err); }
  },
);

// ─── GET /privacy/deletion-request/:requestId ─────────────────────────────────

privacyRouter.get(
  '/deletion-request/:requestId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // TODO: look up request from DB
      res.json({ success: true, data: { requestId: req.params['requestId'], status: 'scheduled' } });
    } catch (err) { next(err); }
  },
);

// ─── GET /privacy/export/:userId ──────────────────────────────────────────────
// Right to data portability — download everything we hold

privacyRouter.get(
  '/export/:userId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.params as { userId: string };
      const exportData = await generateDataExport(userId);

      audit('EXPORT_REQUESTED', userId, userId, 'user', 'privacy-service',
        ['all'], { exportId: exportData.exportId });

      // Return as downloadable JSON
      res.setHeader('Content-Disposition',
        `attachment; filename="yojana-setu-data-export-${userId.slice(0, 8)}.json"`);
      res.setHeader('Content-Type', 'application/json');
      res.json(exportData.data);
    } catch (err) { next(err); }
  },
);

// ─── POST /privacy/consent/check ──────────────────────────────────────────────
// Internal endpoint: other services verify consent before processing

privacyRouter.post(
  '/consent/check',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, purpose } = req.body as {
        userId: string;
        purpose: ConsentPurpose;
      };
      if (!userId || !purpose) {
        throw new ValidationError('userId and purpose are required');
      }

      await requireConsent(userId, purpose);
      res.json({ success: true, hasConsent: true });
    } catch (err) {
      // Return structured response rather than propagating to 500
      if ((err as { code?: string }).code === 'CONSENT_REQUIRED') {
        res.status(403).json({ success: false, hasConsent: false, error: (err as Error).message });
        return;
      }
      next(err);
    }
  },
);

// ─── GET /privacy/audit/:userId ───────────────────────────────────────────────
// Admin: verify audit chain integrity for a user

privacyRouter.get(
  '/audit/:userId/integrity',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.params as { userId: string };
      const result = await verifyAuditChain(userId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  },
);

// ─── POST /privacy/retention/enforce (internal, cron-triggered) ───────────────

privacyRouter.post(
  '/retention/enforce',
  async (req: Request, res: Response, next: NextFunction) => {
    // Immediately acknowledge — this job can take minutes
    res.status(202).json({ success: true, message: 'Retention enforcement started' });

    try {
      const result = await enforceRetentionPolicies();
      logger.info('Retention enforcement complete', result);
    } catch (err) {
      logger.error('Retention enforcement failed', {
        error: err instanceof Error ? err.message : 'Unknown',
      });
    }
  },
);
