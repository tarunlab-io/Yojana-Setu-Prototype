import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().default('3000').transform(Number),
  API_VERSION: z.string().default('v1'),

  // Database
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  // S3 / Object Storage
  S3_BUCKET_NAME: z.string(),
  S3_REGION: z.string().default('ap-south-1'),
  AWS_ACCESS_KEY_ID: z.string(),
  AWS_SECRET_ACCESS_KEY: z.string(),

  // Security
  JWT_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().length(32),
  API_KEY_SALT: z.string().min(16),

  // Bhashini API
  BHASHINI_API_KEY: z.string(),
  BHASHINI_USER_ID: z.string(),
  BHASHINI_BASE_URL: z.string().url().default('https://dhruva-api.bhashini.gov.in'),

  // WhatsApp (Twilio or Meta)
  WHATSAPP_PROVIDER: z.enum(['twilio', 'meta']).default('twilio'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_NUMBER: z.string().optional(),
  META_WHATSAPP_TOKEN: z.string().optional(),
  META_WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  META_WHATSAPP_VERIFY_TOKEN: z.string().optional(),

  // OpenAI
  OPENAI_API_KEY: z.string(),
  OPENAI_MODEL: z.string().default('gpt-4-turbo-preview'),

  // OCR (AWS Textract)
  OCR_PROVIDER: z.enum(['textract', 'google_vision']).default('textract'),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().default('60000').transform(Number),
  RATE_LIMIT_MAX_REQUESTS: z.string().default('100').transform(Number),

  // Session
  SESSION_INACTIVITY_TIMEOUT_HOURS: z.string().default('24').transform(Number),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
