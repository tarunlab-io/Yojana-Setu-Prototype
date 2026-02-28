import { Pool } from 'pg';
import {
  type ApplicationFull as Application,
  type ApplicationEvent,
  ApplicationStatus,
  generateUUID,
} from '@yojana-setu/shared';
import { logger } from '../config/logger';

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

// ─── Row Types ────────────────────────────────────────────────────────────────

interface ApplicationRow {
  application_id: string;
  user_id: string;
  scheme_id: string;
  reference_number: string;
  status: string;
  submitted_at: Date | null;
  last_status_change_at: Date;
  document_ids: string[];
  form_data: Record<string, unknown>;
  government_reference: string | null;
  rejection_reason: string | null;
  disbursement_amount_inr: number | null;
  disbursement_date: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface EventRow {
  event_id: string;
  application_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string;
  triggered_by: string;
  note: string | null;
  occurred_at: Date;
}

function rowToApplication(row: ApplicationRow): Application {
  return {
    applicationId: row.application_id,
    userId: row.user_id,
    schemeId: row.scheme_id,
    referenceNumber: row.reference_number,
    status: row.status as ApplicationStatus,
    submittedAt: row.submitted_at ?? undefined,
    lastStatusChangeAt: row.last_status_change_at,
    documentIds: row.document_ids ?? [],
    formData: row.form_data ?? {},
    governmentReference: row.government_reference ?? undefined,
    rejectionReason: row.rejection_reason ?? undefined,
    disbursementAmountINR: row.disbursement_amount_inr ?? undefined,
    disbursementDate: row.disbursement_date ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEvent(row: EventRow): ApplicationEvent {
  return {
    eventId: row.event_id,
    applicationId: row.application_id,
    eventType: row.event_type as ApplicationEvent['eventType'],
    fromStatus: row.from_status as ApplicationStatus | null,
    toStatus: row.to_status as ApplicationStatus,
    triggeredBy: row.triggered_by as 'user' | 'system' | 'government',
    note: row.note,
    occurredAt: row.occurred_at,
  };
}

// ─── Repository ───────────────────────────────────────────────────────────────

export class ApplicationRepository {
  async create(data: {
    userId: string;
    schemeId: string;
    referenceNumber: string;
    documentIds: string[];
    formData: Record<string, unknown>;
  }): Promise<Application> {
    const result = await getPool().query<ApplicationRow>(
      `INSERT INTO applications
         (application_id, user_id, scheme_id, reference_number, status,
          document_ids, form_data, last_status_change_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING *`,
      [
        generateUUID(),
        data.userId,
        data.schemeId,
        data.referenceNumber,
        ApplicationStatus.DRAFT,
        JSON.stringify(data.documentIds),
        JSON.stringify(data.formData),
      ],
    );
    return rowToApplication(result.rows[0]!);
  }

  async findById(applicationId: string): Promise<Application | null> {
    const result = await getPool().query<ApplicationRow>(
      'SELECT * FROM applications WHERE application_id = $1',
      [applicationId],
    );
    return result.rows[0] ? rowToApplication(result.rows[0]) : null;
  }

  async findByReferenceNumber(referenceNumber: string): Promise<Application | null> {
    const result = await getPool().query<ApplicationRow>(
      'SELECT * FROM applications WHERE reference_number = $1',
      [referenceNumber],
    );
    return result.rows[0] ? rowToApplication(result.rows[0]) : null;
  }

  async findAllByUser(userId: string): Promise<Application[]> {
    const result = await getPool().query<ApplicationRow>(
      `SELECT * FROM applications WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    );
    return result.rows.map(rowToApplication);
  }

  async updateStatus(
    applicationId: string,
    newStatus: ApplicationStatus,
    extra: {
      rejectionReason?: string;
      governmentReference?: string;
      disbursementAmountINR?: number;
      disbursementDate?: Date;
      submittedAt?: Date;
    } = {},
  ): Promise<Application> {
    const result = await getPool().query<ApplicationRow>(
      `UPDATE applications SET
         status = $2,
         last_status_change_at = NOW(),
         rejection_reason = COALESCE($3, rejection_reason),
         government_reference = COALESCE($4, government_reference),
         disbursement_amount_inr = COALESCE($5, disbursement_amount_inr),
         disbursement_date = COALESCE($6, disbursement_date),
         submitted_at = COALESCE($7, submitted_at),
         updated_at = NOW()
       WHERE application_id = $1
       RETURNING *`,
      [
        applicationId,
        newStatus,
        extra.rejectionReason ?? null,
        extra.governmentReference ?? null,
        extra.disbursementAmountINR ?? null,
        extra.disbursementDate ?? null,
        extra.submittedAt ?? null,
      ],
    );
    return rowToApplication(result.rows[0]!);
  }

  async addDocuments(applicationId: string, documentIds: string[]): Promise<Application> {
    const result = await getPool().query<ApplicationRow>(
      `UPDATE applications SET
         document_ids = document_ids || $2::text[],
         updated_at = NOW()
       WHERE application_id = $1
       RETURNING *`,
      [applicationId, JSON.stringify(documentIds)],
    );
    return rowToApplication(result.rows[0]!);
  }

  async appendEvent(event: ApplicationEvent): Promise<void> {
    await getPool().query(
      `INSERT INTO application_events
         (event_id, application_id, event_type, from_status, to_status,
          triggered_by, note, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        event.eventId,
        event.applicationId,
        event.eventType,
        event.fromStatus ?? null,
        event.toStatus,
        event.triggeredBy,
        event.note ?? null,
        event.occurredAt,
      ],
    );
  }

  async getEventHistory(applicationId: string): Promise<ApplicationEvent[]> {
    const result = await getPool().query<EventRow>(
      `SELECT * FROM application_events
       WHERE application_id = $1
       ORDER BY occurred_at ASC`,
      [applicationId],
    );
    return result.rows.map(rowToEvent);
  }

  async getNextSequenceNumber(): Promise<number> {
    const result = await getPool().query<{ nextval: string }>(
      `SELECT nextval('application_sequence')`,
    );
    return parseInt(result.rows[0]!.nextval, 10);
  }

  async countByUserAndScheme(userId: string, schemeId: string): Promise<number> {
    const result = await getPool().query<{ count: string }>(
      `SELECT COUNT(*) FROM applications
       WHERE user_id = $1 AND scheme_id = $2
         AND status NOT IN ('withdrawn', 'rejected')`,
      [userId, schemeId],
    );
    return parseInt(result.rows[0]!.count, 10);
  }

  async getOverdueApplications(): Promise<Application[]> {
    // Applications stuck in UNDER_REVIEW for more than 20 business days
    const result = await getPool().query<ApplicationRow>(
      `SELECT * FROM applications
       WHERE status = 'under_review'
         AND last_status_change_at < NOW() - INTERVAL '28 days'`,
    );
    return result.rows.map(rowToApplication);
  }
}
