import { describe, it, expect } from '@jest/globals';
import { detectIntentFromText, detectAudioFormat, normalizeTranscribedText } from '../../services/intent-detector';
import { UserIntent, SupportedLanguage } from '@yojana-setu/shared';

// ─── detectIntentFromText ─────────────────────────────────────────────────────

describe('detectIntentFromText', () => {
  describe('English', () => {
    it('detects scheme discovery intent', () => {
      const result = detectIntentFromText('I want to find government schemes for farmers', 'en' as SupportedLanguage);
      expect(result.intent).toBe(UserIntent.DISCOVER_SCHEMES);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('detects eligibility check intent', () => {
      const result = detectIntentFromText('Am I eligible for this scheme?', 'en' as SupportedLanguage);
      expect(result.intent).toBe(UserIntent.CHECK_ELIGIBILITY);
    });

    it('detects document upload intent', () => {
      const result = detectIntentFromText('I want to upload my Aadhaar card', 'en' as SupportedLanguage);
      expect(result.intent).toBe(UserIntent.UPLOAD_DOCUMENT);
    });

    it('detects application tracking intent', () => {
      const result = detectIntentFromText('What is the status of my application?', 'en' as SupportedLanguage);
      expect(result.intent).toBe(UserIntent.TRACK_APPLICATION);
    });

    it('detects language switch intent', () => {
      const result = detectIntentFromText('Change language to Hindi', 'en' as SupportedLanguage);
      expect(result.intent).toBe(UserIntent.SWITCH_LANGUAGE);
    });

    it('detects help intent', () => {
      const result = detectIntentFromText('Help', 'en' as SupportedLanguage);
      expect(result.intent).toBe(UserIntent.HELP);
    });

    it('returns UNKNOWN for unrecognised messages', () => {
      const result = detectIntentFromText('xyzzy frobulate', 'en' as SupportedLanguage);
      expect(result.intent).toBe(UserIntent.UNKNOWN);
      expect(result.confidence).toBeLessThan(0.5);
    });
  });

  describe('Hindi', () => {
    it('detects scheme discovery from Devanagari keywords', () => {
      const result = detectIntentFromText('मुझे सरकारी योजना चाहिए', 'hi' as SupportedLanguage);
      expect(result.intent).toBe(UserIntent.DISCOVER_SCHEMES);
    });

    it('detects document upload from transliterated Hindi', () => {
      const result = detectIntentFromText('mujhe aadhar dastavez upload karna hai', 'hi' as SupportedLanguage);
      expect(result.intent).toBe(UserIntent.UPLOAD_DOCUMENT);
    });

    it('detects help from Hindi', () => {
      const result = detectIntentFromText('madad karo', 'hi' as SupportedLanguage);
      expect(result.intent).toBe(UserIntent.HELP);
    });
  });

  describe('Tamil', () => {
    it('detects scheme discovery from Tamil', () => {
      const result = detectIntentFromText('திட்டங்கள் வேண்டும்', 'ta' as SupportedLanguage);
      expect(result.intent).toBe(UserIntent.DISCOVER_SCHEMES);
    });

    it('detects help intent from Tamil', () => {
      const result = detectIntentFromText('உதவி', 'ta' as SupportedLanguage);
      expect(result.intent).toBe(UserIntent.HELP);
    });
  });

  it('is case-insensitive for English', () => {
    const lower = detectIntentFromText('scheme', 'en' as SupportedLanguage);
    const upper = detectIntentFromText('SCHEME', 'en' as SupportedLanguage);
    expect(lower.intent).toBe(upper.intent);
  });
});

// ─── detectAudioFormat ────────────────────────────────────────────────────────

describe('detectAudioFormat', () => {
  it('detects OGG from magic bytes', () => {
    const buffer = Buffer.from([0x4f, 0x67, 0x67, 0x53, 0x00]);
    expect(detectAudioFormat(buffer)).toBe('ogg');
  });

  it('detects WAV from magic bytes', () => {
    const buffer = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00]);
    expect(detectAudioFormat(buffer)).toBe('wav');
  });

  it('detects MP3 from ID3 header', () => {
    const buffer = Buffer.from([0x49, 0x44, 0x33, 0x00]);
    expect(detectAudioFormat(buffer)).toBe('mp3');
  });

  it('detects FLAC from magic bytes', () => {
    const buffer = Buffer.from([0x66, 0x4c, 0x61, 0x43, 0x00]);
    expect(detectAudioFormat(buffer)).toBe('flac');
  });

  it('defaults to OGG for unknown format (WhatsApp default)', () => {
    const buffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    expect(detectAudioFormat(buffer)).toBe('ogg');
  });
});

// ─── normalizeTranscribedText ─────────────────────────────────────────────────

describe('normalizeTranscribedText', () => {
  it('trims leading and trailing whitespace', () => {
    const result = normalizeTranscribedText('  hello world  ', 'en' as SupportedLanguage);
    expect(result).toBe('hello world');
  });

  it('removes English filler words', () => {
    const result = normalizeTranscribedText('um I want to find like a scheme', 'en' as SupportedLanguage);
    expect(result).not.toContain(' um ');
    expect(result).not.toContain(' like ');
  });

  it('collapses multiple spaces', () => {
    const result = normalizeTranscribedText('hello   world', 'en' as SupportedLanguage);
    expect(result).toBe('hello world');
  });

  it('preserves Devanagari text', () => {
    const hindi = 'मुझे योजना चाहिए';
    const result = normalizeTranscribedText(hindi, 'hi' as SupportedLanguage);
    expect(result).toBe(hindi);
  });

  it('preserves Tamil text', () => {
    const tamil = 'திட்டம் வேண்டும்';
    const result = normalizeTranscribedText(tamil, 'ta' as SupportedLanguage);
    expect(result).toBe(tamil);
  });
});
