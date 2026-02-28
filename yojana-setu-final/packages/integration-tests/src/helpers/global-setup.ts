// global-setup.ts — runs once before the full integration test suite
import { waitForServices, TEST_ENV } from './test-helpers';

const ALL_SERVICES = [
  { name: 'profile-service',     url: TEST_ENV.PROFILE_SERVICE },
  { name: 'scheme-service',      url: TEST_ENV.SCHEME_SERVICE },
  { name: 'document-service',    url: TEST_ENV.DOCUMENT_SERVICE },
  { name: 'application-service', url: TEST_ENV.APPLICATION_SERVICE },
  { name: 'privacy-service',     url: TEST_ENV.PRIVACY_SERVICE },
];

export default async function globalSetup(): Promise<void> {
  console.log('\n🔍 Waiting for all services to be healthy...');
  try {
    await waitForServices(ALL_SERVICES, 120_000);
    console.log('✅ All services healthy — starting integration tests\n');
  } catch (err) {
    console.error('❌ Services not ready:', err instanceof Error ? err.message : err);
    throw err;
  }
}
