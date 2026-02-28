import { describe, it, expect } from '@jest/globals';
import {
  CreateProfileSchema,
  UpdateProfileSchema,
  UpdateConsentSchema,
} from '../../validation/profile.schema';
import { Gender, CasteCategory, SupportedLanguage, Channel, ConsentType } from '@yojana-setu/shared';

// ─── Shared Valid Fixtures ────────────────────────────────────────────────────

const validDemographics = {
  fullName: 'Ramesh Kumar',
  dateOfBirth: '1990-05-15',
  gender: Gender.MALE,
  mobileNumber: '+919876543210',
  stateCode: 'IN-TN',
  district: 'Chennai',
  locality: 'Adyar',
  pinCode: '600020',
};

const validSocioeconomic = {
  annualIncomeINR: 180000,
  casteCategory: CasteCategory.OBC,
  isBPL: false,
  educationLevel: 'graduate' as const,
  employmentStatus: 'salaried' as const,
  hasDisability: false,
};

const validConsent = [
  {
    consentType: ConsentType.DATA_STORAGE,
    granted: true,
    timestamp: new Date(),
    sourceIdentifier: 'whatsapp_onboarding',
  },
];

const validCreateInput = {
  phoneNumber: '+919876543210',
  demographics: validDemographics,
  socioeconomic: validSocioeconomic,
  consentRecords: validConsent,
};

// ─── CreateProfileSchema Tests ────────────────────────────────────────────────

describe('CreateProfileSchema', () => {
  it('accepts a fully valid profile', () => {
    const result = CreateProfileSchema.safeParse(validCreateInput);
    expect(result.success).toBe(true);
  });

  it('rejects invalid phone number format', () => {
    const result = CreateProfileSchema.safeParse({
      ...validCreateInput,
      phoneNumber: '9876543210', // missing +91 prefix
      demographics: { ...validDemographics, mobileNumber: '9876543210' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors['phoneNumber']).toBeDefined();
    }
  });

  it('rejects when phoneNumber does not match mobileNumber', () => {
    const result = CreateProfileSchema.safeParse({
      ...validCreateInput,
      phoneNumber: '+919876543211', // different from demographics.mobileNumber
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid state code', () => {
    const result = CreateProfileSchema.safeParse({
      ...validCreateInput,
      demographics: { ...validDemographics, stateCode: 'TN' }, // missing IN- prefix
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid PIN code', () => {
    const result = CreateProfileSchema.safeParse({
      ...validCreateInput,
      demographics: { ...validDemographics, pinCode: '12345' }, // only 5 digits
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative income', () => {
    const result = CreateProfileSchema.safeParse({
      ...validCreateInput,
      socioeconomic: { ...validSocioeconomic, annualIncomeINR: -1000 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects hasDisability=true without disabilityPercentage', () => {
    const result = CreateProfileSchema.safeParse({
      ...validCreateInput,
      socioeconomic: { ...validSocioeconomic, hasDisability: true },
    });
    expect(result.success).toBe(false);
  });

  it('accepts hasDisability=true WITH disabilityPercentage', () => {
    const result = CreateProfileSchema.safeParse({
      ...validCreateInput,
      socioeconomic: {
        ...validSocioeconomic,
        hasDisability: true,
        disabilityPercentage: 40,
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects hasDisability=false WITH disabilityPercentage set', () => {
    const result = CreateProfileSchema.safeParse({
      ...validCreateInput,
      socioeconomic: {
        ...validSocioeconomic,
        hasDisability: false,
        disabilityPercentage: 40,
      },
    });
    expect(result.success).toBe(false);
  });

  it('applies default preferences when not provided', () => {
    const result = CreateProfileSchema.safeParse(validCreateInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.preferences.preferredLanguage).toBe(SupportedLanguage.HINDI);
      expect(result.data.preferences.preferredChannel).toBe(Channel.WHATSAPP);
      expect(result.data.preferences.notificationsEnabled).toBe(true);
    }
  });
});

// ─── UpdateProfileSchema Tests ────────────────────────────────────────────────

describe('UpdateProfileSchema', () => {
  it('accepts partial demographics update', () => {
    const result = UpdateProfileSchema.safeParse({
      demographics: { district: 'Coimbatore' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts partial socioeconomic update', () => {
    const result = UpdateProfileSchema.safeParse({
      socioeconomic: { annualIncomeINR: 250000 },
    });
    expect(result.success).toBe(true);
  });

  it('accepts preferences update', () => {
    const result = UpdateProfileSchema.safeParse({
      preferences: { preferredLanguage: SupportedLanguage.TAMIL },
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty update object', () => {
    const result = UpdateProfileSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects invalid income in partial update', () => {
    const result = UpdateProfileSchema.safeParse({
      socioeconomic: { annualIncomeINR: -500 },
    });
    expect(result.success).toBe(false);
  });
});

// ─── UpdateConsentSchema Tests ────────────────────────────────────────────────

describe('UpdateConsentSchema', () => {
  it('accepts valid consent grant', () => {
    const result = UpdateConsentSchema.safeParse({
      consentType: ConsentType.SCHEME_NOTIFICATIONS,
      granted: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid consent withdrawal', () => {
    const result = UpdateConsentSchema.safeParse({
      consentType: ConsentType.DATA_STORAGE,
      granted: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid consent type', () => {
    const result = UpdateConsentSchema.safeParse({
      consentType: 'INVALID_CONSENT',
      granted: true,
    });
    expect(result.success).toBe(false);
  });
});
