/**
 * Bhashini API Client
 *
 * Integrates with Bhashini's Dhruva API for:
 *  - ASR  (Automatic Speech Recognition) — voice → text
 *  - TTS  (Text-to-Speech)               — text  → voice
 *  - NMT  (Neural Machine Translation)   — text  → text (cross-language)
 *
 * API Docs: https://bhashini.gitbook.io/bhashini-apis
 *
 * Architecture:
 *  1. Call ULCA pipeline search to find the best pipeline for the task/language pair
 *  2. Cache pipeline IDs (they're stable — no need to look up on every request)
 *  3. Call the Dhruva inference endpoint with the pipeline ID
 *  4. Retry up to 3x with exponential backoff on transient errors
 */

import {
  type SupportedLanguage,
  type BhashiniASRRequest,
  type BhashiniASRResponse,
  type BhashiniTTSRequest,
  type BhashiniTTSResponse,
  type BhashiniTranslationRequest,
  type BhashiniTranslationResponse,
  BhashiniAPIError,
} from '@yojana-setu/shared';
import { logger } from '../config/logger';

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE_URL = process.env['BHASHINI_BASE_URL'] ?? 'https://dhruva-api.bhashini.gov.in';
const ULCA_URL = 'https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline';
const API_KEY = process.env['BHASHINI_API_KEY'] ?? '';
const USER_ID = process.env['BHASHINI_USER_ID'] ?? '';

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 500;

// ─── Pipeline Cache (in-memory, stable across requests) ──────────────────────

interface PipelineConfig {
  pipelineId: string;
  serviceId: string;
  callbackUrl: string;
}

const pipelineCache = new Map<string, PipelineConfig>();

function pipelineCacheKey(task: string, sourceLanguage: string, targetLanguage?: string): string {
  return `${task}:${sourceLanguage}${targetLanguage ? `:${targetLanguage}` : ''}`;
}

// ─── HTTP Helper with Retry ───────────────────────────────────────────────────

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);

      // 5xx = transient, retry. 4xx = client error, throw immediately.
      if (response.status >= 500 && attempt < retries) {
        logger.warn('Bhashini API transient error, retrying', {
          status: response.status,
          attempt,
          url,
        });
        await sleep(BASE_RETRY_DELAY_MS * Math.pow(2, attempt));
        continue;
      }

      return response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) {
        logger.warn('Bhashini API network error, retrying', {
          error: lastError.message,
          attempt,
        });
        await sleep(BASE_RETRY_DELAY_MS * Math.pow(2, attempt));
      }
    }
  }

  throw new BhashiniAPIError(
    `Failed after ${MAX_RETRIES} retries: ${lastError?.message ?? 'Unknown error'}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Pipeline Discovery ───────────────────────────────────────────────────────

type BhashiniTask = 'asr' | 'tts' | 'translation';

async function getPipeline(
  task: BhashiniTask,
  sourceLanguage: SupportedLanguage,
  targetLanguage?: SupportedLanguage,
): Promise<PipelineConfig> {
  const cacheKey = pipelineCacheKey(task, sourceLanguage, targetLanguage);
  const cached = pipelineCache.get(cacheKey);
  if (cached) return cached;

  const pipelineSearchBody = {
    pipelineTasks: [
      {
        taskType: task === 'asr' ? 'asr' : task === 'tts' ? 'tts' : 'translation',
        config: {
          language: {
            sourceLanguage,
            ...(targetLanguage ? { targetLanguage } : {}),
          },
        },
      },
    ],
    pipelineRequestConfig: {
      pipelineId: '64392f96daac500b55c543cd', // Default Bhashini pipeline
    },
  };

  const response = await fetchWithRetry(ULCA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      userID: USER_ID,
      ulcaApiKey: API_KEY,
    },
    body: JSON.stringify(pipelineSearchBody),
  });

  if (!response.ok) {
    throw new BhashiniAPIError(`Pipeline search failed: ${response.status}`, {
      task,
      sourceLanguage,
      targetLanguage,
    });
  }

  const data = (await response.json()) as {
    pipelineResponseConfig: Array<{
      config: Array<{
        serviceId: string;
        callbackUrl?: string;
      }>;
    }>;
    pipelineInferenceAPIEndPoint?: {
      callbackUrl?: string;
      inferenceApiKey?: { name: string; value: string };
    };
  };

  const config = data.pipelineResponseConfig?.[0]?.config?.[0];
  if (!config) {
    throw new BhashiniAPIError('No pipeline found for task/language combination', {
      task,
      sourceLanguage,
      targetLanguage,
    });
  }

  const pipeline: PipelineConfig = {
    pipelineId: '64392f96daac500b55c543cd',
    serviceId: config.serviceId,
    callbackUrl:
      data.pipelineInferenceAPIEndPoint?.callbackUrl ??
      `${BASE_URL}/services/inference/pipeline`,
  };

  pipelineCache.set(cacheKey, pipeline);
  logger.debug('Bhashini pipeline resolved', { task, sourceLanguage, targetLanguage, pipeline });
  return pipeline;
}

// ─── ASR — Speech to Text ─────────────────────────────────────────────────────

export async function transcribeAudio(request: BhashiniASRRequest): Promise<BhashiniASRResponse> {
  const pipeline = await getPipeline('asr', request.sourceLanguage);
  const startTime = Date.now();

  const body = {
    pipelineTasks: [
      {
        taskType: 'asr',
        config: {
          serviceId: pipeline.serviceId,
          language: { sourceLanguage: request.sourceLanguage },
          audioFormat: request.audioFormat,
          samplingRate: request.samplingRate ?? 16000,
          preProcessors: ['vad'], // Voice Activity Detection
          postProcessors: ['punctuation'],
        },
      },
    ],
    inputData: {
      audio: [{ audioContent: request.audioContent }],
    },
  };

  const response = await fetchWithRetry(pipeline.callbackUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new BhashiniAPIError(`ASR failed: ${response.status}`, { errorText });
  }

  const data = (await response.json()) as {
    pipelineResponse: Array<{
      output: Array<{ source: string }>;
      taskType: string;
    }>;
  };

  const output = data.pipelineResponse?.[0]?.output?.[0];
  if (!output?.source) {
    throw new BhashiniAPIError('ASR returned empty transcription');
  }

  const elapsedMs = Date.now() - startTime;
  logger.info('ASR completed', {
    language: request.sourceLanguage,
    transcriptionLength: output.source.length,
    elapsedMs,
  });

  // Bhashini does not return a confidence score directly — estimate from response quality
  const confidence = output.source.length > 3 ? 0.87 : 0.5;

  return {
    transcription: output.source,
    confidence,
    pipelineId: pipeline.pipelineId,
  };
}

// ─── TTS — Text to Speech ─────────────────────────────────────────────────────

export async function synthesizeSpeech(request: BhashiniTTSRequest): Promise<BhashiniTTSResponse> {
  const pipeline = await getPipeline('tts', request.sourceLanguage);
  const startTime = Date.now();

  const body = {
    pipelineTasks: [
      {
        taskType: 'tts',
        config: {
          serviceId: pipeline.serviceId,
          language: { sourceLanguage: request.sourceLanguage },
          gender: request.gender,
          samplingRate: request.samplingRate ?? 8000,
        },
      },
    ],
    inputData: {
      input: [{ source: request.text }],
    },
  };

  const response = await fetchWithRetry(pipeline.callbackUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new BhashiniAPIError(`TTS failed: ${response.status}`, { errorText });
  }

  const data = (await response.json()) as {
    pipelineResponse: Array<{
      audio: Array<{ audioContent: string }>;
      config?: { samplingRate?: number; encoding?: string };
    }>;
  };

  const audioContent = data.pipelineResponse?.[0]?.audio?.[0]?.audioContent;
  if (!audioContent) {
    throw new BhashiniAPIError('TTS returned empty audio');
  }

  const elapsedMs = Date.now() - startTime;
  logger.info('TTS completed', {
    language: request.sourceLanguage,
    textLength: request.text.length,
    elapsedMs,
  });

  // Estimate duration from base64 size (approximate)
  const audioBytes = Buffer.from(audioContent, 'base64').length;
  const samplingRate = request.samplingRate ?? 8000;
  const durationMs = Math.round((audioBytes / (samplingRate * 2)) * 1000);

  return {
    audioContent,
    audioFormat: 'wav',
    durationMs,
  };
}

// ─── NMT — Neural Machine Translation ────────────────────────────────────────

export async function translateText(
  request: BhashiniTranslationRequest,
): Promise<BhashiniTranslationResponse> {
  // No-op for same language
  if (request.sourceLanguage === request.targetLanguage) {
    return {
      translatedText: request.text,
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
    };
  }

  const pipeline = await getPipeline('translation', request.sourceLanguage, request.targetLanguage);
  const startTime = Date.now();

  const body = {
    pipelineTasks: [
      {
        taskType: 'translation',
        config: {
          serviceId: pipeline.serviceId,
          language: {
            sourceLanguage: request.sourceLanguage,
            targetLanguage: request.targetLanguage,
          },
        },
      },
    ],
    inputData: {
      input: [{ source: request.text }],
    },
  };

  const response = await fetchWithRetry(pipeline.callbackUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new BhashiniAPIError(`Translation failed: ${response.status}`, { errorText });
  }

  const data = (await response.json()) as {
    pipelineResponse: Array<{
      output: Array<{ target: string }>;
    }>;
  };

  const output = data.pipelineResponse?.[0]?.output?.[0];
  if (!output?.target) {
    throw new BhashiniAPIError('Translation returned empty result');
  }

  const elapsedMs = Date.now() - startTime;
  logger.info('Translation completed', {
    from: request.sourceLanguage,
    to: request.targetLanguage,
    inputLength: request.text.length,
    elapsedMs,
  });

  return {
    translatedText: output.target,
    sourceLanguage: request.sourceLanguage,
    targetLanguage: request.targetLanguage,
  };
}

// ─── Language Detection ───────────────────────────────────────────────────────

/**
 * Detects the language of an audio buffer.
 * Bhashini does not have a dedicated language ID endpoint, so we use a heuristic:
 * try ASR with the most common Indian languages and pick the highest-confidence result.
 *
 * In production, consider using a separate LID (Language Identification) model.
 */
export async function detectAudioLanguage(
  audioContent: string,
  audioFormat: 'wav' | 'mp3' | 'ogg',
  candidateLanguages: SupportedLanguage[],
): Promise<{ detectedLanguage: SupportedLanguage; confidence: number }> {
  // For now use Hindi as default — in production replace with a real LID call
  const defaultLanguage = candidateLanguages[0] ?? ('hi' as SupportedLanguage);

  // If only one candidate, return immediately
  if (candidateLanguages.length === 1) {
    return { detectedLanguage: defaultLanguage, confidence: 0.9 };
  }

  // Try the two most likely languages and pick whichever gives longer transcription
  const topTwo = candidateLanguages.slice(0, 2);
  const results = await Promise.allSettled(
    topTwo.map((lang) =>
      transcribeAudio({ audioContent, sourceLanguage: lang, audioFormat }),
    ),
  );

  let bestLang = defaultLanguage;
  let bestLength = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result?.status === 'fulfilled' && result.value.transcription.length > bestLength) {
      bestLength = result.value.transcription.length;
      bestLang = topTwo[i]!;
    }
  }

  return { detectedLanguage: bestLang, confidence: bestLength > 5 ? 0.82 : 0.6 };
}
