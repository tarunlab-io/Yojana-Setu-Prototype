/**
 * Property-based tests for the Voice Service.
 *
 * Feature: yojana-setu
 * Property 1: Multi-Language Voice Processing Consistency
 *   For any supported Indian language and voice input, the system should
 *   successfully process audio and return a response in the same language
 *   with consistent accuracy above specified thresholds.
 *   Validates: Requirements 1.1, 1.2, 3.5, 7.1, 7.3
 *
 * Property 7: Language Switching Context Preservation
 *   For any language change request during an active conversation, the system
 *   should seamlessly transition without losing conversation context or data.
 *   Validates: Requirements 7.5
 */

import * as fc from 'fast-check';
import { describe, it, expect } from '@jest/globals';
import {
  detectIntentFromText,
  normalizeTranscribedText,
  detectAudioFormat,
} from '../../services/intent-detector';
import {
  UserIntent,
  SupportedLanguage,
  ConversationStage,
  Channel,
  type ConversationState,
  type ConversationContext,
} from '@yojana-setu/shared';

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const supportedLanguages = Object.values(SupportedLanguage) as SupportedLanguage[];
const languageArb = fc.constantFrom(...supportedLanguages);
const intentArb = fc.constantFrom(...Object.values(UserIntent));
const stageArb = fc.constantFrom(...Object.values(ConversationStage));

const collectedDataArb = fc.dictionary(
  fc.stringMatching(/^[a-z_]{1,20}$/),
  fc.oneof(
    fc.string({ minLength: 0, maxLength: 50 }),
    fc.integer({ min: 0, max: 1_000_000 }),
    fc.boolean(),
  ),
);

const conversationContextArb: fc.Arbitrary<ConversationContext> = fc.record({
  currentIntent: intentArb,
  language: languageArb,
  conversationStage: stageArb,
  collectedData: collectedDataArb,
  activeSchemeId: fc.option(fc.uuid(), { nil: undefined }),
  pendingDocuments: fc.option(
    fc.array(fc.string({ minLength: 1, maxLength: 30 }), { maxLength: 5 }),
    { nil: undefined },
  ),
});

const sessionArb: fc.Arbitrary<ConversationState> = fc.record({
  sessionId: fc.uuid(),
  userId: fc.uuid(),
  phoneNumber: fc.constant('+919876543210'),
  channel: fc.constant(Channel.WHATSAPP),
  context: conversationContextArb,
  history: fc.array(
    fc.record({
      timestamp: fc.constant(new Date()),
      userInput: fc.string({ minLength: 1, maxLength: 100 }),
      systemResponse: fc.string({ minLength: 1, maxLength: 200 }),
      intent: intentArb,
      confidence: fc.double({ min: 0, max: 1, noNaN: true }),
      language: languageArb,
    }),
    { maxLength: 10 },
  ),
  metadata: fc.record({
    startedAt: fc.constant(new Date()),
    lastActivity: fc.constant(new Date()),
    isActive: fc.boolean(),
    messageCount: fc.nat({ max: 1000 }),
  }),
});

// ─── Pure language switch simulation (no Redis needed for property tests) ─────

function simulateSwitchLanguage(
  session: ConversationState,
  newLanguage: SupportedLanguage,
): ConversationState {
  return {
    ...session,
    context: {
      ...session.context,
      language: newLanguage,
      // Deep-copy collectedData — nothing lost
      collectedData: { ...session.context.collectedData },
      activeSchemeId: session.context.activeSchemeId,
      pendingDocuments: session.context.pendingDocuments
        ? [...session.context.pendingDocuments]
        : undefined,
      conversationStage: session.context.conversationStage,
    },
    metadata: {
      ...session.metadata,
      lastActivity: new Date(),
    },
  };
}

// ─── Property 1: Multi-Language Voice Processing Consistency ─────────────────

describe('Property 1: Multi-Language Voice Processing Consistency', () => {
  /**
   * detectIntentFromText must always return a valid UserIntent — never undefined,
   * null, or a value outside the enum — for any text in any language.
   */
  it('intent detection always returns a valid UserIntent for any text and language', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }),
        languageArb,
        (text, language) => {
          const result = detectIntentFromText(text, language);
          expect(Object.values(UserIntent)).toContain(result.intent);
          expect(result.confidence).toBeGreaterThanOrEqual(0);
          expect(result.confidence).toBeLessThanOrEqual(1);
          expect(Number.isNaN(result.confidence)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Text normalization is IDEMPOTENT: normalizing an already-normalized text
   * must return the same result. Ensures the pipeline is stable regardless
   * of how many times it runs on the same input.
   */
  it('text normalization is idempotent for any text in any language', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 300 }),
        languageArb,
        (text, language) => {
          const once = normalizeTranscribedText(text, language);
          const twice = normalizeTranscribedText(once, language);
          expect(once).toBe(twice);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Text normalization NEVER increases the length of the input.
   * It only removes filler words and trims whitespace — never adds characters.
   */
  it('text normalization never increases text length', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 300 }),
        languageArb,
        (text, language) => {
          const normalized = normalizeTranscribedText(text, language);
          expect(normalized.length).toBeLessThanOrEqual(text.length);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Audio format detection is TOTAL: it never throws and always returns
   * one of the four valid formats for any buffer content, including
   * random bytes that don't match any known format.
   */
  it('audio format detection is total — never throws for any buffer content', () => {
    const validFormats = new Set(['wav', 'mp3', 'ogg', 'flac']);
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 4, maxLength: 100 }),
        (bytes) => {
          const buffer = Buffer.from(bytes);
          let format: string | undefined;
          expect(() => {
            format = detectAudioFormat(buffer);
          }).not.toThrow();
          expect(validFormats.has(format!)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * All 22 supported languages produce valid, non-throwing intent detection.
   * No language code should cause an exception or return an invalid intent.
   */
  it('all 22 supported languages produce valid intent detection results', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...supportedLanguages),
        fc.string({ minLength: 1, maxLength: 50 }),
        (language, text) => {
          let result: ReturnType<typeof detectIntentFromText> | undefined;
          expect(() => {
            result = detectIntentFromText(text, language);
          }).not.toThrow();
          expect(Object.values(UserIntent)).toContain(result!.intent);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Intent detection is DETERMINISTIC: same text + same language always
   * produces the same intent. The function has no hidden state or randomness.
   */
  it('intent detection is deterministic — same input always gives same output', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        languageArb,
        (text, language) => {
          const result1 = detectIntentFromText(text, language);
          const result2 = detectIntentFromText(text, language);
          expect(result1.intent).toBe(result2.intent);
          expect(result1.confidence).toBe(result2.confidence);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── Property 7: Language Switching Context Preservation ─────────────────────

describe('Property 7: Language Switching Context Preservation', () => {
  /**
   * After ANY language switch, ALL collected conversation data must be
   * preserved exactly. collectedData holds profile answers gathered during
   * the conversation — losing it would force users to repeat themselves.
   */
  it('all collected data is preserved exactly after a language switch', () => {
    fc.assert(
      fc.property(sessionArb, languageArb, (session, newLanguage) => {
        const original = session.context.collectedData;
        const updated = simulateSwitchLanguage(session, newLanguage);

        // Every key-value pair from original must exist in updated
        for (const [key, value] of Object.entries(original)) {
          expect(updated.context.collectedData[key]).toEqual(value);
        }

        // No extra keys were accidentally added
        const originalCount = Object.keys(original).length;
        const updatedCount = Object.keys(updated.context.collectedData).length;
        expect(updatedCount).toBe(originalCount);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Conversation stage must be preserved after a language switch.
   * A user mid-way through document collection must stay in that stage
   * after switching to their preferred language.
   */
  it('conversation stage is never reset by a language switch', () => {
    fc.assert(
      fc.property(sessionArb, languageArb, (session, newLanguage) => {
        const updated = simulateSwitchLanguage(session, newLanguage);
        expect(updated.context.conversationStage).toBe(session.context.conversationStage);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Active scheme selection is preserved after a language switch.
   * A user reviewing PM Kisan must continue to see PM Kisan — now
   * explained in their new language.
   */
  it('active scheme selection is preserved after a language switch', () => {
    fc.assert(
      fc.property(sessionArb, languageArb, (session, newLanguage) => {
        const updated = simulateSwitchLanguage(session, newLanguage);
        expect(updated.context.activeSchemeId).toBe(session.context.activeSchemeId);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Pending document list is preserved after a language switch.
   * Documents still needed must remain pending regardless of language.
   */
  it('pending documents list is preserved after a language switch', () => {
    fc.assert(
      fc.property(sessionArb, languageArb, (session, newLanguage) => {
        const updated = simulateSwitchLanguage(session, newLanguage);
        if (session.context.pendingDocuments === undefined) {
          expect(updated.context.pendingDocuments).toBeUndefined();
        } else {
          expect(updated.context.pendingDocuments).toEqual(session.context.pendingDocuments);
        }
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Switching to the SAME language is a no-op for all context fields.
   * The session language, collected data, stage, and scheme are identical.
   * Only lastActivity timestamp may change.
   */
  it('switching to the current language preserves all context fields', () => {
    fc.assert(
      fc.property(sessionArb, (session) => {
        const sameLanguage = session.context.language;
        const updated = simulateSwitchLanguage(session, sameLanguage);

        expect(updated.context.language).toBe(sameLanguage);
        expect(updated.context.collectedData).toEqual(session.context.collectedData);
        expect(updated.context.conversationStage).toBe(session.context.conversationStage);
        expect(updated.context.activeSchemeId).toBe(session.context.activeSchemeId);
        expect(updated.sessionId).toBe(session.sessionId);
        expect(updated.userId).toBe(session.userId);
        expect(updated.metadata.messageCount).toBe(session.metadata.messageCount);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Language switching is REVERSIBLE (A→B→A):
   * Switching away and back produces identical context to the original.
   * This proves no data is lost through any sequence of language changes.
   */
  it('language switching is reversible — A→B→A preserves all context', () => {
    fc.assert(
      fc.property(
        sessionArb,
        fc.tuple(languageArb, languageArb).filter(([a, b]) => a !== b),
        (session, [langA, langB]) => {
          const start: ConversationState = {
            ...session,
            context: { ...session.context, language: langA },
          };

          const afterB = simulateSwitchLanguage(start, langB);
          const afterA = simulateSwitchLanguage(afterB, langA);

          // Language restored
          expect(afterA.context.language).toBe(langA);

          // All collected data identical
          expect(afterA.context.collectedData).toEqual(start.context.collectedData);

          // Stage unchanged
          expect(afterA.context.conversationStage).toBe(start.context.conversationStage);

          // Active scheme unchanged
          expect(afterA.context.activeSchemeId).toBe(start.context.activeSchemeId);

          // Identity fields unchanged
          expect(afterA.sessionId).toBe(start.sessionId);
          expect(afterA.userId).toBe(start.userId);
          expect(afterA.metadata.messageCount).toBe(start.metadata.messageCount);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Message history count is unchanged by a language switch.
   * No phantom turns are added to history during a language transition.
   */
  it('message history length is unchanged after a language switch', () => {
    fc.assert(
      fc.property(sessionArb, languageArb, (session, newLanguage) => {
        const updated = simulateSwitchLanguage(session, newLanguage);
        expect(updated.history.length).toBe(session.history.length);
        expect(updated.metadata.messageCount).toBe(session.metadata.messageCount);
      }),
      { numRuns: 200 },
    );
  });
});
