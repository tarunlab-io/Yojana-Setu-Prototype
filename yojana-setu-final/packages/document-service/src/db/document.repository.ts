import { Pool } from 'pg';
import {
  type StoredDocument,
  type ValidationResult,
  DocumentType,
  DocumentStatus,
  UserNotFoundError,
} from '@yojana-setu/shared';
import { logger } from '../config/logger';
import { generateUUID } from '@yojana-setu/shared';

let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env['DATABASE_URL'],
      max: 10,
      ssl: process.env['NODE_ENV'] === 'production' ? { rejectUnauthorized: true } : false,
    });
    pool.on('error', (err) => logger.error('PG pool error', { error: err.message }));
  }
  return pool;
}

interface DocumentRow {
  document_id: string;
  user_id: string;
  document_type: string;
  storage_key: string;
  encrypted_key: string | null;
  status: string;
  validation_result: ValidationResult | null;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function rowToDocument(row: DocumentRow): StoredDocument {
  return {
    documentId: row.document_id,
    userId: row.user_id,
    documentType: row.document_type as DocumentType,
    storageKey: row.storage_key,
    status: row.status as DocumentStatus,
    validationResult: row.validation_result ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class DocumentRepository {
  async create(
    userId: string,
    documentType: DocumentType,
    storageKey: string,
    expiresAt?: Date,
  ): Promise<StoredDocument> {
    const documentId = generateUUID();
    const result = await getPool().query<DocumentRow>(
      `INSERT INTO documents
         (document_id, user_id, document_type, storage_key, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [documentId, userId, documentType, storageKey, DocumentStatus.PENDING, expiresAt ?? null],
    );
    return rowToDocument(result.rows[0]!);
  }

  async updateValidationResult(
    documentId: string,
    status: DocumentStatus,
    validationResult: ValidationResult,
    expiresAt?: Date,
  ): Promise<StoredDocument> {
    const result = await getPool().query<DocumentRow>(
      `UPDATE documents
       SET status = $2, validation_result = $3, expires_at = $4, updated_at = NOW()
       WHERE document_id = $1
       RETURNING *`,
      [documentId, status, JSON.stringify(validationResult), expiresAt ?? null],
    );
    if (result.rows.length === 0) {
      throw new Error(`Document not found: ${documentId}`);
    }
    return rowToDocument(result.rows[0]!);
  }

  async findById(documentId: string): Promise<StoredDocument | null> {
    const result = await getPool().query<DocumentRow>(
      'SELECT * FROM documents WHERE document_id = $1',
      [documentId],
    );
    if (result.rows.length === 0) return null;
    return rowToDocument(result.rows[0]!);
  }

  async findByUser(userId: string): Promise<StoredDocument[]> {
    const result = await getPool().query<DocumentRow>(
      'SELECT * FROM documents WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    );
    return result.rows.map(rowToDocument);
  }

  async findByUserAndType(
    userId: string,
    documentType: DocumentType,
  ): Promise<StoredDocument | null> {
    const result = await getPool().query<DocumentRow>(
      `SELECT * FROM documents
       WHERE user_id = $1 AND document_type = $2 AND status = 'valid'
       ORDER BY created_at DESC LIMIT 1`,
      [userId, documentType],
    );
    if (result.rows.length === 0) return null;
    return rowToDocument(result.rows[0]!);
  }

  async deleteByUser(userId: string): Promise<number> {
    const result = await getPool().query(
      'DELETE FROM documents WHERE user_id = $1',
      [userId],
    );
    logger.info('Documents deleted for user', { userId, count: result.rowCount });
    return result.rowCount ?? 0;
  }
}
