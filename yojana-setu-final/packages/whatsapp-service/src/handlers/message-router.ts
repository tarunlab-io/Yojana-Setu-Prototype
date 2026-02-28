/**
 * Message Router
 *
 * Central dispatcher for all incoming WhatsApp messages.
 *
 * Routing logic:
 *  1. Identify message type (text / voice / document / button reply)
 *  2. Resolve or create conversation session
 *  3. If voice: transcribe via Bhashini → extract intent
 *  4. If text: detect intent from keywords
 *  5. Route intent to the appropriate conversation flow handler
 *  6. Send response back via Twilio
 */

import type {
  WhatsAppWebhook,
  WhatsAppIncomingMessage,
  ConversationState,
  UserIntent,
  SupportedLanguage,
} from '@yojana-setu/shared';
import { UserIntent as Intent, ConversationStage, MediaType } from '@yojana-setu/shared';
import { logger } from '../config/logger';
import { downloadUserMedia, sendTextMessage } from '../clients/twilio.client';

// Flow handlers (imported lazily to avoid circular deps)
import { handleGreeting } from '../flows/greeting.flow';
import { handleSchemeDiscovery } from '../flows/scheme-discovery.flow';
import { handleProfileCollection } from '../flows/profile-collection.flow';
import { handleDocumentUpload } from '../flows/document-upload.flow';
import { handleApplicationTracking } from '../flows/application-tracking.flow';
import { handleLanguageSwitch } from '../flows/language-switch.flow';
import { handleHelp } from '../flows/help.flow';
import { handleUnknown } from '../flows/unknown.flow';

// Service clients (called over HTTP in production; direct import here for simplicity)
import type { VoiceProcessingResult } from '@yojana-setu/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RoutingContext {
  session: ConversationState;
  phoneNumber: string;
  incomingMessage: WhatsAppIncomingMessage;
  processedText?: string;       // Transcribed text (if voice) or raw text
  detectedIntent: UserIntent;
  confidence: number;
}

// ─── Intent → Handler Map ─────────────────────────────────────────────────────

type FlowHandler = (ctx: RoutingContext) => Promise<void>;

const INTENT_HANDLERS: Record<UserIntent, FlowHandler> = {
  [Intent.DISCOVER_SCHEMES]:    handleSchemeDiscovery,
  [Intent.CHECK_ELIGIBILITY]:   handleSchemeDiscovery,   // Same flow, different entry
  [Intent.EXPLAIN_SCHEME]:      handleSchemeDiscovery,
  [Intent.UPLOAD_DOCUMENT]:     handleDocumentUpload,
  [Intent.TRACK_APPLICATION]:   handleApplicationTracking,
  [Intent.UPDATE_PROFILE]:      handleProfileCollection,
  [Intent.SWITCH_LANGUAGE]:     handleLanguageSwitch,
  [Intent.HELP]:                handleHelp,
  [Intent.UNKNOWN]:             handleUnknown,
};

// ─── Stage → Handler Override ─────────────────────────────────────────────────
// When we're mid-flow, the session stage takes priority over detected intent.
// (e.g., user types "yes" during profile collection → continue profile, not trigger scheme search)

const STAGE_HANDLERS: Partial<Record<ConversationStage, FlowHandler>> = {
  [ConversationStage.PROFILE_COLLECTION]:  handleProfileCollection,
  [ConversationStage.DOCUMENT_COLLECTION]: handleDocumentUpload,
  [ConversationStage.SCHEME_EXPLANATION]:  handleSchemeDiscovery,
  [ConversationStage.APPLICATION_REVIEW]:  handleApplicationTracking,
};

// ─── Main Router ──────────────────────────────────────────────────────────────

export async function routeMessage(
  webhook: WhatsAppWebhook,
  session: ConversationState,
  voiceProcessingFn?: (audioBuffer: Buffer, language: SupportedLanguage) => Promise<VoiceProcessingResult>,
): Promise<void> {
  const msg = webhook.entry[0]?.changes[0]?.value?.messages?.[0];
  if (!msg) {
    logger.warn('Webhook contained no message', { webhook });
    return;
  }

  const phoneNumber = msg.from;

  try {
    // ── Step 1: Extract text and intent ────────────────────────────────────

    let processedText = '';
    let detectedIntent: UserIntent = Intent.UNKNOWN;
    let confidence = 0.5;

    if (msg.type === 'text' && msg.text?.body) {
      processedText = msg.text.body.trim();
      const intentResult = detectIntentFromText(processedText, session.context.language);
      detectedIntent = intentResult.intent;
      confidence = intentResult.confidence;

    } else if (msg.type === 'audio' && msg.audio?.id && voiceProcessingFn) {
      // Download and transcribe voice message
      const mediaUrl = `https://api.twilio.com/2010-04-01/Accounts/${process.env['TWILIO_ACCOUNT_SID']}/Messages/${msg.audio.id}/Media`;
      const audioBuffer = await downloadUserMedia(mediaUrl);
      const voiceResult = await voiceProcessingFn(audioBuffer, session.context.language);

      processedText = voiceResult.transcribedText;
      detectedIntent = voiceResult.intent ?? Intent.UNKNOWN;
      confidence = voiceResult.confidence;

    } else if (msg.type === 'document' || msg.type === 'image') {
      // Document/image upload → route to document handler
      detectedIntent = Intent.UPLOAD_DOCUMENT;
      confidence = 0.99;

    } else if (msg.type === 'interactive') {
      // Button reply or list selection
      const replyId = msg.interactive?.button_reply?.id ??
                      msg.interactive?.list_reply?.id ?? '';
      processedText = replyId;
      const intentResult = resolveInteractiveReply(replyId, session.context.conversationStage);
      detectedIntent = intentResult.intent;
      confidence = intentResult.confidence;
    }

    // ── Step 2: Stage override (mid-flow continuity) ──────────────────────

    const stageHandler = STAGE_HANDLERS[session.context.conversationStage];
    const isShortAffirmation = isAffirmationOrDenial(processedText);
    const isMidFlow = stageHandler !== undefined &&
                      session.context.conversationStage !== ConversationStage.GREETING &&
                      session.context.conversationStage !== ConversationStage.COMPLETED;

    // Use stage handler if we're mid-flow and the user didn't explicitly switch intent
    const useStageHandler = isMidFlow &&
      (isShortAffirmation || detectedIntent === Intent.UNKNOWN || confidence < 0.7);

    const ctx: RoutingContext = {
      session,
      phoneNumber,
      incomingMessage: msg,
      processedText,
      detectedIntent,
      confidence,
    };

    // ── Step 3: Dispatch ──────────────────────────────────────────────────

    logger.info('Routing message', {
      phoneNumber,
      stage: session.context.conversationStage,
      intent: detectedIntent,
      confidence: Math.round(confidence * 100),
      useStageHandler,
    });

    if (session.context.conversationStage === ConversationStage.GREETING || !session.userId) {
      await handleGreeting(ctx);
    } else if (useStageHandler && stageHandler) {
      await stageHandler(ctx);
    } else {
      const handler = INTENT_HANDLERS[detectedIntent] ?? handleUnknown;
      await handler(ctx);
    }

  } catch (err) {
    logger.error('Message routing failed', {
      phoneNumber,
      error: err instanceof Error ? err.message : 'Unknown',
    });
    // Send a graceful error message in the user's language
    await sendTextMessage(phoneNumber, {
      type: 'text',
      content: getErrorMessage(session.context.language),
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectIntentFromText(
  text: string,
  language: SupportedLanguage,
): { intent: UserIntent; confidence: number } {
  // Inline quick detection — full version is in intent-detector.ts in voice-service
  const lower = text.toLowerCase().trim();

  if (/\b(scheme|yojana|योजना|திட்டம்|benefit|welfare|eligible)\b/i.test(lower)) {
    return { intent: Intent.DISCOVER_SCHEMES, confidence: 0.87 };
  }
  if (/\b(upload|document|aadhaar|आधार|photo|scan|send)\b/i.test(lower)) {
    return { intent: Intent.UPLOAD_DOCUMENT, confidence: 0.85 };
  }
  if (/\b(status|track|application|avedan|स्थिति)\b/i.test(lower)) {
    return { intent: Intent.TRACK_APPLICATION, confidence: 0.85 };
  }
  if (/\b(language|bhasha|भाषा|change|switch)\b/i.test(lower)) {
    return { intent: Intent.SWITCH_LANGUAGE, confidence: 0.90 };
  }
  if (/\b(help|madad|मदद|start|menu)\b/i.test(lower)) {
    return { intent: Intent.HELP, confidence: 0.90 };
  }
  if (/\b(update|profile|income|address|my details)\b/i.test(lower)) {
    return { intent: Intent.UPDATE_PROFILE, confidence: 0.82 };
  }

  return { intent: Intent.UNKNOWN, confidence: 0.3 };
}

function resolveInteractiveReply(
  replyId: string,
  currentStage: ConversationStage,
): { intent: UserIntent; confidence: number } {
  // Interactive reply IDs are prefixed with the intent they trigger
  if (replyId.startsWith('scheme:')) return { intent: Intent.DISCOVER_SCHEMES, confidence: 0.99 };
  if (replyId.startsWith('track:')) return { intent: Intent.TRACK_APPLICATION, confidence: 0.99 };
  if (replyId.startsWith('upload:')) return { intent: Intent.UPLOAD_DOCUMENT, confidence: 0.99 };
  if (replyId.startsWith('lang:')) return { intent: Intent.SWITCH_LANGUAGE, confidence: 0.99 };

  // Affirmation/denial in a flow context
  if (['yes', 'no', 'haan', 'nahi'].includes(replyId.toLowerCase())) {
    // Continue whatever flow we're in
    const stageIntent: Partial<Record<ConversationStage, UserIntent>> = {
      [ConversationStage.PROFILE_COLLECTION]: Intent.UPDATE_PROFILE,
      [ConversationStage.DOCUMENT_COLLECTION]: Intent.UPLOAD_DOCUMENT,
      [ConversationStage.SCHEME_EXPLANATION]: Intent.DISCOVER_SCHEMES,
    };
    return { intent: stageIntent[currentStage] ?? Intent.UNKNOWN, confidence: 0.8 };
  }

  return { intent: Intent.UNKNOWN, confidence: 0.4 };
}

function isAffirmationOrDenial(text: string): boolean {
  const affirmations = new Set([
    'yes', 'no', 'haan', 'nahi', 'ha', 'ok', 'okay', 'sure', 'done',
    'हाँ', 'नहीं', 'ठीक है', 'சரி', 'ஆம்', 'இல்லை',
    '1', '2', '3', '4', '5',
  ]);
  return affirmations.has(text.toLowerCase().trim());
}

function getErrorMessage(language: SupportedLanguage): string {
  const messages: Partial<Record<SupportedLanguage, string>> = {
    hi: '😔 माफ़ करें, कुछ गलत हो गया। कृपया फिर से प्रयास करें या "help" टाइप करें।',
    ta: '😔 மன்னிக்கவும், ஏதோ தவறு நடந்தது. மீண்டும் முயற்சிக்கவும் அல்லது "help" என்று தட்டச்சு செய்யவும்.',
    te: '😔 క్షమించండి, ఏదో తప్పు జరిగింది. దయచేసి మళ్ళీ ప్రయత్నించండి లేదా "help" అని టైప్ చేయండి.',
    en: '😔 Sorry, something went wrong. Please try again or type "help".',
  } as Partial<Record<SupportedLanguage, string>>;

  return messages[language] ?? messages['en'] ?? '😔 Something went wrong. Please try again.';
}
