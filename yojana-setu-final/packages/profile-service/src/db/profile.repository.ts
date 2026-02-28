import type { PoolClient } from 'pg';
import { getPool, withTransaction } from './pg-client';
import {
  encrypt,
  decrypt,
  deriveKey,
  calculateProfileCompletion,
  generateUUID,
  type UserProfile,
  type UserProfileData,
  type UserProfileUpdate,
  type Demographics,
  type SocioeconomicData,
  type UserPreferences,
  type ConsentRecord,
  ConsentType,
  UserNotFoundError,
} from '@yojana-setu/shared';

// ─── Encryption Key ───────────────────────────────────────────────────────────

function getEncryptionKey(): Buffer {
  const keyPassphrase = process.env['ENCRYPTION_KEY'];
  if (!keyPassphrase) throw new Error('ENCRYPTION_KEY environment variable is not set');
  return deriveKey(keyPassphrase);
}

// ─── Row Mapping ──────────────────────────────────────────────────────────────

interface UserProfileRow {
  user_id: string;
  phone_number: string;
  demographics: Buffer;
  socioeconomic: Buffer;
  preferences: UserPreferences;
  consent_records: ConsentRecord[];
  completion_score: number;
  created_at: Date;
  updated_at: Date;
}

function rowToProfile(row: UserProfileRow): UserProfile {
  const key = getEncryptionKey();
  return {
    userId: row.user_id,
    phoneNumber: row.phone_number,
    demographics: JSON.parse(decrypt(row.demographics.toString(), key)) as Demographics,
    socioeconomic: JSON.parse(decrypt(row.socioeconomic.toString(), key)) as SocioeconomicData,
    preferences: row.preferences,
    consentRecords: row.consent_records,
    completionScore: row.completion_score,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Repository ───────────────────────────────────────────────────────────────

export class ProfileRepository {
  async create(data: UserProfileData): Promise<UserProfile> {
    const key = getEncryptionKey();
    const userId = generateUUID();
    const encryptedDemographics = encrypt(JSON.stringify(data.demographics), key);
    const encryptedSocioeconomic = encrypt(JSON.stringify(data.socioeconomic), key);

    const completionScore = calculateProfileCompletion({
      demographics: data.demographics,
      socioeconomic: data.socioeconomic,
    });

    const result = await getPool().query<UserProfileRow>(
      `INSERT INTO user_profiles
         (user_id, phone_number, demographics, socioeconomic, preferences, consent_records, completion_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        userId,
        data.phoneNumber,
        Buffer.from(encryptedDemographics),
        Buffer.from(encryptedSocioeconomic),
        JSON.stringify(data.preferences),
        JSON.stringify(data.consentRecords),
        completionScore,
      ],
    );

    return rowToProfile(result.rows[0]!);
  }

  async findById(userId: string): Promise<UserProfile | null> {
    const result = await getPool().query<UserProfileRow>(
      'SELECT * FROM user_profiles WHERE user_id = $1',
      [userId],
    );
    if (result.rows.length === 0) return null;
    return rowToProfile(result.rows[0]!);
  }

  async findByPhone(phoneNumber: string): Promise<UserProfile | null> {
    const result = await getPool().query<UserProfileRow>(
      'SELECT * FROM user_profiles WHERE phone_number = $1',
      [phoneNumber],
    );
    if (result.rows.length === 0) return null;
    return rowToProfile(result.rows[0]!);
  }

  async update(userId: string, updates: UserProfileUpdate): Promise<UserProfile> {
    return withTransaction(async (client: PoolClient) => {
      // Fetch current profile first
      const current = await client.query<UserProfileRow>(
        'SELECT * FROM user_profiles WHERE user_id = $1 FOR UPDATE',
        [userId],
      );
      if (current.rows.length === 0) throw new UserNotFoundError(userId);

      const currentProfile = rowToProfile(current.rows[0]!);
      const key = getEncryptionKey();

      // Merge updates
      const mergedDemographics = updates.demographics
        ? { ...currentProfile.demographics, ...updates.demographics }
        : currentProfile.demographics;

      const mergedSocioeconomic = updates.socioeconomic
        ? { ...currentProfile.socioeconomic, ...updates.socioeconomic }
        : currentProfile.socioeconomic;

      const mergedPreferences = updates.preferences
        ? { ...currentProfile.preferences, ...updates.preferences }
        : currentProfile.preferences;

      const newCompletionScore = calculateProfileCompletion({
        demographics: mergedDemographics,
        socioeconomic: mergedSocioeconomic,
      });

      const result = await client.query<UserProfileRow>(
        `UPDATE user_profiles
         SET demographics = $2,
             socioeconomic = $3,
             preferences = $4,
             completion_score = $5,
             updated_at = NOW()
         WHERE user_id = $1
         RETURNING *`,
        [
          userId,
          Buffer.from(encrypt(JSON.stringify(mergedDemographics), key)),
          Buffer.from(encrypt(JSON.stringify(mergedSocioeconomic), key)),
          JSON.stringify(mergedPreferences),
          newCompletionScore,
        ],
      );

      return rowToProfile(result.rows[0]!);
    });
  }

  async updateConsent(
    userId: string,
    consentType: ConsentType,
    granted: boolean,
    sourceIdentifier: string,
  ): Promise<void> {
    // Fetch current consent records
    const result = await getPool().query<Pick<UserProfileRow, 'consent_records'>>(
      'SELECT consent_records FROM user_profiles WHERE user_id = $1',
      [userId],
    );
    if (result.rows.length === 0) throw new UserNotFoundError(userId);

    const existing: ConsentRecord[] = result.rows[0]!.consent_records;

    // Upsert the consent record for this type
    const newRecord: ConsentRecord = {
      consentType,
      granted,
      timestamp: new Date(),
      sourceIdentifier,
    };

    const updatedRecords = [
      ...existing.filter((r) => r.consentType !== consentType),
      newRecord,
    ];

    await getPool().query(
      'UPDATE user_profiles SET consent_records = $2, updated_at = NOW() WHERE user_id = $1',
      [userId, JSON.stringify(updatedRecords)],
    );
  }

  async delete(userId: string): Promise<void> {
    const result = await getPool().query(
      'DELETE FROM user_profiles WHERE user_id = $1',
      [userId],
    );
    if (result.rowCount === 0) throw new UserNotFoundError(userId);
  }

  async checkConsent(userId: string, consentType: ConsentType): Promise<boolean> {
    const result = await getPool().query<Pick<UserProfileRow, 'consent_records'>>(
      'SELECT consent_records FROM user_profiles WHERE user_id = $1',
      [userId],
    );
    if (result.rows.length === 0) throw new UserNotFoundError(userId);

    const records: ConsentRecord[] = result.rows[0]!.consent_records;
    const record = records.find((r) => r.consentType === consentType);
    return record?.granted ?? false;
  }

  async phoneExists(phoneNumber: string): Promise<boolean> {
    const result = await getPool().query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM user_profiles WHERE phone_number = $1) as exists',
      [phoneNumber],
    );
    return result.rows[0]!.exists;
  }
}
