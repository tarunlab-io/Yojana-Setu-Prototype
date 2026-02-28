/**
 * Integration Test Helpers
 *
 * Provides:
 *  - Service HTTP clients (calls real running services)
 *  - Database seeding / teardown utilities
 *  - Shared test fixtures (users, schemes, documents)
 *  - Retry helpers for eventual consistency
 */

import { Pool } from 'pg';

// ─── Environment ──────────────────────────────────────────────────────────────

export const TEST_ENV = {
  PROFILE_SERVICE:     process.env['PROFILE_SERVICE_URL']     ?? 'http://localhost:3001',
  SCHEME_SERVICE:      process.env['SCHEME_SERVICE_URL']      ?? 'http://localhost:3002',
  VOICE_SERVICE:       process.env['VOICE_SERVICE_URL']       ?? 'http://localhost:3003',
  DOCUMENT_SERVICE:    process.env['DOCUMENT_SERVICE_URL']    ?? 'http://localhost:3004',
  WHATSAPP_SERVICE:    process.env['WHATSAPP_SERVICE_URL']    ?? 'http://localhost:3005',
  APPLICATION_SERVICE: process.env['APPLICATION_SERVICE_URL'] ?? 'http://localhost:3006',
  PRIVACY_SERVICE:     process.env['PRIVACY_SERVICE_URL']     ?? 'http://localhost:3007',
  DATABASE_URL:        process.env['DATABASE_URL']            ?? 'postgresql://yojana:yojana_dev_password@localhost:5432/yojana_setu',
};

// ─── DB Pool ──────────────────────────────────────────────────────────────────

let dbPool: Pool | null = null;

export function getTestDb(): Pool {
  if (!dbPool) {
    dbPool = new Pool({ connectionString: TEST_ENV.DATABASE_URL });
  }
  return dbPool;
}

export async function closeTestDb(): Promise<void> {
  await dbPool?.end();
  dbPool = null;
}

// ─── Service Client Factory ───────────────────────────────────────────────────

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiResponse<T = unknown> {
  status: number;
  body: { success: boolean; data?: T; error?: { message: string }; [key: string]: unknown };
}

export async function callService<T = unknown>(
  baseUrl: string,
  method: HttpMethod,
  path: string,
  body?: unknown,
  query?: Record<string, string>,
): Promise<ApiResponse<T>> {
  const url = new URL(`${baseUrl}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  }

  const response = await fetch(url.toString(), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  const responseBody = await response.json() as ApiResponse<T>['body'];
  return { status: response.status, body: responseBody };
}

// ─── Service-Specific Clients ─────────────────────────────────────────────────

export const profileClient = {
  create: (data: unknown) =>
    callService(TEST_ENV.PROFILE_SERVICE, 'POST', '/profiles', data),
  get: (userId: string) =>
    callService(TEST_ENV.PROFILE_SERVICE, 'GET', `/profiles/${userId}`),
  update: (userId: string, data: unknown) =>
    callService(TEST_ENV.PROFILE_SERVICE, 'PATCH', `/profiles/${userId}`, data),
  delete: (userId: string) =>
    callService(TEST_ENV.PROFILE_SERVICE, 'DELETE', `/profiles/${userId}`),
};

export const schemeClient = {
  match: (profileData: unknown) =>
    callService(TEST_ENV.SCHEME_SERVICE, 'POST', '/schemes/match', { userProfile: profileData }),
  get: (schemeId: string) =>
    callService(TEST_ENV.SCHEME_SERVICE, 'GET', `/schemes/${schemeId}`),
  explain: (schemeId: string, language: string) =>
    callService(TEST_ENV.SCHEME_SERVICE, 'GET', `/schemes/${schemeId}/explain`, undefined, { language }),
};

export const documentClient = {
  upload: (data: unknown) =>
    callService(TEST_ENV.DOCUMENT_SERVICE, 'POST', '/documents/upload', data),
  get: (docId: string, userId: string) =>
    callService(TEST_ENV.DOCUMENT_SERVICE, 'GET', `/documents/${docId}`, undefined, { userId }),
  checkReadiness: (data: unknown) =>
    callService(TEST_ENV.DOCUMENT_SERVICE, 'POST', '/documents/scheme-readiness', data),
};

export const applicationClient = {
  start: (data: unknown) =>
    callService(TEST_ENV.APPLICATION_SERVICE, 'POST', '/applications', data),
  submit: (id: string, data: unknown) =>
    callService(TEST_ENV.APPLICATION_SERVICE, 'POST', `/applications/${id}/submit`, data),
  track: (id: string, userId: string) =>
    callService(TEST_ENV.APPLICATION_SERVICE, 'GET', `/applications/${id}/track`, undefined, { userId }),
  trackByRef: (ref: string) =>
    callService(TEST_ENV.APPLICATION_SERVICE, 'GET', `/applications/reference/${ref}`),
  withdraw: (id: string, data: unknown) =>
    callService(TEST_ENV.APPLICATION_SERVICE, 'POST', `/applications/${id}/withdraw`, data),
};

export const privacyClient = {
  grantConsent: (data: unknown) =>
    callService(TEST_ENV.PRIVACY_SERVICE, 'POST', '/privacy/consent', data),
  revokeConsent: (data: unknown) =>
    callService(TEST_ENV.PRIVACY_SERVICE, 'DELETE', '/privacy/consent', data),
  getConsentStatus: (userId: string) =>
    callService(TEST_ENV.PRIVACY_SERVICE, 'GET', `/privacy/consent/${userId}`),
  requestDeletion: (data: unknown) =>
    callService(TEST_ENV.PRIVACY_SERVICE, 'POST', '/privacy/deletion-request', data),
  exportData: (userId: string) =>
    callService(TEST_ENV.PRIVACY_SERVICE, 'GET', `/privacy/export/${userId}`),
};

// ─── Retry Utility ────────────────────────────────────────────────────────────

export async function retryUntil<T>(
  fn: () => Promise<T>,
  condition: (result: T) => boolean,
  options: { maxAttempts?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
  const { maxAttempts = 10, intervalMs = 500, label = 'condition' } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await fn();
    if (condition(result)) return result;
    if (attempt < maxAttempts) {
      await sleep(intervalMs);
    }
  }
  throw new Error(`retryUntil: "${label}" not satisfied after ${maxAttempts} attempts`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Health Check ─────────────────────────────────────────────────────────────

export async function waitForServices(
  services: Array<{ name: string; url: string }>,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  for (const svc of services) {
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${svc.url}/health`, { signal: AbortSignal.timeout(2_000) });
        if (res.ok) break;
      } catch {
        // Not ready yet
      }
      await sleep(1_000);
    }
    if (Date.now() >= deadline) {
      throw new Error(`Service ${svc.name} did not become healthy within ${timeoutMs}ms`);
    }
  }
}

// ─── Test Fixtures ────────────────────────────────────────────────────────────

export const FIXTURES = {
  validUserProfile: {
    phoneNumber: '+919876543210',
    demographics: {
      fullName: 'Priya Sharma',
      dateOfBirth: '1990-08-15',
      gender: 'FEMALE',
      stateCode: 'IN-TN',
      district: 'Chennai',
      locality: 'Adyar',
      pinCode: '600020',
      mobileNumber: '+919876543210',
    },
    socioeconomic: {
      annualIncomeINR: 180000,
      casteCategory: 'OBC',
      isBPL: false,
      educationLevel: 'graduate',
      employmentStatus: 'self_employed',
      hasDisability: false,
    },
    preferences: {
      preferredLanguage: 'ta',
      preferredChannel: 'whatsapp',
      notificationsEnabled: true,
    },
  },

  pmKisanEligibleProfile: {
    phoneNumber: '+919876543211',
    demographics: {
      fullName: 'Ramesh Kumar',
      dateOfBirth: '1975-03-20',
      gender: 'MALE',
      stateCode: 'IN-UP',
      district: 'Lucknow',
      locality: 'Sitapur Road',
      pinCode: '226001',
      mobileNumber: '+919876543211',
    },
    socioeconomic: {
      annualIncomeINR: 75000,
      casteCategory: 'SC',
      isBPL: true,
      educationLevel: 'primary',
      employmentStatus: 'agricultural_labour',
      hasDisability: false,
    },
    preferences: {
      preferredLanguage: 'hi',
      preferredChannel: 'whatsapp',
      notificationsEnabled: true,
    },
  },

  smallAadhaarImage: (() => {
    // 1x1 pixel PNG as base64 — minimal valid image for upload tests
    return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  })(),
};

// ─── Database Cleanup ─────────────────────────────────────────────────────────

export async function cleanTestData(phoneNumbers: string[]): Promise<void> {
  const db = getTestDb();
  for (const phone of phoneNumbers) {
    await db.query(
      `DELETE FROM user_profiles WHERE phone_number = $1`,
      [phone],
    );
  }
}

export async function cleanupAllTestData(): Promise<void> {
  const db = getTestDb();
  // Delete test data identified by phone numbers starting with +9199
  await db.query(
    `DELETE FROM user_profiles WHERE phone_number LIKE '+9199%'`,
  );
}
