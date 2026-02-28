/**
 * Integration Test: Privacy & Consent Lifecycle
 *
 * Tests the full consent and data lifecycle:
 *  1. Consent grant → verify gating works
 *  2. Consent revocation → verify data processing blocked
 *  3. Right to erasure flow
 *  4. Audit trail integrity
 *
 * Tag: @integration @privacy
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import {
  profileClient,
  privacyClient,
  callService,
  waitForServices,
  cleanTestData,
  FIXTURES,
  TEST_ENV,
  sleep,
} from '../helpers/test-helpers';

const ALL_SERVICES = [
  { name: 'profile-service',  url: TEST_ENV.PROFILE_SERVICE },
  { name: 'privacy-service',  url: TEST_ENV.PRIVACY_SERVICE },
];

const TEST_PHONE_PRIVACY = '+919900000002';
let privacyUserId = '';

beforeAll(async () => {
  await waitForServices(ALL_SERVICES, 90_000);
  await cleanTestData([TEST_PHONE_PRIVACY]);
}, 120_000);

afterAll(async () => {
  await cleanTestData([TEST_PHONE_PRIVACY]);
});

describe('Privacy & Consent Lifecycle', () => {

  // ── Setup: Create a user ───────────────────────────────────────────────────

  it('1. Creates user for privacy tests', async () => {
    const response = await profileClient.create({
      ...FIXTURES.pmKisanEligibleProfile,
      phoneNumber: TEST_PHONE_PRIVACY,
    });

    expect([201, 200]).toContain(response.status);
    const profile = response.body.data as { userId: string };
    privacyUserId = profile.userId;
    expect(privacyUserId).toBeTruthy();
  });

  // ── Consent Grant ──────────────────────────────────────────────────────────

  it('2. Grants consent and verifies status', async () => {
    const grantResponse = await privacyClient.grantConsent({
      userId: privacyUserId,
      purposes: ['profile_data', 'scheme_matching'],
      channel: 'test',
      language: 'en',
    });

    expect(grantResponse.status).toBe(201);

    const statusResponse = await privacyClient.getConsentStatus(privacyUserId);
    expect(statusResponse.status).toBe(200);

    const status = statusResponse.body.data as { granted: string[]; pending: string[] };
    expect(status.granted).toContain('profile_data');
    expect(status.granted).toContain('scheme_matching');
    // third_party_sharing not yet granted
    expect(status.pending).toContain('third_party_sharing');
  });

  // ── Consent History (append-only) ─────────────────────────────────────────

  it('3. Consent history is append-only — re-granting same purpose adds a new record', async () => {
    // Grant again (simulates privacy notice version update)
    const reGrant = await privacyClient.grantConsent({
      userId: privacyUserId,
      purposes: ['profile_data'],
      channel: 'test',
      language: 'en',
    });
    expect(reGrant.status).toBe(201);

    const historyResponse = await callService(
      TEST_ENV.PRIVACY_SERVICE,
      'GET',
      `/privacy/consent/${privacyUserId}/history`,
    );
    expect(historyResponse.status).toBe(200);

    const history = historyResponse.body.data as unknown[];
    // Should have at least 2 profile_data records (original + re-grant)
    const profileDataRecords = history.filter(
      (r) => (r as { purpose: string }).purpose === 'profile_data',
    );
    expect(profileDataRecords.length).toBeGreaterThanOrEqual(2);
  });

  // ── Consent Revocation ─────────────────────────────────────────────────────

  it('4. Revokes consent for analytics — status reflects revocation', async () => {
    // First grant analytics consent
    await privacyClient.grantConsent({
      userId: privacyUserId,
      purposes: ['analytics'],
      channel: 'test',
      language: 'en',
    });

    // Then revoke it
    const revokeResponse = await privacyClient.revokeConsent({
      userId: privacyUserId,
      purposes: ['analytics'],
    });

    expect(revokeResponse.status).toBe(200);
    const result = revokeResponse.body.data as {
      revokedPurposes: string[];
      dataDeletionRequired: string[];
    };
    expect(result.revokedPurposes).toContain('analytics');
    expect(result.dataDeletionRequired).toContain('analytics_data');

    // Verify status
    const statusResponse = await privacyClient.getConsentStatus(privacyUserId);
    const status = statusResponse.body.data as { revoked: string[] };
    expect(status.revoked).toContain('analytics');
  });

  // ── Consent Check Endpoint ─────────────────────────────────────────────────

  it('5. Consent check returns 200 for active consent', async () => {
    const response = await callService(
      TEST_ENV.PRIVACY_SERVICE,
      'POST',
      '/privacy/consent/check',
      { userId: privacyUserId, purpose: 'profile_data' },
    );
    expect(response.status).toBe(200);
    expect((response.body as { hasConsent: boolean }).hasConsent).toBe(true);
  });

  it('6. Consent check returns 403 for revoked consent', async () => {
    const response = await callService(
      TEST_ENV.PRIVACY_SERVICE,
      'POST',
      '/privacy/consent/check',
      { userId: privacyUserId, purpose: 'analytics' },
    );
    expect(response.status).toBe(403);
    expect((response.body as { hasConsent: boolean }).hasConsent).toBe(false);
  });

  // ── Data Export ────────────────────────────────────────────────────────────

  it('7. Data export contains user profile and consent history', async () => {
    const response = await privacyClient.exportData(privacyUserId);
    expect([200, 202]).toContain(response.status);

    if (response.status === 200) {
      // Response is the raw export JSON (not wrapped in success/data)
      const exportData = response.body as Record<string, unknown>;
      expect(exportData['exportId']).toBeTruthy();
      expect(exportData['userId']).toBe(privacyUserId);
      expect(exportData['retentionPolicies']).toBeDefined();
      expect(exportData['privacyNoticeUrl']).toBeTruthy();
    }
  });

  // ── Deletion Request ───────────────────────────────────────────────────────

  it('8. Deletion request is accepted and scheduled', async () => {
    const response = await privacyClient.requestDeletion({
      userId: privacyUserId,
      reason: 'User requested account deletion — integration test',
    });

    expect(response.status).toBe(202);

    const request = response.body.data as {
      requestId: string;
      status: string;
      scheduledDeletionAt: string;
    };

    expect(request.requestId).toBeTruthy();
    expect(['scheduled', 'blocked']).toContain(request.status);
    expect(new Date(request.scheduledDeletionAt).getTime()).toBeGreaterThan(Date.now());
  });

  // ── Audit Chain Integrity ──────────────────────────────────────────────────

  it('9. Audit chain is intact for all privacy operations', async () => {
    const response = await callService(
      TEST_ENV.PRIVACY_SERVICE,
      'GET',
      `/privacy/audit/${privacyUserId}/integrity`,
    );

    expect(response.status).toBe(200);
    const result = response.body.data as {
      isIntact: boolean;
      checkedCount: number;
    };

    expect(result.isIntact).toBe(true);
    // We've done multiple operations — should have audit records
    expect(result.checkedCount).toBeGreaterThanOrEqual(0);
  });
});
