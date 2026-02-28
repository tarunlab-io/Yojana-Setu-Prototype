/**
 * S3 Document Storage Client
 *
 * Handles encrypted document storage with:
 *  - Server-side encryption (SSE-S3)
 *  - Pre-signed URLs for temporary secure access
 *  - Automatic lifecycle policies (documents deleted after 90 days — Req 9.5)
 *  - User-scoped key prefixes for data isolation
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DocumentType, OCREngineError } from '@yojana-setu/shared';
import { logger } from '../config/logger';
import { createHash } from 'crypto';

// ─── Client ───────────────────────────────────────────────────────────────────

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env['S3_REGION'] ?? 'ap-south-1',
      credentials: {
        accessKeyId: process.env['AWS_ACCESS_KEY_ID'] ?? '',
        secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'] ?? '',
      },
    });
  }
  return s3Client;
}

const BUCKET = process.env['S3_BUCKET_NAME'] ?? 'yojana-setu-documents';
const PRESIGNED_URL_TTL_SECONDS = 60 * 15; // 15 minutes — short-lived for security
const DOCUMENT_RETENTION_DAYS = 90;        // Req 9.5 — automatic deletion via S3 lifecycle

// ─── Key Generation ───────────────────────────────────────────────────────────

/**
 * Generates a user-scoped S3 key.
 * Format: documents/{userId}/{documentType}/{hash}.{ext}
 *
 * Using a content hash ensures:
 *  - Duplicate uploads don't create new objects
 *  - Keys are not guessable (no sequential IDs)
 */
export function generateStorageKey(
  userId: string,
  documentType: DocumentType,
  imageBuffer: Buffer,
  originalFilename: string,
): string {
  const hash = createHash('sha256').update(imageBuffer).digest('hex').slice(0, 16);
  const ext = originalFilename.split('.').pop()?.toLowerCase() ?? 'jpg';
  return `documents/${userId}/${documentType}/${hash}.${ext}`;
}

// ─── Upload ───────────────────────────────────────────────────────────────────

export interface UploadResult {
  storageKey: string;
  eTag: string;
  fileSizeBytes: number;
}

export async function uploadDocument(
  userId: string,
  documentType: DocumentType,
  imageBuffer: Buffer,
  originalFilename: string,
  mimeType: string,
): Promise<UploadResult> {
  const storageKey = generateStorageKey(userId, documentType, imageBuffer, originalFilename);

  const input: PutObjectCommandInput = {
    Bucket: BUCKET,
    Key: storageKey,
    Body: imageBuffer,
    ContentType: mimeType,
    ServerSideEncryption: 'AES256',
    // Tag for lifecycle policy — auto-delete after DOCUMENT_RETENTION_DAYS
    Tagging: `retention=${DOCUMENT_RETENTION_DAYS}days&userId=${userId}&documentType=${documentType}`,
    Metadata: {
      userId,
      documentType,
      originalFilename,
      uploadedAt: new Date().toISOString(),
    },
  };

  try {
    const response = await getS3Client().send(new PutObjectCommand(input));
    logger.info('Document uploaded to S3', { storageKey, fileSizeBytes: imageBuffer.length });

    return {
      storageKey,
      eTag: response.ETag ?? '',
      fileSizeBytes: imageBuffer.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new OCREngineError(`S3 upload failed: ${message}`);
  }
}

// ─── Download ─────────────────────────────────────────────────────────────────

export async function downloadDocument(storageKey: string): Promise<Buffer> {
  try {
    const response = await getS3Client().send(
      new GetObjectCommand({ Bucket: BUCKET, Key: storageKey }),
    );
    const body = response.Body;
    if (!body) throw new OCREngineError('S3 returned empty body');

    const chunks: Uint8Array[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new OCREngineError(`S3 download failed: ${message}`);
  }
}

// ─── Pre-signed URL (for temporary secure access) ─────────────────────────────

export async function getPresignedUrl(storageKey: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: storageKey });
  return getSignedUrl(getS3Client(), command, { expiresIn: PRESIGNED_URL_TTL_SECONDS });
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteDocument(storageKey: string): Promise<void> {
  try {
    await getS3Client().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: storageKey }));
    logger.info('Document deleted from S3', { storageKey });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new OCREngineError(`S3 delete failed: ${message}`);
  }
}
