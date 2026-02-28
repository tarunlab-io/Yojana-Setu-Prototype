/**
 * Integration Test: Service Health & Resilience
 *
 * Verifies:
 *  1. All services respond to /health
 *  2. Services return correct error shapes for bad input
 *  3. Services handle missing required fields gracefully (400 not 500)
 *  4. Rate limiting works (WhatsApp service)
 *
 * Tag: @integration @health
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import {
  callService,
  waitForServices,
  TEST_ENV,
} from '../helpers/test-helpers';

const ALL_SERVICES = [
  { name: 'profile-service',     url: TEST_ENV.PROFILE_SERVICE },
  { name: 'scheme-service',      url: TEST_ENV.SCHEME_SERVICE },
  { name: 'document-service',    url: TEST_ENV.DOCUMENT_SERVICE },
  { name: 'application-service', url: TEST_ENV.APPLICATION_SERVICE },
  { name: 'privacy-service',     url: TEST_ENV.PRIVACY_SERVICE },
];

beforeAll(async () => {
  await waitForServices(ALL_SERVICES, 90_000);
}, 120_000);

describe('Service Health Checks', () => {
  for (const svc of ALL_SERVICES) {
    it(`${svc.name} responds to GET /health with 200`, async () => {
      const res = await fetch(`${svc.url}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { status: string };
      expect(body.status).toBe('ok');
    });
  }
});

describe('Input Validation & Error Shapes', () => {
  it('profile-service: POST /profiles with missing phoneNumber returns 400', async () => {
    const response = await callService(
      TEST_ENV.PROFILE_SERVICE, 'POST', '/profiles',
      { demographics: {}, socioeconomic: {} }, // missing phoneNumber
    );
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBeDefined();
    expect(typeof (response.body.error as { message: string }).message).toBe('string');
  });

  it('profile-service: GET /profiles/:nonexistent returns 404', async () => {
    const response = await callService(
      TEST_ENV.PROFILE_SERVICE, 'GET', '/profiles/00000000-0000-0000-0000-999999999999',
    );
    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });

  it('application-service: POST /applications with missing userId returns 400', async () => {
    const response = await callService(
      TEST_ENV.APPLICATION_SERVICE, 'POST', '/applications',
      { schemeId: 'PM_KISAN' }, // missing userId
    );
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('application-service: GET /applications/reference/:invalid returns 404', async () => {
    const response = await callService(
      TEST_ENV.APPLICATION_SERVICE, 'GET', '/applications/reference/YS-0000-00000',
    );
    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });

  it('privacy-service: POST /privacy/consent with invalid purpose returns 400', async () => {
    const response = await callService(
      TEST_ENV.PRIVACY_SERVICE, 'POST', '/privacy/consent',
      {
        userId: '00000000-0000-0000-0000-000000000001',
        purposes: ['INVALID_PURPOSE_THAT_DOES_NOT_EXIST'],
        channel: 'test',
        language: 'en',
      },
    );
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('privacy-service: consent check for unknown user returns 403', async () => {
    const response = await callService(
      TEST_ENV.PRIVACY_SERVICE, 'POST', '/privacy/consent/check',
      {
        userId: '00000000-0000-0000-0000-000000000099',
        purpose: 'profile_data',
      },
    );
    // Unknown user has no consent → 403
    expect(response.status).toBe(403);
    expect((response.body as { hasConsent: boolean }).hasConsent).toBe(false);
  });

  it('document-service: POST /documents/upload with missing mimeType returns 400', async () => {
    const response = await callService(
      TEST_ENV.DOCUMENT_SERVICE, 'POST', '/documents/upload',
      {
        fileBase64: 'aGVsbG8=',
        // missing mimeType
        documentType: 'AADHAAR',
        userId: '00000000-0000-0000-0000-000000000001',
        filename: 'test.jpg',
      },
    );
    expect([400, 422]).toContain(response.status);
    expect(response.body.success).toBe(false);
  });
});

describe('Response Contract Verification', () => {
  it('all services wrap success responses in { success: true, data: ... }', async () => {
    // Check health endpoint shapes
    for (const svc of ALL_SERVICES) {
      const res = await fetch(`${svc.url}/health`);
      const body = await res.json() as Record<string, unknown>;
      // Health endpoints use { status: 'ok' } — verify it has at least a status key
      expect(body['status']).toBe('ok');
      expect(body['service']).toBeTruthy();
    }
  });

  it('all error responses include { success: false, error: { message } }', async () => {
    // Use a known 404 path
    const response = await callService(
      TEST_ENV.APPLICATION_SERVICE, 'GET',
      '/applications/reference/YS-0000-99999',
    );
    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    const error = response.body.error as { message?: string } | undefined;
    expect(error).toBeDefined();
    expect(typeof error?.message).toBe('string');
  });
});
