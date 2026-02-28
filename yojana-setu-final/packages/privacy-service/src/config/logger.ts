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
  defaultMeta: { service: 'privacy-service' },
  transports: [new winston.transports.Console()],
});

// ─── Retention Periods (days) ─────────────────────────────────────────────────
// Based on PDPB (Personal Data Protection Bill) and scheme-specific requirements

export const RETENTION_PERIODS = {
  /** Active user profile — kept until deletion requested */
  ACTIVE_PROFILE: null as null,
  /** Inactive accounts — auto-delete after 2 years of no activity */
  INACTIVE_PROFILE: 365 * 2,
  /** Application records — 7 years for audit (government requirement) */
  APPLICATION_RECORDS: 365 * 7,
  /** Documents — 90 days after application completion or rejection */
  DOCUMENTS: 90,
  /** Conversation history — 12 months */
  CONVERSATION_HISTORY: 365,
  /** Audit logs — 3 years */
  AUDIT_LOGS: 365 * 3,
  /** Consent records — lifetime (legal obligation to prove consent was given) */
  CONSENT_RECORDS: null as null,
} as const;

export type RetentionPeriodKey = keyof typeof RETENTION_PERIODS;
