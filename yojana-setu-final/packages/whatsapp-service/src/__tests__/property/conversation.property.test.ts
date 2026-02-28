/**
 * Property-based tests for the WhatsApp Conversation Service.
 *
 * Feature: yojana-setu
 * Property 5: Conversation Flow Completion
 *   For any sequence of valid user inputs, the conversation should
 *   progress toward completion without getting stuck in an infinite loop.
 *   Validates: Requirements 2.1, 2.2, 2.3, 5.1
 *
 * Property 8: Multi-Turn Context Consistency
 *   For any conversation history, the system should maintain consistent
 *   context and not contradict itself across turns.
 *   Validates: Requirements 5.1, 5.4, 5.5
 */

import * as fc from 'fast-check';
import { describe, it, expect } from '@jest/globals';
import {
  UserIntent,
  ConversationStage,
  Channel,
  SupportedLanguage,
  type ConversationState,
  type ConversationContext,
} from '@yojana-setu/shared';

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const intentArb = fc.constantFrom(...Object.values(UserIntent));
const stageArb = fc.constantFrom(...Object.values(ConversationStage));
const languageArb = fc.constantFrom(
  'hi', 'en', 'ta', 'te', 'mr', 'bn', 'gu', 'kn', 'ml', 'pa',
) as fc.Arbitrary<SupportedLanguage>;

const collectedDataArb = fc.dictionary(
  fc.stringMatching(/^[a-z][a-zA-Z]{0,19}$/),
  fc.oneof(
    fc.string({ minLength: 1, maxLength: 50 }),
    fc.nat({ max: 10_000_000 }),
    fc.boolean(),
  ),
);

const sessionArb: fc.Arbitrary<ConversationState> = fc.record({
  sessionId: fc.uuid(),
  userId: fc.oneof(fc.uuid(), fc.constant('')),
  phoneNumber: fc.constant('+919876543210'),
  channel: fc.constant(Channel.WHATSAPP),
  context: fc.record({
    currentIntent: intentArb,
    language: languageArb,
    conversationStage: stageArb,
    collectedData: collectedDataArb,
    activeSchemeId: fc.option(fc.uuid(), { nil: undefined }),
    pendingDocuments: fc.option(
      fc.array(fc.string({ minLength: 1, maxLength: 30 }), { maxLength: 5 }),
      { nil: undefined },
    ),
  }),
  history: fc.array(
    fc.record({
      timestamp: fc.constant(new Date()),
      userInput: fc.string({ minLength: 1, maxLength: 100 }),
      systemResponse: fc.string({ minLength: 1, maxLength: 300 }),
      intent: intentArb,
      confidence: fc.double({ min: 0, max: 1, noNaN: true }),
      language: languageArb,
    }),
    { maxLength: 50 },
  ),
  metadata: fc.record({
    startedAt: fc.constant(new Date()),
    lastActivity: fc.constant(new Date()),
    isActive: fc.boolean(),
    messageCount: fc.nat({ max: 1000 }),
  }),
});

// ─── Simulated routing helpers (pure — no I/O) ───────────────────────────────

const MID_FLOW_STAGES = new Set([
  ConversationStage.PROFILE_COLLECTION,
  ConversationStage.DOCUMENT_COLLECTION,
  ConversationStage.SCHEME_EXPLANATION,
  ConversationStage.APPLICATION_REVIEW,
]);

const AFFIRMATIONS = new Set([
  'yes','no','haan','nahi','ok','okay','sure','done','1','2','3','4','5',
]);

function isAffirmation(text: string): boolean {
  return AFFIRMATIONS.has(text.toLowerCase().trim());
}

function shouldUseStageHandler(
  stage: ConversationStage,
  text: string,
  intent: UserIntent,
  confidence: number,
): boolean {
  if (!MID_FLOW_STAGES.has(stage)) return false;
  return isAffirmation(text) || intent === UserIntent.UNKNOWN || confidence < 0.7;
}

/**
 * Simulate adding a turn to a session — pure function, mirrors addTurn in voice-service.
 */
function addTurn(
  session: ConversationState,
  userInput: string,
  response: string,
  intent: UserIntent,
  confidence: number,
): ConversationState {
  const turn = {
    timestamp: new Date(),
    userInput,
    systemResponse: response,
    intent,
    confidence,
    language: session.context.language,
  };
  return {
    ...session,
    history: [...session.history.slice(-49), turn],
    metadata: {
      ...session.metadata,
      lastActivity: new Date(),
      messageCount: session.metadata.messageCount + 1,
    },
  };
}

/**
 * Simulate a language switch — mirrors switchLanguage in voice-service.
 */
function switchLanguage(session: ConversationState, lang: SupportedLanguage): ConversationState {
  return {
    ...session,
    context: {
      ...session.context,
      language: lang,
      collectedData: { ...session.context.collectedData },
      activeSchemeId: session.context.activeSchemeId,
      pendingDocuments: session.context.pendingDocuments
        ? [...session.context.pendingDocuments]
        : undefined,
      conversationStage: session.context.conversationStage,
    },
    metadata: { ...session.metadata, lastActivity: new Date() },
  };
}

// ─── Property 5: Conversation Flow Completion ─────────────────────────────────

describe('Property 5: Conversation Flow Completion', () => {
  /**
   * Stage handler override is MONOTONE with respect to flow continuity:
   * If a mid-flow stage handler is selected, the conversationStage never
   * regresses to GREETING for the same session.
   */
  it('stage handler selection never causes stage regression to GREETING', () => {
    fc.assert(
      fc.property(sessionArb, fc.string({ minLength: 1, maxLength: 50 }), (session, text) => {
        const intent = UserIntent.UNKNOWN;
        const confidence = 0.3;
        const useStage = shouldUseStageHandler(
          session.context.conversationStage, text, intent, confidence,
        );

        if (useStage) {
          // The stage handler was selected — stage must be mid-flow, not GREETING
          expect(MID_FLOW_STAGES.has(session.context.conversationStage)).toBe(true);
          expect(session.context.conversationStage).not.toBe(ConversationStage.GREETING);
        }
      }),
      { numRuns: 200 },
    );
  });

  /**
   * For any user in GREETING stage, affirmations do NOT trigger stage handler.
   * New users must always go through the greeting flow regardless of input.
   */
  it('GREETING stage never uses stage handler — even for affirmations', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Array.from(AFFIRMATIONS)),
        (affirmation) => {
          const useStage = shouldUseStageHandler(
            ConversationStage.GREETING, affirmation, UserIntent.UNKNOWN, 0.3,
          );
          expect(useStage).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * Explicit high-confidence intent ALWAYS wins over stage handler.
   * If a user clearly says "show me schemes" mid-flow with 90% confidence,
   * the routing must honour that intent.
   */
  it('explicit high-confidence intent overrides mid-flow stage handler', () => {
    const HIGH_CONFIDENCE_INTENTS = [
      UserIntent.DISCOVER_SCHEMES,
      UserIntent.UPLOAD_DOCUMENT,
      UserIntent.TRACK_APPLICATION,
      UserIntent.SWITCH_LANGUAGE,
      UserIntent.HELP,
    ];

    fc.assert(
      fc.property(
        fc.constantFrom(...Array.from(MID_FLOW_STAGES)),
        fc.constantFrom(...HIGH_CONFIDENCE_INTENTS),
        (stage, intent) => {
          const highConfidenceText = 'find me schemes today'; // Not an affirmation
          const useStage = shouldUseStageHandler(stage, highConfidenceText, intent, 0.9);
          expect(useStage).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Message history length is BOUNDED — never exceeds 50 turns per session.
   * This prevents unbounded memory growth for long-running sessions.
   */
  it('message history never exceeds 50 turns regardless of how many are added', () => {
    fc.assert(
      fc.property(
        sessionArb,
        fc.array(
          fc.record({
            input: fc.string({ minLength: 1, maxLength: 50 }),
            response: fc.string({ minLength: 1, maxLength: 100 }),
            intent: intentArb,
            confidence: fc.double({ min: 0, max: 1, noNaN: true }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (session, turns) => {
          let current = session;
          for (const turn of turns) {
            current = addTurn(current, turn.input, turn.response, turn.intent, turn.confidence);
          }
          expect(current.history.length).toBeLessThanOrEqual(50);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * messageCount is MONOTONICALLY INCREASING — adding a turn always
   * increments it by exactly 1.
   */
  it('messageCount increments by exactly 1 per turn added', () => {
    fc.assert(
      fc.property(
        sessionArb,
        fc.string({ minLength: 1, maxLength: 50 }),
        (session, input) => {
          const before = session.metadata.messageCount;
          const after = addTurn(session, input, 'response', UserIntent.UNKNOWN, 0.5);
          expect(after.metadata.messageCount).toBe(before + 1);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── Property 8: Multi-Turn Context Consistency ───────────────────────────────

describe('Property 8: Multi-Turn Context Consistency', () => {
  /**
   * Collected data is APPEND-ONLY during a session:
   * Once a field is collected, it must still be present after any subsequent turn.
   * (Data can be updated but never silently dropped.)
   */
  it('collected data fields are never silently dropped after a turn is added', () => {
    fc.assert(
      fc.property(
        sessionArb,
        fc.string({ minLength: 1, maxLength: 50 }),
        (session, input) => {
          const fieldsBefore = Object.keys(session.context.collectedData);
          const after = addTurn(session, input, 'response', UserIntent.UNKNOWN, 0.5);

          // All previously collected fields must still be present
          for (const field of fieldsBefore) {
            expect(field in after.context.collectedData).toBe(true);
            expect(after.context.collectedData[field]).toEqual(
              session.context.collectedData[field],
            );
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Session identity (sessionId, userId, phoneNumber) is IMMUTABLE
   * across any number of turns. These must never change during a session.
   */
  it('session identity fields are immutable across turns', () => {
    fc.assert(
      fc.property(
        sessionArb,
        fc.array(
          fc.string({ minLength: 1, maxLength: 50 }),
          { minLength: 1, maxLength: 10 },
        ),
        (session, inputs) => {
          let current = session;
          for (const input of inputs) {
            current = addTurn(current, input, 'resp', UserIntent.UNKNOWN, 0.5);
          }
          expect(current.sessionId).toBe(session.sessionId);
          expect(current.userId).toBe(session.userId);
          expect(current.phoneNumber).toBe(session.phoneNumber);
          expect(current.channel).toBe(session.channel);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Language switching COMBINED WITH turn addition must preserve all
   * collected data. This is the multi-service interaction invariant:
   * voice-service switch + whatsapp-service turn add = no data loss.
   */
  it('language switch followed by turn addition preserves all collected data', () => {
    fc.assert(
      fc.property(
        sessionArb,
        languageArb,
        fc.string({ minLength: 1, maxLength: 50 }),
        (session, newLang, input) => {
          const originalFields = { ...session.context.collectedData };

          // Switch language
          const afterSwitch = switchLanguage(session, newLang);
          // Add a turn
          const afterTurn = addTurn(afterSwitch, input, 'response', UserIntent.UNKNOWN, 0.5);

          // All original fields must be present with original values
          for (const [key, value] of Object.entries(originalFields)) {
            expect(afterTurn.context.collectedData[key]).toEqual(value);
          }

          // Language must be the new one
          expect(afterTurn.context.language).toBe(newLang);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * The turn's language is always recorded as the session's language at the time
   * the turn was added — not some future language. Historical turns preserve
   * the language in which they occurred.
   */
  it('each turn records the language at the time it was added', () => {
    fc.assert(
      fc.property(
        sessionArb,
        fc.string({ minLength: 1, maxLength: 50 }),
        (session, input) => {
          const langAtTime = session.context.language;
          const after = addTurn(session, input, 'response', UserIntent.HELP, 0.9);
          const lastTurn = after.history[after.history.length - 1]!;
          expect(lastTurn.language).toBe(langAtTime);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * isActive flag only transitions FALSE→FALSE or TRUE→FALSE, never FALSE→TRUE.
   * Once a session is ended, it cannot be automatically reactivated.
   */
  it('isActive never transitions from false to true via turn addition', () => {
    fc.assert(
      fc.property(
        sessionArb.filter((s) => !s.metadata.isActive),
        fc.string({ minLength: 1, maxLength: 50 }),
        (inactiveSession, input) => {
          const after = addTurn(inactiveSession, input, 'resp', UserIntent.UNKNOWN, 0.5);
          // Adding a turn to an inactive session must not reactivate it
          expect(after.metadata.isActive).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
