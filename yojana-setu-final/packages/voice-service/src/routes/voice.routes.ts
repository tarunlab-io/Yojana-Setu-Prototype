import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { VoiceService } from '../services/voice.service';
import {
  switchLanguage,
  getOrCreateSession,
  updateContext,
  addTurn,
} from '../services/conversation-state';
import {
  ValidationError,
  type SupportedLanguage,
  SupportedLanguage as SupportedLanguageEnum,
  UserIntent,
} from '@yojana-setu/shared';

export const voiceRouter = Router();
const voiceService = new VoiceService();

// ─── POST /voice/transcribe ────────────────────────────────────────────────
// Accepts base64 audio, returns transcription + intent

voiceRouter.post('/transcribe', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { audioBase64, language, phoneNumber } = req.body as {
      audioBase64: string;
      language?: SupportedLanguage;
      phoneNumber?: string;
    };

    if (!audioBase64) throw new ValidationError('audioBase64 is required');

    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const result = await voiceService.processVoiceInput(audioBuffer, language);

    // Update session intent if phone provided
    if (phoneNumber) {
      const session = await getOrCreateSession(phoneNumber);
      await updateContext(session, { currentIntent: result.intent });
    }

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// ─── POST /voice/synthesize ────────────────────────────────────────────────
// Converts text to speech, returns base64 audio

voiceRouter.post('/synthesize', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { text, language } = req.body as { text: string; language: SupportedLanguage };
    if (!text) throw new ValidationError('text is required');
    if (!language) throw new ValidationError('language is required');

    const audioBuffer = await voiceService.generateSpeechResponse(text, { language });
    res.json({
      success: true,
      data: { audioBase64: audioBuffer.toString('base64'), format: 'wav' },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /voice/translate ─────────────────────────────────────────────────

voiceRouter.post('/translate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { text, sourceLanguage, targetLanguage } = req.body as {
      text: string;
      sourceLanguage: SupportedLanguage;
      targetLanguage: SupportedLanguage;
    };
    if (!text || !sourceLanguage || !targetLanguage) {
      throw new ValidationError('text, sourceLanguage, and targetLanguage are required');
    }

    const result = await voiceService.translate({ text, sourceLanguage, targetLanguage });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// ─── POST /voice/session/language ─────────────────────────────────────────
// Switch language for an active session (Req 7.5)

voiceRouter.post(
  '/session/language',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { phoneNumber, language } = req.body as {
        phoneNumber: string;
        language: SupportedLanguage;
      };

      if (!phoneNumber) throw new ValidationError('phoneNumber is required');
      if (!language || !Object.values(SupportedLanguageEnum).includes(language)) {
        throw new ValidationError(`Invalid language code: ${String(language)}`);
      }

      const session = await getOrCreateSession(phoneNumber);
      const updated = await switchLanguage(session, language);

      res.json({
        success: true,
        data: {
          sessionId: updated.sessionId,
          newLanguage: updated.context.language,
          conversationStage: updated.context.conversationStage,
          contextPreserved: true,
          collectedDataCount: Object.keys(updated.context.collectedData).length,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /voice/session/:phoneNumber ──────────────────────────────────────

voiceRouter.get(
  '/session/:phoneNumber',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await getOrCreateSession(req.params['phoneNumber']!);
      res.json({ success: true, data: session });
    } catch (err) {
      next(err);
    }
  },
);
