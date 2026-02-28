import Redis from 'ioredis';
import { createHash } from 'crypto';
import { logger } from './logger';

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
    client.on('error', (err: Error) => logger.error('Redis error', { error: err.message }));
  }
  return client;
}

const TTL = {
  TRANSLATION: 60 * 60 * 24,  // 24 hours — same text+lang pair rarely changes
  TTS: 60 * 60 * 6,            // 6 hours — audio for common phrases
  LANGUAGE_DETECT: 60 * 60,    // 1 hour
} as const;

/** Content-addressable cache key based on text hash */
export function translationKey(text: string, from: string, to: string): string {
  const hash = createHash('md5').update(text).digest('hex').slice(0, 12);
  return `voice:translation:${from}:${to}:${hash}`;
}

export function ttsKey(text: string, language: string, gender: string): string {
  const hash = createHash('md5').update(text).digest('hex').slice(0, 12);
  return `voice:tts:${language}:${gender}:${hash}`;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = await getRedis().get(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

export async function cacheSet(key: string, value: unknown, ttl: number): Promise<void> {
  await getRedis().set(key, JSON.stringify(value), 'EX', ttl);
}

export { TTL };
