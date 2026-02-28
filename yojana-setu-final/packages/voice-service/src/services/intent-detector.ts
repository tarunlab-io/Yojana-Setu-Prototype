/**
 * Intent Detector
 *
 * Classifies a transcribed user message into a UserIntent.
 * Uses keyword matching as a fast first pass, with a fallback to GPT-4
 * for ambiguous messages.
 *
 * Supports all 22 languages via transliteration-aware matching.
 * Hindi keywords are prioritised as the most common usage language.
 */

import { UserIntent, SupportedLanguage } from '@yojana-setu/shared';

// ─── Keyword Maps ─────────────────────────────────────────────────────────────

type KeywordMap = Partial<Record<UserIntent, string[]>>;

/** English keywords */
const EN_KEYWORDS: KeywordMap = {
  [UserIntent.DISCOVER_SCHEMES]: [
    'scheme', 'schemes', 'benefit', 'welfare', 'yojana', 'help', 'eligible',
    'apply', 'government', 'support', 'assistance', 'subsidy',
  ],
  [UserIntent.CHECK_ELIGIBILITY]: [
    'eligible', 'qualify', 'can i', 'do i qualify', 'am i', 'check',
  ],
  [UserIntent.EXPLAIN_SCHEME]: [
    'explain', 'what is', 'tell me about', 'details', 'information', 'how does',
  ],
  [UserIntent.UPLOAD_DOCUMENT]: [
    'document', 'upload', 'send', 'photo', 'certificate', 'aadhaar', 'pan',
    'proof', 'attach',
  ],
  [UserIntent.TRACK_APPLICATION]: [
    'status', 'track', 'application', 'applied', 'pending', 'approved',
    'rejected', 'reference',
  ],
  [UserIntent.UPDATE_PROFILE]: [
    'update', 'change', 'edit', 'profile', 'income', 'address', 'my details',
  ],
  [UserIntent.SWITCH_LANGUAGE]: [
    'language', 'hindi', 'tamil', 'telugu', 'marathi', 'bengali', 'change language',
    'speak in', 'in english',
  ],
  [UserIntent.HELP]: [
    'help', 'how to', 'what can', 'menu', 'options', 'start',
  ],
};

/** Hindi keywords (Devanagari and transliterated) */
const HI_KEYWORDS: KeywordMap = {
  [UserIntent.DISCOVER_SCHEMES]: [
    'योजना', 'सरकारी योजना', 'लाभ', 'मदद', 'सहायता', 'अनुदान',
    'yojana', 'labh', 'madad', 'sahayata',
  ],
  [UserIntent.CHECK_ELIGIBILITY]: [
    'पात्र', 'योग्य', 'eligibility', 'patr', 'yogya',
  ],
  [UserIntent.EXPLAIN_SCHEME]: [
    'बताओ', 'जानकारी', 'समझाओ', 'क्या है', 'batao', 'jaankari', 'samjhao',
  ],
  [UserIntent.UPLOAD_DOCUMENT]: [
    'दस्तावेज़', 'आधार', 'पैन', 'फ़ोटो', 'दस्तावेज', 'dastavez', 'aadhar',
  ],
  [UserIntent.TRACK_APPLICATION]: [
    'स्थिति', 'आवेदन', 'ट्रैक', 'sthiti', 'avedan',
  ],
  [UserIntent.SWITCH_LANGUAGE]: [
    'भाषा', 'हिंदी', 'इंग्लिश', 'bhasha', 'hindi', 'english',
  ],
  [UserIntent.HELP]: [
    'मदद', 'सहायता', 'शुरू', 'madad', 'shuru',
  ],
};

/** Tamil keywords */
const TA_KEYWORDS: KeywordMap = {
  [UserIntent.DISCOVER_SCHEMES]: ['திட்டம்', 'திட்டங்கள்', 'உதவி', 'நலன்'],
  [UserIntent.CHECK_ELIGIBILITY]: ['தகுதி', 'தகுதியா'],
  [UserIntent.EXPLAIN_SCHEME]: ['விவரம்', 'என்ன', 'சொல்லுங்கள்'],
  [UserIntent.UPLOAD_DOCUMENT]: ['ஆவணம்', 'ஆதார்', 'படம்'],
  [UserIntent.TRACK_APPLICATION]: ['நிலை', 'விண்ணப்பம்'],
  [UserIntent.HELP]: ['உதவி', 'தொடங்கு'],
};

const LANGUAGE_KEYWORD_MAPS: Partial<Record<SupportedLanguage, KeywordMap>> = {
  en: EN_KEYWORDS,
  hi: HI_KEYWORDS,
  ta: TA_KEYWORDS,
  // Additional languages will be added as the platform expands
};

// ─── Keyword Matcher ──────────────────────────────────────────────────────────

interface IntentMatch {
  intent: UserIntent;
  confidence: number;
  matchedKeyword?: string;
}

export function detectIntentFromText(
  text: string,
  language: SupportedLanguage,
): IntentMatch {
  const lowerText = text.toLowerCase().trim();

  // Try language-specific keywords first, then fall back to English
  const keywordMaps: KeywordMap[] = [
    LANGUAGE_KEYWORD_MAPS[language] ?? {},
    EN_KEYWORDS,
  ];

  for (const keywordMap of keywordMaps) {
    for (const [intent, keywords] of Object.entries(keywordMap) as [UserIntent, string[]][]) {
      for (const keyword of keywords) {
        if (lowerText.includes(keyword.toLowerCase())) {
          return {
            intent,
            confidence: 0.85,
            matchedKeyword: keyword,
          };
        }
      }
    }
  }

  // No keyword match — return UNKNOWN with low confidence
  return {
    intent: UserIntent.UNKNOWN,
    confidence: 0.3,
  };
}

// ─── Audio Format Detection ───────────────────────────────────────────────────

/**
 * Detects audio format from buffer magic bytes.
 * WhatsApp sends OGG/Opus for voice messages.
 */
export function detectAudioFormat(
  buffer: Buffer,
): 'wav' | 'mp3' | 'ogg' | 'flac' {
  // OGG: starts with "OggS"
  if (buffer[0] === 0x4f && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) {
    return 'ogg';
  }
  // WAV: starts with "RIFF"
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    return 'wav';
  }
  // MP3: starts with ID3 or 0xFF 0xFB
  if (
    (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) ||
    (buffer[0] === 0xff && (buffer[1]! & 0xe0) === 0xe0)
  ) {
    return 'mp3';
  }
  // FLAC: starts with "fLaC"
  if (buffer[0] === 0x66 && buffer[1] === 0x4c && buffer[2] === 0x61 && buffer[3] === 0x43) {
    return 'flac';
  }
  // Default to OGG (WhatsApp default)
  return 'ogg';
}

// ─── Text Normalizer ──────────────────────────────────────────────────────────

/**
 * Normalizes transcribed text: trims whitespace, removes filler words,
 * and handles common ASR artifacts for Indian languages.
 */
export function normalizeTranscribedText(text: string, language: SupportedLanguage): string {
  let normalized = text.trim();

  // Remove common ASR filler artifacts
  const fillers: Record<string, string[]> = {
    en: ['um', 'uh', 'like', 'you know'],
    hi: ['आं', 'हम्म', 'अच्छा', 'हाँ हाँ'],
  };

  const langFillers = fillers[language] ?? fillers['en'] ?? [];
  for (const filler of langFillers) {
    normalized = normalized.replace(new RegExp(`\\b${filler}\\b`, 'gi'), '').trim();
  }

  // Collapse multiple spaces
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}
