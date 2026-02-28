import Redis from 'ioredis';
import { logger } from './logger';

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });

    client.on('error', (err: Error) => {
      logger.error('Redis error', { error: err.message });
    });

    client.on('connect', () => {
      logger.debug('Redis connected');
    });
  }
  return client;
}

// ─── Cache Helpers ────────────────────────────────────────────────────────────

const SCHEME_TTL_SECONDS = 60 * 60;          // 1 hour — scheme data changes infrequently
const EXPLANATION_TTL_SECONDS = 60 * 60 * 6; // 6 hours — GPT-4 explanations are expensive
const MATCH_TTL_SECONDS = 60 * 5;            // 5 minutes — eligibility is profile-dependent

export async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = await getRedis().get(key);
  if (!raw) return null;
  return JSON.parse(raw) as T;
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await getRedis().set(key, JSON.stringify(value), 'EX', ttlSeconds);
}

export async function cacheDelete(key: string): Promise<void> {
  await getRedis().del(key);
}

export async function cacheDeletePattern(pattern: string): Promise<void> {
  const keys = await getRedis().keys(pattern);
  if (keys.length > 0) {
    await getRedis().del(...keys);
  }
}

export const TTL = { SCHEME: SCHEME_TTL_SECONDS, EXPLANATION: EXPLANATION_TTL_SECONDS, MATCH: MATCH_TTL_SECONDS };
