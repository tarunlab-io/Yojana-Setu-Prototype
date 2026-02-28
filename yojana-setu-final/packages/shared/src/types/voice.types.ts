import type { SupportedLanguage, UserIntent } from '../enums';

// ─── Voice Processing ─────────────────────────────────────────────────────────

export interface VoiceProcessingResult {
  transcribedText: string;
  /** 0–1 confidence score */
  confidence: number;
  detectedLanguage: SupportedLanguage;
  intent: UserIntent;
  /** Processing duration in milliseconds */
  processingTimeMs: number;
}

export interface LanguageDetectionResult {
  detectedLanguage: SupportedLanguage;
  confidence: number;
  alternativeLanguages: { language: SupportedLanguage; confidence: number }[];
}

export interface SpeechGenerationOptions {
  language: SupportedLanguage;
  /** Voice profile identifier from Bhashini */
  voiceProfile?: string;
  /** Speaking rate: 0.5–2.0, default 1.0 */
  speakingRate?: number;
  /** Pitch adjustment: -20 to +20 semitones */
  pitch?: number;
}

// ─── Bhashini API Types ───────────────────────────────────────────────────────

export interface BhashiniASRRequest {
  audioContent: string; // base64 encoded
  sourceLanguage: SupportedLanguage;
  audioFormat: 'wav' | 'mp3' | 'ogg' | 'flac';
  samplingRate?: number;
}

export interface BhashiniASRResponse {
  transcription: string;
  confidence: number;
  pipelineId: string;
}

export interface BhashiniTTSRequest {
  text: string;
  sourceLanguage: SupportedLanguage;
  gender: 'male' | 'female';
  samplingRate?: number;
}

export interface BhashiniTTSResponse {
  audioContent: string; // base64 encoded
  audioFormat: string;
  durationMs: number;
}

export interface BhashiniTranslationRequest {
  sourceLanguage: SupportedLanguage;
  targetLanguage: SupportedLanguage;
  text: string;
}

export interface BhashiniTranslationResponse {
  translatedText: string;
  sourceLanguage: SupportedLanguage;
  targetLanguage: SupportedLanguage;
}
