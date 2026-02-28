// global-teardown.ts — runs once after the full integration test suite
import { cleanupAllTestData, closeTestDb } from './test-helpers';

export default async function globalTeardown(): Promise<void> {
  console.log('\n🧹 Cleaning up integration test data...');
  try {
    await cleanupAllTestData();
    console.log('✅ Test data cleaned');
  } catch (err) {
    console.warn('⚠️  Cleanup failed (non-fatal):', err instanceof Error ? err.message : err);
  } finally {
    await closeTestDb();
  }
}
