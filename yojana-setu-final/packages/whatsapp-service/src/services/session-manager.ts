/**
 * Session Manager for WhatsApp Service
 *
 * Thin wrapper around the voice-service conversation-state module.
 * In production this would call voice-service over HTTP; here we share
 * the Redis client directly since they're co-deployed.
 */

import Redis from 'ioredis';
import {
  type ConversationState,
  type SupportedLanguage,
  Channel,
  ConversationStage,
  UserIntent,
  generateUUID,
} from '@yojana-setu/shared';
import { logger } from '../config/logger';

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
    });
    redis.on('error', (err: Error) => logger.error('Redis error', { error: err.message }));
  }
  return redis;
}

const SESSION_TTL = 60 * 60 * 24; // 24 hours
const SESSION_KEY = (id: string) => `session:${id}`;
const PHONE_KEY = (phone: string) => `session:phone:${phone}`;

export async function getOrCreateSession(phoneNumber: string): Promise<ConversationState> {
  const existingId = await getRedis().get(PHONE_KEY(phoneNumber));
  if (existingId) {
    const raw = await getRedis().get(SESSION_KEY(existingId));
    if (raw) {
      const session = JSON.parse(raw) as ConversationState;
      session.metadata.lastActivity = new Date(session.metadata.lastActivity);
      session.metadata.startedAt = new Date(session.metadata.startedAt);
      // Refresh TTL
      await getRedis().expire(SESSION_KEY(existingId), SESSION_TTL);
      await getRedis().expire(PHONE_KEY(phoneNumber), SESSION_TTL);
      return session;
    }
  }

  const session: ConversationState = {
    sessionId: generateUUID(),
    userId: '',
    phoneNumber,
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
  };

  await saveSession(session);
  logger.info('New session created', { sessionId: session.sessionId, phoneNumber });
  return session;
}

export async function saveSession(session: ConversationState): Promise<void> {
  const json = JSON.stringify(session);
  const pipeline = getRedis().pipeline();
  pipeline.set(SESSION_KEY(session.sessionId), json, 'EX', SESSION_TTL);
  pipeline.set(PHONE_KEY(session.phoneNumber), session.sessionId, 'EX', SESSION_TTL);
  await pipeline.exec();
}

export async function updateSessionContext(
  session: ConversationState,
  updates: Partial<ConversationState['context']>,
): Promise<ConversationState> {
  const updated: ConversationState = {
    ...session,
    context: {
      ...session.context,
      ...updates,
      collectedData: {
        ...session.context.collectedData,
        ...(updates.collectedData ?? {}),
      },
    },
    metadata: { ...session.metadata, lastActivity: new Date() },
  };
  await saveSession(updated);
  return updated;
}
