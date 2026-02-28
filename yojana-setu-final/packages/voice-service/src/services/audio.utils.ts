/**
 * Audio utilities for format detection, validation, and conversion.
 *
 * WhatsApp sends voice messages as OGG/Opus (audio/ogg; codecs=opus).
 * Bhashini ASR expects WAV (PCM 16-bit, 16kHz mono).
 *
 * Conversion strategy:
 *  - In production: use ffmpeg (must be installed in the container)
 *  - In development/testing: pass through if already WAV, otherwise flag
 *
 * Audio format detection uses magic bytes (file signatures).
 */

import { ValidationError } from '@yojana-setu/shared';
import { logger } from '../config/logger';

// ─── Audio Format Magic Bytes ─────────────────────────────────────────────────

const MAGIC_BYTES: Record<string, { signature: number[]; format: string }> = {
  wav:  { signature: [0x52, 0x49, 0x46, 0x46], format: 'wav'  }, // RIFF
  mp3:  { signature: [0xFF, 0xFB],              format: 'mp3'  }, // MP3 sync word
  ogg:  { signature: [0x4F, 0x67, 0x67, 0x53], format: 'ogg'  }, // OggS
  flac: { signature: [0x66, 0x4C, 0x61, 0x43], format: 'flac' }, // fLaC
  aac:  { signature: [0xFF, 0xF1],              format: 'aac'  }, // ADTS
};

export type AudioFormat = 'wav' | 'mp3' | 'ogg' | 'flac' | 'aac' | 'unknown';

/** Detects audio format from first bytes of the buffer */
export function detectAudioFormat(buffer: Buffer): AudioFormat {
  for (const [, { signature, format }] of Object.entries(MAGIC_BYTES)) {
    if (signature.every((byte, i) => buffer[i] === byte)) {
      return format as AudioFormat;
    }
  }
  return 'unknown';
}

// ─── Audio Quality Validation ─────────────────────────────────────────────────

export interface AudioQualityReport {
  isAcceptable: boolean;
  fileSizeBytes: number;
  estimatedDurationMs: number;
  format: AudioFormat;
  issues: string[];
}

const MIN_AUDIO_BYTES = 1_000;       // 1KB — too short to be speech
const MAX_AUDIO_BYTES = 10_000_000;  // 10MB — Bhashini size limit
const MIN_DURATION_MS = 500;         // 0.5s
const MAX_DURATION_MS = 120_000;     // 2 minutes

export function validateAudio(buffer: Buffer): AudioQualityReport {
  const issues: string[] = [];
  const format = detectAudioFormat(buffer);

  if (format === 'unknown') {
    issues.push('Unrecognised audio format. Please send a voice message or an audio file.');
  }

  if (buffer.length < MIN_AUDIO_BYTES) {
    issues.push('Audio is too short. Please record a longer message.');
  }

  if (buffer.length > MAX_AUDIO_BYTES) {
    issues.push('Audio file is too large (max 10MB). Please record a shorter message.');
  }

  // Rough duration estimate (varies by format/bitrate)
  const estimatedDurationMs = estimateDurationMs(buffer, format);

  if (estimatedDurationMs < MIN_DURATION_MS && buffer.length >= MIN_AUDIO_BYTES) {
    issues.push('Audio clip is too short. Please speak for at least half a second.');
  }

  if (estimatedDurationMs > MAX_DURATION_MS) {
    issues.push('Audio is too long (max 2 minutes). Please send a shorter message.');
  }

  return {
    isAcceptable: issues.length === 0,
    fileSizeBytes: buffer.length,
    estimatedDurationMs,
    format,
    issues,
  };
}

function estimateDurationMs(buffer: Buffer, format: AudioFormat): number {
  switch (format) {
    case 'wav': {
      // WAV: bytes 28-31 contain byte rate
      if (buffer.length < 44) return 0;
      const byteRate = buffer.readUInt32LE(28);
      if (byteRate === 0) return 0;
      return Math.round(((buffer.length - 44) / byteRate) * 1000);
    }
    case 'mp3':
      // Rough: ~128kbps
      return Math.round((buffer.length / (128 * 1024 / 8)) * 1000);
    case 'ogg':
      // Rough: ~64kbps (Opus in OGG)
      return Math.round((buffer.length / (64 * 1024 / 8)) * 1000);
    default:
      return Math.round((buffer.length / (64 * 1024 / 8)) * 1000);
  }
}

// ─── Format Conversion ────────────────────────────────────────────────────────

/**
 * Converts audio buffer to WAV format suitable for Bhashini ASR.
 *
 * Production: uses ffmpeg subprocess.
 * Development (no ffmpeg): returns the original buffer with a warning.
 *
 * @param inputBuffer - Audio data in any supported format
 * @param sourceFormat - Detected source format
 */
export async function convertToWav(
  inputBuffer: Buffer,
  sourceFormat: AudioFormat,
): Promise<Buffer> {
  if (sourceFormat === 'wav') return inputBuffer; // Already WAV, no conversion needed

  logger.debug('Audio format conversion requested', { from: sourceFormat, to: 'wav' });

  // Attempt ffmpeg conversion
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const { writeFile, readFile, unlink } = await import('fs/promises');

    const inputPath = join(tmpdir(), `yojana_audio_in_${Date.now()}.${sourceFormat}`);
    const outputPath = join(tmpdir(), `yojana_audio_out_${Date.now()}.wav`);

    try {
      await writeFile(inputPath, inputBuffer);

      // ffmpeg: convert to WAV PCM 16-bit 16kHz mono
      await execFileAsync('ffmpeg', [
        '-i', inputPath,
        '-ar', '16000',   // 16kHz sample rate (Bhashini requirement)
        '-ac', '1',       // mono
        '-sample_fmt', 's16',
        '-y',             // overwrite output
        outputPath,
      ]);

      const wavBuffer = await readFile(outputPath);
      logger.debug('Audio converted to WAV', { outputBytes: wavBuffer.length });
      return wavBuffer;
    } finally {
      // Cleanup temp files
      await unlink(inputPath).catch(() => {});
      await unlink(outputPath).catch(() => {});
    }
  } catch (err) {
    // ffmpeg not available — log and fall through
    if (err instanceof Error && err.message.includes('ENOENT')) {
      logger.warn('ffmpeg not found — passing audio unconverted. Install ffmpeg in production.');
      return inputBuffer;
    }
    throw new ValidationError(
      'Audio conversion failed. Please try recording again.',
      { error: err instanceof Error ? err.message : 'Unknown' },
    );
  }
}

// ─── Base64 Helpers ───────────────────────────────────────────────────────────

export function bufferToBase64(buffer: Buffer): string {
  return buffer.toString('base64');
}

export function base64ToBuffer(base64: string): Buffer {
  return Buffer.from(base64, 'base64');
}
