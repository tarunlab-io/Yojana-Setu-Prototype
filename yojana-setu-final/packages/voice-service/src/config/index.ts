import winston from 'winston';

export const logger = winston.createLogger({
  level: process.env['NODE_ENV'] === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    process.env['NODE_ENV'] === 'production'
      ? winston.format.json()
      : winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `${String(timestamp)} [${level}]: ${String(message)}${metaStr}`;
          }),
        ),
  ),
  defaultMeta: { service: 'voice-service' },
  transports: [new winston.transports.Console()],
});

// ─── Env Config ───────────────────────────────────────────────────────────────

export interface VoiceServiceConfig {
  bhashiniApiKey: string;
  bhashiniUserId: string;
  bhashiniBaseUrl: string;
  /** Maximum retries on Bhashini API failure */
  maxRetries: number;
  /** Base delay for exponential backoff (ms) */
  retryBaseDelayMs: number;
  /** Minimum ASR confidence to accept (0–1) */
  minAsrConfidence: number;
}

export function loadConfig(): VoiceServiceConfig {
  const apiKey = process.env['BHASHINI_API_KEY'];
  const userId = process.env['BHASHINI_USER_ID'];

  if (!apiKey || !userId) {
    logger.warn(
      'BHASHINI_API_KEY or BHASHINI_USER_ID not set — voice features will use mock responses in development',
    );
  }

  return {
    bhashiniApiKey: apiKey ?? 'MOCK_KEY',
    bhashiniUserId: userId ?? 'MOCK_USER',
    bhashiniBaseUrl:
      process.env['BHASHINI_BASE_URL'] ?? 'https://dhruva-api.bhashini.gov.in',
    maxRetries: 3,
    retryBaseDelayMs: 500,
    minAsrConfidence: 0.6,
  };
}
