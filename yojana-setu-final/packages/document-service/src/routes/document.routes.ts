import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { DocumentService } from '../services/document.service';
import {
  ValidationError,
  DocumentType,
} from '@yojana-setu/shared';

export const documentRouter = Router();
const service = new DocumentService();

// ─── POST /documents/upload ────────────────────────────────────────────────
// Upload and validate a document. Accepts base64-encoded file.

documentRouter.post('/upload', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { fileBase64, mimeType, filename, documentType, userId } = req.body as {
      fileBase64: string;
      mimeType: string;
      filename: string;
      documentType: DocumentType;
      userId: string;
    };

    if (!fileBase64) throw new ValidationError('fileBase64 is required');
    if (!mimeType) throw new ValidationError('mimeType is required');
    if (!filename) throw new ValidationError('filename is required');
    if (!documentType || !Object.values(DocumentType).includes(documentType)) {
      throw new ValidationError(`Invalid documentType: ${String(documentType)}`);
    }
    if (!userId) throw new ValidationError('userId is required');

    const fileBuffer = Buffer.from(fileBase64, 'base64');
    const result = await service.uploadAndValidate(
      fileBuffer,
      mimeType,
      filename,
      documentType,
      userId,
    );

    const statusCode = result.isValid ? 200 : 422;
    res.status(statusCode).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// ─── GET /documents/user/:userId ──────────────────────────────────────────

documentRouter.get('/user/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const docs = await service.getDocumentsByUser(req.params['userId']!);
    res.json({ success: true, data: docs, count: docs.length });
  } catch (err) {
    next(err);
  }
});

// ─── GET /documents/:documentId ────────────────────────────────────────────

documentRouter.get('/:documentId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.query['userId'] as string;
    if (!userId) throw new ValidationError('userId query parameter is required');
    const doc = await service.getDocument(req.params['documentId']!, userId);
    if (!doc) {
      res.status(404).json({ success: false, error: { message: 'Document not found' } });
      return;
    }
    res.json({ success: true, data: doc });
  } catch (err) {
    next(err);
  }
});

// ─── POST /documents/:documentId/revalidate ────────────────────────────────

documentRouter.post(
  '/:documentId/revalidate',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.body as { userId: string };
      if (!userId) throw new ValidationError('userId is required');
      const result = await service.reValidate(req.params['documentId']!, userId);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /documents/scheme-readiness ─────────────────────────────────────
// Check if a user has all valid documents required for a scheme

documentRouter.post(
  '/scheme-readiness',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, requiredDocumentTypes } = req.body as {
        userId: string;
        requiredDocumentTypes: DocumentType[];
      };

      if (!userId) throw new ValidationError('userId is required');
      if (!Array.isArray(requiredDocumentTypes) || requiredDocumentTypes.length === 0) {
        throw new ValidationError('requiredDocumentTypes must be a non-empty array');
      }

      const readiness = await service.checkSchemeReadiness(userId, requiredDocumentTypes);
      res.json({ success: true, data: readiness });
    } catch (err) {
      next(err);
    }
  },
);

// ─── DELETE /documents/:documentId ────────────────────────────────────────

documentRouter.delete(
  '/:documentId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.query['userId'] as string;
      if (!userId) throw new ValidationError('userId query parameter is required');
      await service.deleteDocument(req.params['documentId']!, userId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);
