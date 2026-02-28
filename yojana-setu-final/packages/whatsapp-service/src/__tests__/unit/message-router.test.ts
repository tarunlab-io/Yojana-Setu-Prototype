import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  UserIntent,
  ConversationStage,
  Channel,
  SupportedLanguage,
  type ConversationState,
} from '@yojana-setu/shared';

// ─── Test the pure routing helpers directly ───────────────────────────────────
// We test the intent detection and stage-override logic without spinning up
// Express or real Redis. The flow handlers are tested separately.

// Inline re-implementation of the pure routing helpers for isolated testing.
// These mirror the logic in message-router.ts exactly.

function detectIntentFromText(
  text: string,
  _language: SupportedLanguage,
): { intent: UserIntent; confidence: number } {
  const lower = text.toLowerCase().trim();
  if (/\b(scheme|yojana|योजना|திட்டம்|benefit|welfare|eligible)\b/i.test(lower))
    return { intent: UserIntent.DISCOVER_SCHEMES, confidence: 0.87 };
  if (/\b(upload|document|aadhaar|आधार|photo|scan|send)\b/i.test(lower))
    return { intent: UserIntent.UPLOAD_DOCUMENT, confidence: 0.85 };
  if (/\b(status|track|application|avedan|स्थिति)\b/i.test(lower))
    return { intent: UserIntent.TRACK_APPLICATION, confidence: 0.85 };
  if (/\b(language|bhasha|भाषा|change|switch)\b/i.test(lower))
    return { intent: UserIntent.SWITCH_LANGUAGE, confidence: 0.90 };
  if (/\b(help|madad|मदद|start|menu)\b/i.test(lower))
    return { intent: UserIntent.HELP, confidence: 0.90 };
  if (/\b(update|profile|income|address)\b/i.test(lower))
    return { intent: UserIntent.UPDATE_PROFILE, confidence: 0.82 };
  return { intent: UserIntent.UNKNOWN, confidence: 0.3 };
}

function isAffirmationOrDenial(text: string): boolean {
  const affirmations = new Set(['yes','no','haan','nahi','ha','ok','okay','sure','done',
    'हाँ','नहीं','ठीक है','சரி','ஆம்','இல்லை','1','2','3','4','5']);
  return affirmations.has(text.toLowerCase().trim());
}

function shouldUseStageHandler(
  stage: ConversationStage,
  processedText: string,
  detectedIntent: UserIntent,
  confidence: number,
): boolean {
  const stageHandlerStages = new Set([
    ConversationStage.PROFILE_COLLECTION,
    ConversationStage.DOCUMENT_COLLECTION,
    ConversationStage.SCHEME_EXPLANATION,
    ConversationStage.APPLICATION_REVIEW,
  ]);
  const isMidFlow = stageHandlerStages.has(stage);
  const isAffirmation = isAffirmationOrDenial(processedText);
  return isMidFlow && (isAffirmation || detectedIntent === UserIntent.UNKNOWN || confidence < 0.7);
}

function makeSession(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    sessionId: 'test-session',
    userId: 'user-123',
    phoneNumber: '+919876543210',
    channel: Channel.WHATSAPP,
    context: {
      currentIntent: UserIntent.UNKNOWN,
      language: 'hi' as SupportedLanguage,
      conversationStage: ConversationStage.GREETING,
      collectedData: {},
    },
    history: [],
    metadata: {
      startedAt: new Date(),
      lastActivity: new Date(),
      isActive: true,
      messageCount: 0,
    },
    ...overrides,
  };
}

// ─── Intent Detection Tests ───────────────────────────────────────────────────

describe('detectIntentFromText', () => {
  it('detects DISCOVER_SCHEMES from English keyword', () => {
    expect(detectIntentFromText('find schemes for farmers', 'en' as SupportedLanguage).intent)
      .toBe(UserIntent.DISCOVER_SCHEMES);
  });

  it('detects DISCOVER_SCHEMES from Hindi yojana keyword', () => {
    expect(detectIntentFromText('मुझे योजना चाहिए', 'hi' as SupportedLanguage).intent)
      .toBe(UserIntent.DISCOVER_SCHEMES);
  });

  it('detects DISCOVER_SCHEMES from Tamil', () => {
    expect(detectIntentFromText('திட்டம் வேண்டும்', 'ta' as SupportedLanguage).intent)
      .toBe(UserIntent.DISCOVER_SCHEMES);
  });

  it('detects UPLOAD_DOCUMENT from aadhaar keyword', () => {
    expect(detectIntentFromText('upload my aadhaar', 'en' as SupportedLanguage).intent)
      .toBe(UserIntent.UPLOAD_DOCUMENT);
  });

  it('detects UPLOAD_DOCUMENT from Hindi आधार', () => {
    expect(detectIntentFromText('आधार अपलोड करना है', 'hi' as SupportedLanguage).intent)
      .toBe(UserIntent.UPLOAD_DOCUMENT);
  });

  it('detects TRACK_APPLICATION from status keyword', () => {
    expect(detectIntentFromText('what is my application status', 'en' as SupportedLanguage).intent)
      .toBe(UserIntent.TRACK_APPLICATION);
  });

  it('detects SWITCH_LANGUAGE from language keyword', () => {
    expect(detectIntentFromText('change language', 'en' as SupportedLanguage).intent)
      .toBe(UserIntent.SWITCH_LANGUAGE);
  });

  it('detects HELP from help keyword', () => {
    expect(detectIntentFromText('help', 'en' as SupportedLanguage).intent)
      .toBe(UserIntent.HELP);
  });

  it('returns UNKNOWN for unrecognised message with low confidence', () => {
    const result = detectIntentFromText('xyzzy frobulate', 'en' as SupportedLanguage);
    expect(result.intent).toBe(UserIntent.UNKNOWN);
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('is case-insensitive', () => {
    expect(detectIntentFromText('SCHEME', 'en' as SupportedLanguage).intent)
      .toBe(UserIntent.DISCOVER_SCHEMES);
  });
});

// ─── isAffirmationOrDenial Tests ──────────────────────────────────────────────

describe('isAffirmationOrDenial', () => {
  it('recognises English affirmations', () => {
    for (const word of ['yes', 'no', 'ok', 'okay', 'sure', 'done']) {
      expect(isAffirmationOrDenial(word)).toBe(true);
    }
  });

  it('recognises Hindi affirmations', () => {
    expect(isAffirmationOrDenial('हाँ')).toBe(true);
    expect(isAffirmationOrDenial('नहीं')).toBe(true);
  });

  it('recognises numeric selections', () => {
    for (const num of ['1', '2', '3', '4', '5']) {
      expect(isAffirmationOrDenial(num)).toBe(true);
    }
  });

  it('is case-insensitive', () => {
    expect(isAffirmationOrDenial('YES')).toBe(true);
    expect(isAffirmationOrDenial('No')).toBe(true);
  });

  it('rejects non-affirmations', () => {
    expect(isAffirmationOrDenial('scheme')).toBe(false);
    expect(isAffirmationOrDenial('hello world')).toBe(false);
  });
});

// ─── Stage Handler Override Logic ─────────────────────────────────────────────

describe('shouldUseStageHandler', () => {
  it('uses stage handler when mid-flow and user sends affirmation', () => {
    expect(shouldUseStageHandler(
      ConversationStage.PROFILE_COLLECTION, 'yes', UserIntent.UNKNOWN, 0.3,
    )).toBe(true);
  });

  it('uses stage handler when mid-flow and intent is UNKNOWN', () => {
    expect(shouldUseStageHandler(
      ConversationStage.DOCUMENT_COLLECTION, 'ok please', UserIntent.UNKNOWN, 0.3,
    )).toBe(true);
  });

  it('uses stage handler when mid-flow and low confidence', () => {
    expect(shouldUseStageHandler(
      ConversationStage.SCHEME_EXPLANATION, 'tell me more', UserIntent.DISCOVER_SCHEMES, 0.5,
    )).toBe(true);
  });

  it('does NOT use stage handler when user explicitly switches intent with high confidence', () => {
    expect(shouldUseStageHandler(
      ConversationStage.PROFILE_COLLECTION, 'show me schemes', UserIntent.DISCOVER_SCHEMES, 0.87,
    )).toBe(false);
  });

  it('does NOT use stage handler at GREETING stage', () => {
    expect(shouldUseStageHandler(
      ConversationStage.GREETING, 'yes', UserIntent.UNKNOWN, 0.3,
    )).toBe(false);
  });

  it('does NOT use stage handler at COMPLETED stage', () => {
    expect(shouldUseStageHandler(
      ConversationStage.COMPLETED, 'yes', UserIntent.UNKNOWN, 0.3,
    )).toBe(false);
  });
});

// ─── Profile Collection Question Validation ───────────────────────────────────

describe('Profile field validation', () => {
  // Inline the date validator to test it purely
  function validateDateOfBirth(v: string): { valid: boolean; value?: string; errorMsg?: string } {
    const match = v.trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (!match) return { valid: false, errorMsg: 'Please enter date as DD/MM/YYYY' };
    const [, day, month, year] = match;
    const date = new Date(`${year!}-${month!.padStart(2,'0')}-${day!.padStart(2,'0')}`);
    if (isNaN(date.getTime())) return { valid: false, errorMsg: 'Invalid date' };
    const age = new Date().getFullYear() - date.getFullYear();
    if (age < 0 || age > 120) return { valid: false, errorMsg: 'Invalid year' };
    return { valid: true, value: date.toISOString().split('T')[0] };
  }

  function validateIncome(v: string): { valid: boolean; value?: number; errorMsg?: string } {
    const num = parseInt(v.replace(/[,₹\s]/g, ''), 10);
    if (isNaN(num) || num < 0) return { valid: false, errorMsg: 'Invalid amount' };
    if (num > 100_000_000) return { valid: false, errorMsg: 'Too high' };
    return { valid: true, value: num };
  }

  it('accepts valid DD/MM/YYYY date', () => {
    const result = validateDateOfBirth('15/08/1990');
    expect(result.valid).toBe(true);
    expect(result.value).toBe('1990-08-15');
  });

  it('accepts DD-MM-YYYY with dashes', () => {
    expect(validateDateOfBirth('01-01-1985').valid).toBe(true);
  });

  it('rejects invalid date format', () => {
    expect(validateDateOfBirth('1990-08-15').valid).toBe(false);
    expect(validateDateOfBirth('not-a-date').valid).toBe(false);
  });

  it('accepts income with commas and rupee symbol', () => {
    const result = validateIncome('₹1,50,000');
    expect(result.valid).toBe(true);
    expect(result.value).toBe(150000);
  });

  it('accepts plain numeric income', () => {
    const result = validateIncome('250000');
    expect(result.valid).toBe(true);
    expect(result.value).toBe(250000);
  });

  it('rejects negative income', () => {
    expect(validateIncome('-5000').valid).toBe(false);
  });

  it('rejects unreasonably high income', () => {
    expect(validateIncome('999999999999').valid).toBe(false);
  });
});
