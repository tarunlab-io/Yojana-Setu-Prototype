import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { SchemeService } from '../services/scheme.service';
import { SchemeNotFoundError, ValidationError, type SupportedLanguage } from '@yojana-setu/shared';
import type { UserProfile } from '@yojana-setu/shared';

export const schemeRouter = Router();
const service = new SchemeService();

// ─── GET /schemes ─────────────────────────────────────────────────────────
// Search schemes by text query

schemeRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q, language } = req.query as { q?: string; language?: string };
    if (!q) throw new ValidationError('Query parameter "q" is required');

    const schemes = await service.searchSchemes(q, language as SupportedLanguage);
    res.json({ success: true, data: schemes, count: schemes.length });
  } catch (err) {
    next(err);
  }
});

// ─── GET /schemes/:schemeId ────────────────────────────────────────────────

schemeRouter.get('/:schemeId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scheme = await service.getSchemeById(req.params['schemeId']!);
    if (!scheme) throw new SchemeNotFoundError(req.params['schemeId']!);
    res.json({ success: true, data: scheme });
  } catch (err) {
    next(err);
  }
});

// ─── GET /schemes/:schemeId/explain ───────────────────────────────────────
// GPT-4 powered explanation in user's language

schemeRouter.get('/:schemeId/explain', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { language } = req.query as { language?: string };
    if (!language) throw new ValidationError('Query parameter "language" is required');

    const explanation = await service.explainScheme(
      req.params['schemeId']!,
      language as SupportedLanguage,
    );
    res.json({ success: true, data: explanation });
  } catch (err) {
    next(err);
  }
});

// ─── POST /schemes/match ──────────────────────────────────────────────────
// Find all eligible schemes for a given user profile

schemeRouter.post('/match', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userProfile, query } = req.body as {
      userProfile: UserProfile;
      query?: string;
    };

    if (!userProfile) throw new ValidationError('userProfile is required in request body');

    const matches = await service.findEligibleSchemes(userProfile, query);

    // If no matches, generate a helpful fallback suggestion
    if (matches.length === 0 && userProfile.preferences?.preferredLanguage) {
      const fallback = await service.generateFallbackSuggestion(
        userProfile,
        query ?? 'welfare schemes',
        userProfile.preferences.preferredLanguage,
      );
      res.json({ success: true, data: [], fallbackMessage: fallback, count: 0 });
      return;
    }

    res.json({ success: true, data: matches, count: matches.length });
  } catch (err) {
    next(err);
  }
});

// ─── POST /schemes/:schemeId/eligibility ──────────────────────────────────
// Check eligibility for a specific scheme + profile

schemeRouter.post(
  '/:schemeId/eligibility',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userProfile = req.body as UserProfile;
      if (!userProfile?.userId) throw new ValidationError('userProfile with userId is required');

      const result = await service.checkEligibility(req.params['schemeId']!, userProfile);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);
