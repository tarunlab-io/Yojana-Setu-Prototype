import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { ApplicationService } from '../services/application.service';
import {
  ValidationError,
  ApplicationStatus,
  type SupportedLanguage,
} from '@yojana-setu/shared';

export const applicationRouter = Router();
const service = new ApplicationService();

// POST /applications — start a draft application
applicationRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, schemeId, documentIds, formData } = req.body as {
      userId: string;
      schemeId: string;
      documentIds: string[];
      formData: Record<string, unknown>;
    };
    if (!userId) throw new ValidationError('userId is required');
    if (!schemeId) throw new ValidationError('schemeId is required');

    const app = await service.startApplication(
      userId, schemeId, documentIds ?? [], formData ?? {},
    );
    res.status(201).json({ success: true, data: app });
  } catch (err) { next(err); }
});

// POST /applications/:id/submit
applicationRouter.post('/:id/submit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, portalSubmission, language } = req.body as {
      userId: string;
      portalSubmission: import('@yojana-setu/shared').GovernmentPortalSubmission;
      language: SupportedLanguage;
    };
    if (!userId) throw new ValidationError('userId is required');
    if (!portalSubmission) throw new ValidationError('portalSubmission is required');

    const app = await service.submitApplication(
      req.params['id']!, userId, portalSubmission, language ?? 'hi',
    );
    res.json({ success: true, data: app });
  } catch (err) { next(err); }
});

// GET /applications/:id/track
applicationRouter.get('/:id/track', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.query['userId'] as string;
    if (!userId) throw new ValidationError('userId query param required');
    const summary = await service.trackApplication(req.params['id']!, userId);
    res.json({ success: true, data: summary });
  } catch (err) { next(err); }
});

// GET /applications/reference/:ref — track by reference number (public)
applicationRouter.get(
  '/reference/:ref',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const summary = await service.trackByReferenceNumber(req.params['ref']!);
      res.json({ success: true, data: summary });
    } catch (err) { next(err); }
  },
);

// GET /applications/user/:userId — all applications for a user
applicationRouter.get(
  '/user/:userId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const apps = await service.getApplicationsByUser(req.params['userId']!);
      res.json({ success: true, data: apps, count: apps.length });
    } catch (err) { next(err); }
  },
);

// POST /applications/:id/documents — add documents (when DOCUMENTS_REQUIRED)
applicationRouter.post(
  '/:id/documents',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, documentIds, language, phoneNumber } = req.body as {
        userId: string;
        documentIds: string[];
        language: SupportedLanguage;
        phoneNumber: string;
      };
      if (!userId || !documentIds?.length) {
        throw new ValidationError('userId and documentIds are required');
      }
      const app = await service.addDocuments(
        req.params['id']!, userId, documentIds, language ?? 'hi', phoneNumber ?? '',
      );
      res.json({ success: true, data: app });
    } catch (err) { next(err); }
  },
);

// POST /applications/:id/withdraw
applicationRouter.post(
  '/:id/withdraw',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, reason } = req.body as { userId: string; reason: string };
      if (!userId) throw new ValidationError('userId is required');
      const app = await service.withdrawApplication(
        req.params['id']!, userId, reason ?? 'Withdrawn by user',
      );
      res.json({ success: true, data: app });
    } catch (err) { next(err); }
  },
);

// POST /applications/webhook/government — government portal push updates
applicationRouter.post(
  '/webhook/government',
  async (req: Request, res: Response, next: NextFunction) => {
    res.status(200).send('OK'); // Respond immediately
    try {
      const { governmentReference, status, details, phoneNumber, language } = req.body as {
        governmentReference: string;
        status: ApplicationStatus;
        details: Record<string, unknown>;
        phoneNumber: string;
        language: SupportedLanguage;
      };
      await service.handleGovernmentStatusUpdate(
        governmentReference, status, details ?? {}, phoneNumber ?? '', language ?? 'hi',
      );
    } catch (err) { next(err); }
  },
);
