import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { ProfileService } from '../services/profile.service';
import {
  ConsentType,
  UserNotFoundError,
  ValidationError,
} from '@yojana-setu/shared';

export const profileRouter = Router();
const service = new ProfileService();

// ─── POST /profiles ────────────────────────────────────────────────────────
// Create a new user profile

profileRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const profile = await service.createProfile(req.body as Record<string, unknown>);
    res.status(201).json({ success: true, data: profile });
  } catch (err) {
    next(err);
  }
});

// ─── GET /profiles/:userId ─────────────────────────────────────────────────
// Fetch a profile by user ID

profileRouter.get('/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const profile = await service.getProfile(req.params['userId']!);
    if (!profile) throw new UserNotFoundError(req.params['userId']!);
    res.json({ success: true, data: profile });
  } catch (err) {
    next(err);
  }
});

// ─── GET /profiles/phone/:phoneNumber ─────────────────────────────────────
// Fetch a profile by phone number (used by WhatsApp service on incoming message)

profileRouter.get('/phone/:phoneNumber', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const profile = await service.getProfileByPhone(req.params['phoneNumber']!);
    if (!profile) throw new UserNotFoundError(req.params['phoneNumber']!);
    res.json({ success: true, data: profile });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /profiles/:userId ───────────────────────────────────────────────
// Partial update of profile fields

profileRouter.patch('/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updated = await service.updateProfile(
      req.params['userId']!,
      req.body as Record<string, unknown>,
    );
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /profiles/:userId ──────────────────────────────────────────────
// Hard delete — triggered when consent is fully withdrawn (Req 9.5)

profileRouter.delete('/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await service.deleteProfile(req.params['userId']!);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ─── GET /profiles/:userId/consent/:consentType ────────────────────────────
// Check a specific consent status

profileRouter.get(
  '/:userId/consent/:consentType',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const consentType = req.params['consentType'] as ConsentType;
      if (!Object.values(ConsentType).includes(consentType)) {
        throw new ValidationError(`Invalid consent type: ${consentType}`);
      }
      const granted = await service.checkConsent(req.params['userId']!, consentType);
      res.json({ success: true, data: { consentType, granted } });
    } catch (err) {
      next(err);
    }
  },
);

// ─── PATCH /profiles/:userId/consent ──────────────────────────────────────
// Update a consent record

profileRouter.patch(
  '/:userId/consent',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { consentType, granted } = req.body as { consentType: ConsentType; granted: boolean };
      await service.updateConsent(req.params['userId']!, consentType, granted);
      res.json({ success: true, data: { consentType, granted } });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /profiles/:userId/missing-fields ─────────────────────────────────
// Returns list of incomplete fields (used in conversation guidance)

profileRouter.get(
  '/:userId/missing-fields',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const profile = await service.getProfile(req.params['userId']!);
      if (!profile) throw new UserNotFoundError(req.params['userId']!);
      const missingFields = service.getMissingFields(profile);
      res.json({
        success: true,
        data: {
          completionScore: profile.completionScore,
          missingFields,
          isComplete: missingFields.length === 0,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);
