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
  defaultMeta: { service: 'whatsapp-service' },
  transports: [new winston.transports.Console()],
});

export interface WhatsAppConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  webhookSecret: string;
  /** Max messages per user per hour (rate limiting) */
  rateLimitPerHour: number;
}

export function loadConfig(): WhatsAppConfig {
  const accountSid = process.env['TWILIO_ACCOUNT_SID'] ?? '';
  const authToken = process.env['TWILIO_AUTH_TOKEN'] ?? '';
  const fromNumber = process.env['TWILIO_WHATSAPP_FROM'] ?? '';
  const webhookSecret = process.env['TWILIO_WEBHOOK_SECRET'] ?? '';

  if (!accountSid || !authToken || !fromNumber) {
    logger.warn('Twilio credentials not fully configured — WhatsApp sending will fail');
  }

  return {
    accountSid,
    authToken,
    fromNumber,
    webhookSecret,
    rateLimitPerHour: Number(process.env['RATE_LIMIT_PER_HOUR'] ?? 30),
  };
}
