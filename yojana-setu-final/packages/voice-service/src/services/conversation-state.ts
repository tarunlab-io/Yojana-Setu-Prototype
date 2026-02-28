/**
 * Conversation State Manager
 *
 * Manages session state in Redis with the following guarantees:
 *  - Context is preserved when user switches language mid-conversation (Req 7.5)
 *  - Sessions expire after 24 hours of inactivity (Req 5.5)
 *  - All collected data survives language switches
 */

import {
  type ConversationState,
  type ConversationContext,
  type ConversationTurn,
  type SupportedLanguage,
  UserIntent,
  ConversationStage,
  Channel,
  generateUUID,
} from '@yojana-setu/shared';
import { getRedis } from '../config/cache';
import { logger } from '../config/logger';

const SESSION_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const SESSION_PREFIX = 'session:';

function sessionKey(sessionId: string): string {
  return `${SESSION_PREFIX}${sessionId}`;
}

function phoneSessionKey(phoneNumber: string): string {
  return `${SESSION_PREFIX}phone:${phoneNumber}`;
}

// ─── Create / Get Session ─────────────────────────────────────────────────────

export async function getOrCreateSession(
  phoneNumber: string,
  userId?: string,
): Promise<ConversationState> {
  // Look up active session by phone number
  const existingId = await getRedis().get(phoneSessionKey(phoneNumber));
  if (existingId) {
    const existing = await getSession(existingId);
    if (existing && existing.metadata.isActive) {
      // Refresh TTL on access
      await getRedis().expire(sessionKey(existingId), SESSION_TTL_SECONDS);
      await getRedis().expire(phoneSessionKey(phoneNumber), SESSION_TTL_SECONDS);
      return existing;
    }
  }

  // Create new session
  const session: ConversationState = {
    sessionId: generateUUID(),
    userId: userId ?? '',
    phoneNumber,
    channel: Channel.WHATSAPP,
    context: {
      currentIntent: UserIntent.UNKNOWN,
      language: 'hi' as SupportedLanguage, // Default to Hindi
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
  };

  await saveSession(session);
  logger.info('New conversation session created', {
    sessionId: session.sessionId,
    phoneNumber,
  });
  return session;
}

export async function getSession(sessionId: string): Promise<ConversationState | null> {
  const raw = await getRedis().get(sessionKey(sessionId));
  if (!raw) return null;
  const parsed = JSON.parse(raw) as ConversationState;
  // Rehydrate Date objects
  parsed.metadata.startedAt = new Date(parsed.metadata.startedAt);
  parsed.metadata.lastActivity = new Date(parsed.metadata.lastActivity);
  parsed.history = parsed.history.map((turn) => ({
    ...turn,
    timestamp: new Date(turn.timestamp),
  }));
  return parsed;
}

// ─── Save Session ─────────────────────────────────────────────────────────────

export async function saveSession(session: ConversationState): Promise<void> {
  const json = JSON.stringify(session);
  const pipeline = getRedis().pipeline();
  pipeline.set(sessionKey(session.sessionId), json, 'EX', SESSION_TTL_SECONDS);
  pipeline.set(phoneSessionKey(session.phoneNumber), session.sessionId, 'EX', SESSION_TTL_SECONDS);
  await pipeline.exec();
}

// ─── Add Turn ─────────────────────────────────────────────────────────────────

export async function addTurn(
  session: ConversationState,
  userInput: string,
  systemResponse: string,
  intent: UserIntent,
  confidence: number,
): Promise<ConversationState> {
  const turn: ConversationTurn = {
    timestamp: new Date(),
    userInput,
    systemResponse,
    intent,
    confidence,
    language: session.context.language,
  };

  const updated: ConversationState = {
    ...session,
    history: [...session.history.slice(-49), turn], // Keep last 50 turns
    metadata: {
      ...session.metadata,
      lastActivity: new Date(),
      messageCount: session.metadata.messageCount + 1,
    },
  };

  await saveSession(updated);
  return updated;
}

// ─── Language Switch (Req 7.5) ────────────────────────────────────────────────

/**
 * Switches the session language WITHOUT losing any collected data or history.
 * This is the core of Property 7: Language Switching Context Preservation.
 */
export async function switchLanguage(
  session: ConversationState,
  newLanguage: SupportedLanguage,
): Promise<ConversationState> {
  const previousLanguage = session.context.language;

  const updated: ConversationState = {
    ...session,
    context: {
      ...session.context,
      language: newLanguage,
      // Preserve ALL collected data, active scheme, pending docs — nothing is lost
      collectedData: session.context.collectedData,
      activeSchemeId: session.context.activeSchemeId,
      pendingDocuments: session.context.pendingDocuments,
      conversationStage: session.context.conversationStage,
    },
    metadata: {
      ...session.metadata,
      lastActivity: new Date(),
    },
  };

  await saveSession(updated);

  logger.info('Session language switched', {
    sessionId: session.sessionId,
    from: previousLanguage,
    to: newLanguage,
    collectedDataKeys: Object.keys(session.context.collectedData),
    conversationStage: session.context.conversationStage,
  });

  return updated;
}

// ─── Update Context ───────────────────────────────────────────────────────────

export async function updateContext(
  session: ConversationState,
  contextUpdate: Partial<ConversationContext>,
): Promise<ConversationState> {
  const updated: ConversationState = {
    ...session,
    context: {
      ...session.context,
      ...contextUpdate,
      // Always deep-merge collectedData rather than replace
      collectedData: {
        ...session.context.collectedData,
        ...(contextUpdate.collectedData ?? {}),
      },
    },
    metadata: {
      ...session.metadata,
      lastActivity: new Date(),
    },
  };

  await saveSession(updated);
  return updated;
}

// ─── End Session ──────────────────────────────────────────────────────────────

export async function endSession(session: ConversationState): Promise<void> {
  const updated: ConversationState = {
    ...session,
    metadata: { ...session.metadata, isActive: false },
  };
  await saveSession(updated);
  logger.info('Session ended', {
    sessionId: session.sessionId,
    messageCount: session.metadata.messageCount,
    durationMs: Date.now() - session.metadata.startedAt.getTime(),
  });
}

// ─── Stale Session Detection (for reminder scheduler — Req 5.5) ──────────────

export async function getInactiveSessions(inactiveThresholdMs: number): Promise<ConversationState[]> {
  // In production: use a Redis sorted set with lastActivity as score
  // For now: scan active session keys (suitable for low volume)
  const keys = await getRedis().keys(`${SESSION_PREFIX}*`);
  const sessionKeys = keys.filter(
    (k) => !k.includes(':phone:'),
  );

  const cutoff = Date.now() - inactiveThresholdMs;
  const inactive: ConversationState[] = [];

  for (const key of sessionKeys) {
    const raw = await getRedis().get(key);
    if (!raw) continue;
    const session = JSON.parse(raw) as ConversationState;
    const lastActivity = new Date(session.metadata.lastActivity).getTime();

    if (
      session.metadata.isActive &&
      lastActivity < cutoff &&
      session.context.conversationStage !== ConversationStage.COMPLETED
    ) {
      inactive.push(session);
    }
  }

  return inactive;
}
