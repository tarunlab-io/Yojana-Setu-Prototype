import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

// ─── Encryption (AES-256-GCM) ─────────────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypts a string using AES-256-GCM.
 * @param plaintext - The text to encrypt
 * @param key - 32-byte encryption key (from env: ENCRYPTION_KEY)
 * @returns Base64-encoded ciphertext with IV and auth tag prepended
 */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: iv (16 bytes) + authTag (16 bytes) + ciphertext
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Decrypts a string encrypted with the `encrypt` function.
 */
export function decrypt(ciphertext: string, key: Buffer): string {
  const data = Buffer.from(ciphertext, 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

/**
 * Derives a 32-byte encryption key from a passphrase using SHA-256.
 * In production, use proper KMS or HashiCorp Vault.
 */
export function deriveKey(passphrase: string): Buffer {
  return createHash('sha256').update(passphrase).digest();
}

// ─── Unique ID Generation ─────────────────────────────────────────────────────

/**
 * Generates a tracking reference in the format YS-YYYY-NNNNN
 * e.g. YS-2024-00042
 */
export function generateTrackingReference(sequenceNumber: number): string {
  const year = new Date().getFullYear();
  const padded = String(sequenceNumber).padStart(5, '0');
  return `YS-${year}-${padded}`;
}

/**
 * Generates a simple UUID v4.
 */
export function generateUUID(): string {
  return randomBytes(16)
    .toString('hex')
    .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
}

// ─── Profile Completion Score ─────────────────────────────────────────────────

interface ProfileCompletionInput {
  demographics: {
    fullName?: string;
    dateOfBirth?: string;
    gender?: string;
    mobileNumber?: string;
    stateCode?: string;
    district?: string;
    locality?: string;
    pinCode?: string;
  };
  socioeconomic: {
    annualIncomeINR?: number;
    casteCategory?: string;
    isBPL?: boolean;
    educationLevel?: string;
    employmentStatus?: string;
    hasDisability?: boolean;
  };
}

/**
 * Calculates a profile completion score 0–100 based on filled fields.
 */
export function calculateProfileCompletion(profile: ProfileCompletionInput): number {
  const demographicFields = Object.values(profile.demographics).filter((v) => v !== undefined && v !== '');
  const socioeconomicFields = Object.values(profile.socioeconomic).filter((v) => v !== undefined);

  const totalFields = 8 + 6; // total expected fields
  const filledFields = demographicFields.length + socioeconomicFields.length;

  return Math.round((filledFields / totalFields) * 100);
}

// ─── Language Utils ───────────────────────────────────────────────────────────

/**
 * Maps a WhatsApp language code to our SupportedLanguage enum.
 * Handles common variations and fallbacks to English.
 */
export function normalizeLanguageCode(code: string): string {
  const normalizations: Record<string, string> = {
    'hi-IN': 'hi',
    'ta-IN': 'ta',
    'te-IN': 'te',
    'mr-IN': 'mr',
    'bn-IN': 'bn',
    'gu-IN': 'gu',
    'kn-IN': 'kn',
    'ml-IN': 'ml',
    'pa-IN': 'pa',
    'ur-IN': 'ur',
    'or-IN': 'or',
    'as-IN': 'as',
  };
  return normalizations[code] ?? code.split('-')[0] ?? 'en';
}

// ─── Phone Number Utils ───────────────────────────────────────────────────────

/**
 * Normalises an Indian mobile number to E.164 format (+91XXXXXXXXXX).
 * Handles inputs like "9876543210", "09876543210", "+919876543210".
 */
export function normalizeIndianPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('91') && digits.length === 12) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith('0') && digits.length === 11) return `+91${digits.slice(1)}`;
  return `+${digits}`;
}

// ─── Response Formatting ──────────────────────────────────────────────────────

/**
 * Formats a currency amount in INR with Indian number system notation.
 * e.g. 150000 → "₹1,50,000"
 */
export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Truncates a message to fit WhatsApp's 4096 character limit.
 */
export function truncateForWhatsApp(text: string, maxLength = 4000): string {
  if (text.length <= maxLength) return text;
  return `${text.substring(0, maxLength - 3)}...`;
}
