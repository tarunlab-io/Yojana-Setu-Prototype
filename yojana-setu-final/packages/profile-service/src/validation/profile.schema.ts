import { z } from 'zod';
import {
  SupportedLanguage,
  Gender,
  CasteCategory,
  ConsentType,
  Channel,
} from '@yojana-setu/shared';

// ─── Demographics Schema ──────────────────────────────────────────────────────

export const DemographicsSchema = z.object({
  fullName: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be at most 100 characters')
    .regex(/^[\p{L}\s.'-]+$/u, 'Name contains invalid characters'),

  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .refine((dob) => {
      const date = new Date(dob);
      const now = new Date();
      const age = now.getFullYear() - date.getFullYear();
      return age >= 0 && age <= 120;
    }, 'Invalid date of birth'),

  gender: z.nativeEnum(Gender),

  mobileNumber: z
    .string()
    .regex(/^\+91[6-9]\d{9}$/, 'Must be a valid Indian mobile number in E.164 format (+91XXXXXXXXXX)'),

  stateCode: z
    .string()
    .regex(/^IN-[A-Z]{2}$/, 'Must be a valid ISO 3166-2:IN state code (e.g. IN-TN)'),

  district: z
    .string()
    .min(2, 'District must be at least 2 characters')
    .max(100),

  locality: z
    .string()
    .min(2, 'Locality must be at least 2 characters')
    .max(200),

  pinCode: z
    .string()
    .regex(/^[1-9][0-9]{5}$/, 'Must be a valid 6-digit Indian PIN code'),
});

// ─── Socioeconomic Schema ─────────────────────────────────────────────────────

export const SocioeconomicSchema = z.object({
  annualIncomeINR: z
    .number()
    .int()
    .min(0, 'Annual income cannot be negative')
    .max(100_000_000, 'Annual income seems too high — please verify'),

  casteCategory: z.nativeEnum(CasteCategory),

  casteName: z.string().min(2).max(100).optional(),

  isBPL: z.boolean(),

  educationLevel: z.enum([
    'none',
    'primary',
    'secondary',
    'higher_secondary',
    'graduate',
    'post_graduate',
  ]),

  employmentStatus: z.enum([
    'unemployed',
    'self_employed',
    'salaried',
    'farmer',
    'student',
    'retired',
  ]),

  hasDisability: z.boolean(),

  disabilityPercentage: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional(),

  landHoldingAcres: z
    .number()
    .min(0)
    .max(10_000)
    .optional(),
}).refine(
  (data) => {
    // If hasDisability is true, disabilityPercentage should be provided
    if (data.hasDisability && data.disabilityPercentage === undefined) return false;
    // If hasDisability is false, disabilityPercentage should not be set
    if (!data.hasDisability && data.disabilityPercentage !== undefined) return false;
    return true;
  },
  {
    message: 'disabilityPercentage is required when hasDisability is true, and must not be set otherwise',
    path: ['disabilityPercentage'],
  },
);

// ─── Preferences Schema ───────────────────────────────────────────────────────

export const UserPreferencesSchema = z.object({
  preferredLanguage: z.nativeEnum(SupportedLanguage).default(SupportedLanguage.HINDI),
  preferredChannel: z.nativeEnum(Channel).default(Channel.WHATSAPP),
  notificationsEnabled: z.boolean().default(true),
  voiceResponseEnabled: z.boolean().default(false),
});

// ─── Consent Record Schema ────────────────────────────────────────────────────

export const ConsentRecordSchema = z.object({
  consentType: z.nativeEnum(ConsentType),
  granted: z.boolean(),
  timestamp: z.date(),
  sourceIdentifier: z.string().min(1),
});

// ─── Full Profile Creation Schema ─────────────────────────────────────────────

export const CreateProfileSchema = z.object({
  phoneNumber: z
    .string()
    .regex(/^\+91[6-9]\d{9}$/, 'Must be a valid Indian mobile number in E.164 format'),
  demographics: DemographicsSchema,
  socioeconomic: SocioeconomicSchema,
  preferences: UserPreferencesSchema.optional().default({
    preferredLanguage: SupportedLanguage.HINDI,
    preferredChannel: Channel.WHATSAPP,
    notificationsEnabled: true,
    voiceResponseEnabled: false,
  }),
  consentRecords: z.array(ConsentRecordSchema).default([]),
}).refine(
  (data) => data.phoneNumber === data.demographics.mobileNumber,
  {
    message: 'phoneNumber must match demographics.mobileNumber',
    path: ['phoneNumber'],
  },
);

// ─── Profile Update Schema ────────────────────────────────────────────────────

export const UpdateProfileSchema = z.object({
  demographics: DemographicsSchema.partial().optional(),
  socioeconomic: SocioeconomicSchema.partial().optional(),
  preferences: UserPreferencesSchema.partial().optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided for update' },
);

// ─── Consent Update Schema ────────────────────────────────────────────────────

export const UpdateConsentSchema = z.object({
  consentType: z.nativeEnum(ConsentType),
  granted: z.boolean(),
  sourceIdentifier: z.string().min(1).default('user_action'),
});

// ─── Inferred Types ───────────────────────────────────────────────────────────

export type CreateProfileInput = z.infer<typeof CreateProfileSchema>;
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
export type UpdateConsentInput = z.infer<typeof UpdateConsentSchema>;
