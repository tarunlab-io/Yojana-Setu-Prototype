import {
  type IVoiceService,
  type VoiceProcessingResult,
  type LanguageDetectionResult,
  type SpeechGenerationOptions,
  type BhashiniTranslationRequest,
  type BhashiniTranslationResponse,
  type SupportedLanguage,
  BhashiniAPIError,
} from '@yojana-setu/shared';
import {
  transcribeAudio,
  synthesizeSpeech,
  translateText,
  detectAudioLanguage,
} from '../clients/bhashini.client';
import {
  detectIntentFromText,
  detectAudioFormat,
  normalizeTranscribedText,
} from './intent-detector';
import {
  cacheGet,
  cacheSet,
  TTL,
  translationKey,
  ttsKey,
} from '../config/cache';
import { logger } from '../config/logger';

// ─── Supported Languages Ordered by Prevalence ───────────────────────────────
// Used for language detection candidate list

const DETECTION_CANDIDATES: SupportedLanguage[] = [
  'hi', 'ta', 'te', 'mr', 'bn', 'gu', 'kn', 'ml', 'pa', 'ur',
] as SupportedLanguage[];

// ─── Voice Service ────────────────────────────────────────────────────────────

export class VoiceService implements IVoiceService {

  // ─── Process Voice Input ─────────────────────────────────────────────────
  // Requirement 1.1, 1.2: ASR + intent detection from audio

  async processVoiceInput(
    audioData: Buffer,
    language?: SupportedLanguage,
  ): Promise<VoiceProcessingResult> {
    const startTime = Date.now();

    // Step 1: Detect format from magic bytes
    const audioFormat = detectAudioFormat(audioData);

    // Step 2: Determine language — use provided or detect
    let detectedLanguage = language;
    let langConfidence = 1.0;

    if (!detectedLanguage) {
      const detection = await detectAudioLanguage(
        audioData.toString('base64'),
        audioFormat,
        DETECTION_CANDIDATES,
      );
      detectedLanguage = detection.detectedLanguage;
      langConfidence = detection.confidence;
    }

    // Step 3: Transcribe via Bhashini ASR
    const asrResult = await transcribeAudio({
      audioContent: audioData.toString('base64'),
      sourceLanguage: detectedLanguage,
      audioFormat,
    });

    // Step 4: Normalize transcription
    const normalizedText = normalizeTranscribedText(
      asrResult.transcription,
      detectedLanguage,
    );

    // Step 5: Detect intent from text
    const intentMatch = detectIntentFromText(normalizedText, detectedLanguage);

    const processingTimeMs = Date.now() - startTime;

    // Log if confidence below 85% threshold (Req 1.2)
    const overallConfidence = Math.min(asrResult.confidence, langConfidence);
    if (overallConfidence < 0.85) {
      logger.warn('Voice processing confidence below threshold', {
        language: detectedLanguage,
        asrConfidence: asrResult.confidence,
        langConfidence,
        processingTimeMs,
      });
    }

    logger.info('Voice input processed', {
      language: detectedLanguage,
      confidence: overallConfidence,
      intent: intentMatch.intent,
      processingTimeMs,
    });

    return {
      transcribedText: normalizedText,
      confidence: overallConfidence,
      detectedLanguage,
      intent: intentMatch.intent,
      processingTimeMs,
    };
  }

  // ─── Generate Speech Response ─────────────────────────────────────────────
  // Requirement 3.5: Convert text response to audio

  async generateSpeechResponse(
    text: string,
    options: SpeechGenerationOptions,
  ): Promise<Buffer> {
    const gender = 'female'; // Default voice profile

    // Check cache first — TTS is expensive
    const cKey = ttsKey(text, options.language, gender);
    const cached = await cacheGet<string>(cKey);
    if (cached) {
      logger.debug('TTS served from cache');
      return Buffer.from(cached, 'base64');
    }

    // Truncate long text to avoid TTS timeout (WhatsApp voice note limit ~5 min)
    const MAX_TTS_CHARS = 500;
    const textToSpeak = text.length > MAX_TTS_CHARS
      ? `${text.slice(0, MAX_TTS_CHARS)}...`
      : text;

    const ttsResult = await synthesizeSpeech({
      text: textToSpeak,
      sourceLanguage: options.language,
      gender,
      samplingRate: 16000,
    });

    await cacheSet(cKey, ttsResult.audioContent, TTL.TTS);

    return Buffer.from(ttsResult.audioContent, 'base64');
  }

  // ─── Detect Language ──────────────────────────────────────────────────────

  async detectLanguage(audioData: Buffer): Promise<LanguageDetectionResult> {
    const audioFormat = detectAudioFormat(audioData);
    const result = await detectAudioLanguage(
      audioData.toString('base64'),
      audioFormat,
      DETECTION_CANDIDATES,
    );

    return {
      detectedLanguage: result.detectedLanguage,
      confidence: result.confidence,
      alternativeLanguages: DETECTION_CANDIDATES
        .filter((l) => l !== result.detectedLanguage)
        .slice(0, 3)
        .map((l) => ({ language: l, confidence: 0.1 })),
    };
  }

  // ─── Translate ────────────────────────────────────────────────────────────
  // Requirement 7.2, 7.4: Context-aware translation with caching

  async translate(request: BhashiniTranslationRequest): Promise<BhashiniTranslationResponse> {
    // Cache translations — same phrase in same lang pair is deterministic
    const cKey = translationKey(request.text, request.sourceLanguage, request.targetLanguage);
    const cached = await cacheGet<BhashiniTranslationResponse>(cKey);
    if (cached) return cached;

    const result = await translateText(request);
    await cacheSet(cKey, result, TTL.TRANSLATION);
    return result;
  }

  // ─── Normalize Text ───────────────────────────────────────────────────────

  async normalizeText(text: string, language: SupportedLanguage): Promise<string> {
    return normalizeTranscribedText(text, language);
  }
}
