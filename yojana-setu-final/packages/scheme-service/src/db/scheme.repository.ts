import { Pool } from 'pg';
import {
  type GovernmentScheme,
  type SchemeUpdate,
  SchemeStatus,
  SchemeNotFoundError,
} from '@yojana-setu/shared';
import { cacheGet, cacheSet, cacheDelete, cacheDeletePattern, TTL } from '../config/cache';
import { logger } from '../config/logger';

// ─── DB Pool ──────────────────────────────────────────────────────────────────

let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env['DATABASE_URL'],
      max: 10,
      idleTimeoutMillis: 30_000,
      ssl: process.env['NODE_ENV'] === 'production' ? { rejectUnauthorized: true } : false,
    });
    pool.on('error', (err) => logger.error('PG pool error', { error: err.message }));
  }
  return pool;
}

// ─── Row → Domain ─────────────────────────────────────────────────────────────

interface SchemeRow {
  scheme_id: string;
  official_name: string;
  popular_name: string | null;
  short_description: string;
  full_description: string;
  simplified_explanation: string | null;
  category: string;
  level: string;
  state_code: string | null;
  ministry: string;
  status: string;
  eligibility_criteria: Record<string, unknown>;
  required_documents: Record<string, unknown>[];
  benefit_details: Record<string, unknown>;
  translations: Record<string, unknown>;
  application_deadline: Date | null;
  application_url: string | null;
  official_notification_url: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToScheme(row: SchemeRow): GovernmentScheme {
  return {
    schemeId: row.scheme_id,
    officialName: row.official_name,
    popularName: row.popular_name ?? undefined,
    shortDescription: row.short_description,
    fullDescription: row.full_description,
    simplifiedExplanation: row.simplified_explanation ?? undefined,
    category: row.category as GovernmentScheme['category'],
    level: row.level as 'central' | 'state',
    stateCode: row.state_code ?? undefined,
    ministry: row.ministry,
    status: row.status as SchemeStatus,
    eligibilityCriteria: row.eligibility_criteria as GovernmentScheme['eligibilityCriteria'],
    requiredDocuments: row.required_documents as GovernmentScheme['requiredDocuments'],
    benefitDetails: row.benefit_details as GovernmentScheme['benefitDetails'],
    translations: row.translations as GovernmentScheme['translations'],
    applicationDeadline: row.application_deadline ?? undefined,
    applicationUrl: row.application_url ?? undefined,
    officialNotificationUrl: row.official_notification_url ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Cache Keys ───────────────────────────────────────────────────────────────

const CACHE_KEY = {
  scheme: (id: string) => `scheme:${id}`,
  allActive: () => 'schemes:all_active',
  byCategory: (cat: string) => `schemes:category:${cat}`,
  byState: (state: string) => `schemes:state:${state}`,
};

// ─── Repository ───────────────────────────────────────────────────────────────

export class SchemeRepository {
  async findById(schemeId: string): Promise<GovernmentScheme | null> {
    const cached = await cacheGet<GovernmentScheme>(CACHE_KEY.scheme(schemeId));
    if (cached) return cached;

    const result = await getPool().query<SchemeRow>(
      'SELECT * FROM government_schemes WHERE scheme_id = $1',
      [schemeId],
    );
    if (result.rows.length === 0) return null;

    const scheme = rowToScheme(result.rows[0]!);
    await cacheSet(CACHE_KEY.scheme(schemeId), scheme, TTL.SCHEME);
    return scheme;
  }

  async findAllActive(): Promise<GovernmentScheme[]> {
    const cached = await cacheGet<GovernmentScheme[]>(CACHE_KEY.allActive());
    if (cached) return cached;

    const result = await getPool().query<SchemeRow>(
      `SELECT * FROM government_schemes
       WHERE status = 'active'
         AND (application_deadline IS NULL OR application_deadline > NOW())
       ORDER BY updated_at DESC`,
    );

    const schemes = result.rows.map(rowToScheme);
    await cacheSet(CACHE_KEY.allActive(), schemes, TTL.SCHEME);
    logger.debug('Loaded active schemes from DB', { count: schemes.length });
    return schemes;
  }

  async findByCategory(category: string): Promise<GovernmentScheme[]> {
    const cached = await cacheGet<GovernmentScheme[]>(CACHE_KEY.byCategory(category));
    if (cached) return cached;

    const result = await getPool().query<SchemeRow>(
      `SELECT * FROM government_schemes
       WHERE status = 'active' AND category = $1
         AND (application_deadline IS NULL OR application_deadline > NOW())
       ORDER BY updated_at DESC`,
      [category],
    );

    const schemes = result.rows.map(rowToScheme);
    await cacheSet(CACHE_KEY.byCategory(category), schemes, TTL.SCHEME);
    return schemes;
  }

  async findByState(stateCode: string): Promise<GovernmentScheme[]> {
    const cached = await cacheGet<GovernmentScheme[]>(CACHE_KEY.byState(stateCode));
    if (cached) return cached;

    const result = await getPool().query<SchemeRow>(
      `SELECT * FROM government_schemes
       WHERE status = 'active'
         AND (state_code IS NULL OR state_code = $1)
         AND (application_deadline IS NULL OR application_deadline > NOW())
       ORDER BY level DESC, updated_at DESC`,
      [stateCode],
    );

    const schemes = result.rows.map(rowToScheme);
    await cacheSet(CACHE_KEY.byState(stateCode), schemes, TTL.SCHEME);
    return schemes;
  }

  async search(query: string): Promise<GovernmentScheme[]> {
    // Full-text search using PostgreSQL's ILIKE — can be upgraded to pg_trgm later
    const result = await getPool().query<SchemeRow>(
      `SELECT * FROM government_schemes
       WHERE status = 'active'
         AND (
           official_name ILIKE $1
           OR popular_name ILIKE $1
           OR short_description ILIKE $1
           OR ministry ILIKE $1
         )
       LIMIT 20`,
      [`%${query}%`],
    );
    return result.rows.map(rowToScheme);
  }

  async markInactive(schemeId: string): Promise<void> {
    await getPool().query(
      `UPDATE government_schemes SET status = 'inactive', updated_at = NOW()
       WHERE scheme_id = $1`,
      [schemeId],
    );
    await cacheDelete(CACHE_KEY.scheme(schemeId));
    await cacheDeletePattern('schemes:*'); // invalidate all list caches
    logger.info('Scheme marked inactive', { schemeId });
  }

  async upsert(scheme: Omit<GovernmentScheme, 'schemeId' | 'createdAt' | 'updatedAt'>): Promise<GovernmentScheme> {
    const result = await getPool().query<SchemeRow>(
      `INSERT INTO government_schemes
         (official_name, popular_name, short_description, full_description,
          simplified_explanation, category, level, state_code, ministry, status,
          eligibility_criteria, required_documents, benefit_details, translations,
          application_deadline, application_url, official_notification_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (official_name, COALESCE(state_code, ''))
       DO UPDATE SET
         short_description = EXCLUDED.short_description,
         full_description = EXCLUDED.full_description,
         eligibility_criteria = EXCLUDED.eligibility_criteria,
         required_documents = EXCLUDED.required_documents,
         benefit_details = EXCLUDED.benefit_details,
         status = EXCLUDED.status,
         updated_at = NOW()
       RETURNING *`,
      [
        scheme.officialName,
        scheme.popularName ?? null,
        scheme.shortDescription,
        scheme.fullDescription,
        scheme.simplifiedExplanation ?? null,
        scheme.category,
        scheme.level,
        scheme.stateCode ?? null,
        scheme.ministry,
        scheme.status,
        JSON.stringify(scheme.eligibilityCriteria),
        JSON.stringify(scheme.requiredDocuments),
        JSON.stringify(scheme.benefitDetails),
        JSON.stringify(scheme.translations ?? {}),
        scheme.applicationDeadline ?? null,
        scheme.applicationUrl ?? null,
        scheme.officialNotificationUrl ?? null,
      ],
    );

    const saved = rowToScheme(result.rows[0]!);
    await cacheDelete(CACHE_KEY.scheme(saved.schemeId));
    await cacheDeletePattern('schemes:*');
    return saved;
  }

  async getRecentlyUpdated(sinceDate: Date): Promise<GovernmentScheme[]> {
    const result = await getPool().query<SchemeRow>(
      'SELECT * FROM government_schemes WHERE updated_at > $1 ORDER BY updated_at DESC',
      [sinceDate],
    );
    return result.rows.map(rowToScheme);
  }
}
