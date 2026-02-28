import {
  type IUserProfileService,
  type UserProfile,
  type UserProfileData,
  type UserProfileUpdate,
  type ConsentRecord,
  ConsentType,
  UserNotFoundError,
  ValidationError,
  ConsentRequiredError,
  calculateProfileCompletion,
  normalizeIndianPhoneNumber,
} from '@yojana-setu/shared';
import { ProfileRepository } from '../db/profile.repository';
import { CreateProfileSchema, UpdateProfileSchema, UpdateConsentSchema } from '../validation/profile.schema';
import type { CreateProfileInput, UpdateProfileInput, UpdateConsentInput } from '../validation/profile.schema';
import { logger } from '../config/logger';

export class ProfileService implements IUserProfileService {
  private readonly repo: ProfileRepository;

  constructor(repo?: ProfileRepository) {
    this.repo = repo ?? new ProfileRepository();
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  async createProfile(profileData: UserProfileData): Promise<UserProfile> {
    // Normalize phone number before validation
    const normalizedPhone = normalizeIndianPhoneNumber(profileData.phoneNumber);
    const dataToValidate = { ...profileData, phoneNumber: normalizedPhone };

    // Validate with Zod
    const parseResult = CreateProfileSchema.safeParse(dataToValidate);
    if (!parseResult.success) {
      throw new ValidationError('Invalid profile data', {
        errors: parseResult.error.flatten().fieldErrors,
      });
    }

    // Check if phone already registered
    const exists = await this.repo.phoneExists(normalizedPhone);
    if (exists) {
      throw new ValidationError('A profile with this phone number already exists', {
        field: 'phoneNumber',
        value: normalizedPhone,
      });
    }

    // Ensure DATA_STORAGE consent is present for new profiles
    const hasStorageConsent = parseResult.data.consentRecords.some(
      (r: ConsentRecord) => r.consentType === ConsentType.DATA_STORAGE && r.granted,
    );
    if (!hasStorageConsent) {
      throw new ConsentRequiredError(ConsentType.DATA_STORAGE);
    }

    const profile = await this.repo.create(parseResult.data as UserProfileData);

    logger.info('Profile created', {
      userId: profile.userId,
      completionScore: profile.completionScore,
    });

    return profile;
  }

  // ─── Read ──────────────────────────────────────────────────────────────────

  async getProfile(userId: string): Promise<UserProfile | null> {
    return this.repo.findById(userId);
  }

  async getProfileByPhone(phoneNumber: string): Promise<UserProfile | null> {
    const normalized = normalizeIndianPhoneNumber(phoneNumber);
    return this.repo.findByPhone(normalized);
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  async updateProfile(userId: string, updates: UserProfileUpdate): Promise<UserProfile> {
    // Confirm profile exists first
    const existing = await this.repo.findById(userId);
    if (!existing) throw new UserNotFoundError(userId);

    // Validate the partial update
    const parseResult = UpdateProfileSchema.safeParse(updates);
    if (!parseResult.success) {
      throw new ValidationError('Invalid profile update data', {
        errors: parseResult.error.flatten().fieldErrors,
      });
    }

    const updated = await this.repo.update(userId, parseResult.data as UserProfileUpdate);

    logger.info('Profile updated', {
      userId,
      completionScore: updated.completionScore,
      prevCompletionScore: existing.completionScore,
    });

    return updated;
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  /**
   * Hard-deletes a user profile and all associated data.
   * Used when consent is withdrawn (Requirement 9.5).
   * Cascades to documents and applications via DB foreign keys.
   */
  async deleteProfile(userId: string): Promise<void> {
    const existing = await this.repo.findById(userId);
    if (!existing) throw new UserNotFoundError(userId);

    await this.repo.delete(userId);

    logger.info('Profile deleted (consent withdrawn)', { userId });
  }

  // ─── Consent Management ────────────────────────────────────────────────────

  async checkConsent(userId: string, consentType: ConsentType): Promise<boolean> {
    return this.repo.checkConsent(userId, consentType);
  }

  async updateConsent(
    userId: string,
    consentType: ConsentType,
    granted: boolean,
  ): Promise<void> {
    const parseResult = UpdateConsentSchema.safeParse({
      consentType,
      granted,
      sourceIdentifier: 'user_action',
    });
    if (!parseResult.success) {
      throw new ValidationError('Invalid consent update', {
        errors: parseResult.error.flatten().fieldErrors,
      });
    }

    const existing = await this.repo.findById(userId);
    if (!existing) throw new UserNotFoundError(userId);

    await this.repo.updateConsent(userId, consentType, granted, 'user_action');

    // If DATA_STORAGE consent is withdrawn, schedule deletion (Req 9.5)
    if (consentType === ConsentType.DATA_STORAGE && !granted) {
      logger.warn('DATA_STORAGE consent withdrawn — profile deletion scheduled in 30 days', {
        userId,
      });
      // TODO Task 10: Trigger scheduled deletion job via notification service
    }

    logger.info('Consent updated', { userId, consentType, granted });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  calculateCompletionScore(profile: UserProfile): number {
    return calculateProfileCompletion({
      demographics: profile.demographics,
      socioeconomic: profile.socioeconomic,
    });
  }

  /**
   * Returns a list of fields the user still needs to complete.
   * Used to guide users through profile completion during conversation.
   */
  getMissingFields(profile: UserProfile): string[] {
    const missing: string[] = [];

    const d = profile.demographics;
    if (!d.fullName) missing.push('Full Name');
    if (!d.dateOfBirth) missing.push('Date of Birth');
    if (!d.gender) missing.push('Gender');
    if (!d.stateCode) missing.push('State');
    if (!d.district) missing.push('District');
    if (!d.locality) missing.push('Village/Town');
    if (!d.pinCode) missing.push('PIN Code');

    const s = profile.socioeconomic;
    if (s.annualIncomeINR === undefined) missing.push('Annual Income');
    if (!s.casteCategory) missing.push('Caste Category');
    if (!s.educationLevel) missing.push('Education Level');
    if (!s.employmentStatus) missing.push('Employment Status');

    return missing;
  }
}
