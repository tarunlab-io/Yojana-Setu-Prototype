/**
 * AWS Textract OCR Client
 *
 * Provides two operations:
 *  1. analyzeDocument() — extracts key-value pairs using FORMS analysis
 *  2. detectText()      — raw text extraction (used for quality assessment)
 *
 * Textract is used instead of Amazon Rekognition because it understands
 * document structure (forms, tables) which is essential for Indian ID cards.
 *
 * Fallback: Google Vision API (configured via OCR_PROVIDER=google_vision)
 */

import {
  TextractClient,
  AnalyzeDocumentCommand,
  DetectDocumentTextCommand,
  type Block,
  type AnalyzeDocumentCommandInput,
} from '@aws-sdk/client-textract';
import {
  type ExtractedData,
  type ExtractedField,
  type QualityAssessment,
  type QualityIssue,
  DocumentType,
  OCREngineError,
} from '@yojana-setu/shared';
import { DOCUMENT_SCHEMAS } from '../validation/document-schemas';
import { logger } from '../config/logger';

// ─── Client ───────────────────────────────────────────────────────────────────

let textractClient: TextractClient | null = null;

function getTextractClient(): TextractClient {
  if (!textractClient) {
    textractClient = new TextractClient({
      region: process.env['S3_REGION'] ?? 'ap-south-1',
      credentials: {
        accessKeyId: process.env['AWS_ACCESS_KEY_ID'] ?? '',
        secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'] ?? '',
      },
    });
  }
  return textractClient;
}

// ─── Quality Assessment (pre-OCR) ────────────────────────────────────────────

/**
 * Assesses image quality BEFORE running full OCR.
 * Uses DetectDocumentText (cheaper API call) to get a confidence signal.
 * Saves money by skipping AnalyzeDocument on low-quality images.
 */
export async function assessImageQuality(
  imageBuffer: Buffer,
  documentType: DocumentType,
): Promise<QualityAssessment> {
  const schema = DOCUMENT_SCHEMAS[documentType];
  const issues: QualityIssue[] = [];

  // File size check — too small likely means blurry/tiny image
  const fileSizeKb = imageBuffer.length / 1024;
  if (fileSizeKb < 20) {
    issues.push({
      issueType: 'low_resolution',
      severity: 'high',
      description: 'Image file is too small and may be too low resolution for OCR',
      userGuidance: 'Please take a clearer, closer photo of the document.',
    });
  }

  // Quick text detection to sample confidence
  let detectionConfidence = 1.0;
  try {
    const input: AnalyzeDocumentCommandInput = {
      Document: { Bytes: imageBuffer },
      FeatureTypes: [],
    };
    const command = new DetectDocumentTextCommand(input as Parameters<typeof DetectDocumentTextCommand>[0]);
    const response = await getTextractClient().send(command);

    const blocks = response.Blocks ?? [];
    const wordBlocks = blocks.filter((b: Block) => b.BlockType === 'WORD');

    if (wordBlocks.length === 0) {
      issues.push({
        issueType: 'blur',
        severity: 'high',
        description: 'No text could be detected in the image',
        userGuidance: schema.photoGuidance,
      });
      detectionConfidence = 0.1;
    } else {
      // Average confidence of detected words
      const confidences = wordBlocks
        .map((b: Block) => b.Confidence ?? 0)
        .filter((c: number) => c > 0);
      const avgConfidence = confidences.reduce((a: number, b: number) => a + b, 0) / confidences.length;
      detectionConfidence = avgConfidence / 100; // Textract returns 0–100

      if (detectionConfidence < 0.6) {
        issues.push({
          issueType: 'blur',
          severity: 'medium',
          description: `Text detection confidence is low (${Math.round(detectionConfidence * 100)}%)`,
          userGuidance: 'Try taking the photo in better lighting, keeping the camera steady.',
        });
      }

      if (wordBlocks.length < 3) {
        issues.push({
          issueType: 'partial',
          severity: 'medium',
          description: 'Very little text detected — the document may be partially visible',
          userGuidance: 'Ensure the entire document is within the camera frame.',
        });
      }
    }
  } catch (err) {
    logger.warn('Quick quality check failed', { error: err instanceof Error ? err.message : 'Unknown' });
    // Don't block — proceed to full OCR
    detectionConfidence = 0.7;
  }

  const overallScore = Math.max(0, detectionConfidence - issues.length * 0.15);
  const isAcceptable = overallScore >= schema.minQualityScore && issues.filter((i) => i.severity === 'high').length === 0;

  return {
    overallScore: Math.round(overallScore * 100) / 100,
    isAcceptable,
    issues,
    recommendations: issues.map((i) => i.userGuidance),
  };
}

// ─── Full OCR Extraction ──────────────────────────────────────────────────────

/**
 * Extracts structured data from a document image using Textract FORMS analysis.
 * Returns key-value pairs with per-field confidence scores.
 */
export async function extractDocumentData(
  imageBuffer: Buffer,
  documentType: DocumentType,
): Promise<ExtractedData> {
  const startTime = Date.now();

  try {
    const command = new AnalyzeDocumentCommand({
      Document: { Bytes: imageBuffer },
      FeatureTypes: ['FORMS', 'TABLES'],
    });

    const response = await getTextractClient().send(command);
    const blocks = response.Blocks ?? [];

    // Build key-value map from Textract FORMS output
    const keyValuePairs = extractKeyValuePairs(blocks);

    // Map Textract keys to our schema field names
    const schema = DOCUMENT_SCHEMAS[documentType];
    const extractedFields: ExtractedField[] = [];

    for (const schemaField of schema.fields) {
      const match = findBestMatch(keyValuePairs, schemaField.name, schemaField.label);
      if (match) {
        extractedFields.push({
          fieldName: schemaField.name,
          value: match.value,
          confidence: match.confidence,
        });
      }
    }

    // Also capture raw text for analysis
    const rawTextBlocks = blocks
      .filter((b: Block) => b.BlockType === 'LINE')
      .map((b: Block) => b.Text ?? '')
      .filter(Boolean);
    const rawText = rawTextBlocks.join('\n');

    // Overall extraction confidence
    const confidences = extractedFields.map((f) => f.confidence);
    const avgConfidence =
      confidences.length > 0
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : 0;

    logger.info('OCR extraction complete', {
      documentType,
      fieldsExtracted: extractedFields.length,
      avgConfidence: Math.round(avgConfidence * 100),
      elapsedMs: Date.now() - startTime,
    });

    return {
      documentType,
      fields: extractedFields,
      rawText,
      extractionConfidence: Math.round(avgConfidence * 1000) / 1000,
      extractedAt: new Date(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new OCREngineError(`Textract extraction failed: ${message}`);
  }
}

// ─── Textract Block Parsing Helpers ──────────────────────────────────────────

interface KVPair {
  key: string;
  value: string;
  confidence: number;
}

function extractKeyValuePairs(blocks: Block[]): KVPair[] {
  // Textract encodes key-value pairs via BLOCK relationships
  // KEY_VALUE_SET blocks with EntityType=KEY contain relationships to VALUE blocks
  const blockMap = new Map<string, Block>();
  for (const block of blocks) {
    if (block.Id) blockMap.set(block.Id, block);
  }

  const kvPairs: KVPair[] = [];

  for (const block of blocks) {
    if (block.BlockType === 'KEY_VALUE_SET' && block.EntityTypes?.includes('KEY')) {
      const keyText = getBlockText(block, blockMap);
      const valueBlock = findValueBlock(block, blockMap);
      const valueText = valueBlock ? getBlockText(valueBlock, blockMap) : '';

      if (keyText && valueText) {
        const confidence = ((block.Confidence ?? 0) + (valueBlock?.Confidence ?? 0)) / 200;
        kvPairs.push({ key: keyText.trim(), value: valueText.trim(), confidence });
      }
    }
  }

  return kvPairs;
}

function getBlockText(block: Block, blockMap: Map<string, Block>): string {
  if (block.BlockType === 'WORD') return block.Text ?? '';
  if (!block.Relationships) return block.Text ?? '';

  return block.Relationships
    .filter((r) => r.Type === 'CHILD')
    .flatMap((r) => r.Ids ?? [])
    .map((id) => blockMap.get(id))
    .filter((b): b is Block => b?.BlockType === 'WORD')
    .map((b) => b.Text ?? '')
    .join(' ');
}

function findValueBlock(keyBlock: Block, blockMap: Map<string, Block>): Block | null {
  const valueRelation = keyBlock.Relationships?.find((r) => r.Type === 'VALUE');
  if (!valueRelation?.Ids?.[0]) return null;
  return blockMap.get(valueRelation.Ids[0]) ?? null;
}

/**
 * Fuzzy-matches a schema field name/label against Textract-extracted keys.
 * Handles variations like "Aadhaar No" vs "Aadhaar Number" vs "AADHAAR NO."
 */
function findBestMatch(
  kvPairs: KVPair[],
  fieldName: string,
  fieldLabel: string,
): KVPair | null {
  const targets = [
    fieldName.toLowerCase(),
    fieldLabel.toLowerCase(),
    // Generate common label variants
    fieldLabel.toLowerCase().replace(/ /g, ''),
    fieldLabel.toLowerCase().replace(/number/g, 'no'),
    fieldLabel.toLowerCase().replace(/number/g, 'no.'),
  ];

  let best: KVPair | null = null;
  let bestScore = 0;

  for (const pair of kvPairs) {
    const pairKey = pair.key.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const target of targets) {
      const cleanTarget = target.replace(/[^a-z0-9]/g, '');
      if (pairKey.includes(cleanTarget) || cleanTarget.includes(pairKey)) {
        const score = Math.min(cleanTarget.length, pairKey.length) /
                      Math.max(cleanTarget.length, pairKey.length);
        if (score > bestScore && score > 0.6) {
          bestScore = score;
          best = pair;
        }
      }
    }
  }

  return best;
}
