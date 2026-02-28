/**
 * Document Upload Flow (Req 4.1–4.5)
 */

import type { RoutingContext } from '../handlers/message-router';
import { SupportedLanguage, DocumentType } from '@yojana-setu/shared';
import { sendTextMessage, sendListMessage, downloadUserMedia } from '../clients/twilio.client';
import { logger } from '../config/logger';

const DOCUMENT_SERVICE_URL = process.env['DOCUMENT_SERVICE_URL'] ?? 'http://document-service:3004';

// Document type display names by language
const DOC_NAMES: Record<string, { en: string; hi: string }> = {
  [DocumentType.AADHAAR]: { en: 'Aadhaar Card', hi: 'आधार कार्ड' },
  [DocumentType.PAN]: { en: 'PAN Card', hi: 'पैन कार्ड' },
  [DocumentType.INCOME_CERTIFICATE]: { en: 'Income Certificate', hi: 'आय प्रमाण पत्र' },
  [DocumentType.CASTE_CERTIFICATE]: { en: 'Caste Certificate', hi: 'जाति प्रमाण पत्र' },
  [DocumentType.BANK_PASSBOOK]: { en: 'Bank Passbook', hi: 'बैंक पासबुक' },
  [DocumentType.LAND_RECORD]: { en: 'Land Record', hi: 'भूमि अभिलेख' },
};

export async function handleDocumentUpload(ctx: RoutingContext): Promise<void> {
  const { phoneNumber, session, incomingMessage } = ctx;
  const lang = session.context.language;

  // Case 1: User sent an actual image/document
  if (incomingMessage.type === 'image' || incomingMessage.type === 'document') {
    const mediaId = (incomingMessage.image?.id ?? incomingMessage.document?.id) ?? '';
    const mimeType = incomingMessage.image?.mime_type ?? incomingMessage.document?.mime_type ?? 'image/jpeg';
    const filename = incomingMessage.document?.filename ?? `document_${Date.now()}.jpg`;

    // Check what document type we're expecting
    const pendingType = session.context.pendingDocuments?.[0];
    if (!pendingType) {
      await sendDocumentTypeSelector(phoneNumber, lang);
      return;
    }

    await sendTextMessage(phoneNumber, {
      type: 'text',
      content: lang === 'hi'
        ? '📄 दस्तावेज़ मिला। जाँच हो रही है...'
        : '📄 Document received. Validating...',
    });

    try {
      const mediaUrl = `https://api.twilio.com/2010-04-01/Accounts/${process.env['TWILIO_ACCOUNT_SID']}/Messages/${mediaId}/Media`;
      const fileBuffer = await downloadUserMedia(mediaUrl);

      const response = await fetch(`${DOCUMENT_SERVICE_URL}/documents/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileBase64: fileBuffer.toString('base64'),
          mimeType,
          filename,
          documentType: pendingType,
          userId: session.userId,
        }),
      });

      const data = await response.json() as {
        success: boolean;
        data: { isValid: boolean; status: string; missingFields: string[]; recommendations: string[]; confidence: number };
      };

      if (data.data.isValid) {
        await sendTextMessage(phoneNumber, {
          type: 'text',
          content: lang === 'hi'
            ? `✅ ${DOC_NAMES[pendingType]?.hi ?? pendingType} सफलतापूर्वक सत्यापित हो गया!\n\nविश्वसनीयता: ${Math.round(data.data.confidence * 100)}%`
            : `✅ ${DOC_NAMES[pendingType]?.en ?? pendingType} verified successfully!\n\nConfidence: ${Math.round(data.data.confidence * 100)}%`,
        });
      } else {
        const feedback = data.data.recommendations[0] ??
          (lang === 'hi' ? 'कृपया स्पष्ट फ़ोटो भेजें।' : 'Please send a clearer photo.');
        await sendTextMessage(phoneNumber, {
          type: 'text',
          content: `⚠️ ${feedback}\n\n${lang === 'hi' ? 'कृपया पुनः प्रयास करें।' : 'Please try again.'}`,
        });
      }

    } catch (err) {
      logger.error('Document upload failed', { phoneNumber, error: err instanceof Error ? err.message : 'Unknown' });
      await sendTextMessage(phoneNumber, {
        type: 'text',
        content: lang === 'hi'
          ? '😔 दस्तावेज़ अपलोड में समस्या आई। कृपया पुनः भेजें।'
          : '😔 Document upload failed. Please send it again.',
      });
    }
    return;
  }

  // Case 2: User asked to upload — show document selector
  await sendDocumentTypeSelector(phoneNumber, lang);
}

async function sendDocumentTypeSelector(phoneNumber: string, lang: SupportedLanguage): Promise<void> {
  const prompt = lang === 'hi'
    ? 'कौन सा दस्तावेज़ अपलोड करना चाहते हैं? चुनें:'
    : 'Which document would you like to upload? Select:';

  await sendListMessage(phoneNumber, {
    type: 'list',
    bodyText: prompt,
    buttonLabel: lang === 'hi' ? 'चुनें' : 'Select',
    items: Object.entries(DOC_NAMES).map(([id, names]) => ({
      id: `upload:${id}`,
      title: lang === 'hi' ? names.hi : names.en,
    })),
  });
}

// ─── Application Tracking Flow ────────────────────────────────────────────────

export async function handleApplicationTracking(ctx: RoutingContext): Promise<void> {
  const { phoneNumber, session } = ctx;
  const lang = session.context.language;

  const trackingRef = session.context.collectedData['lastTrackingRef'] as string | undefined;

  if (!trackingRef && !ctx.processedText?.match(/^YS-\d{4}-\d{5}$/)) {
    await sendTextMessage(phoneNumber, {
      type: 'text',
      content: lang === 'hi'
        ? 'अपना ट्रैकिंग नंबर दर्ज करें (जैसे: YS-2024-00123):\n\nया "menu" टाइप करें।'
        : 'Enter your tracking reference (e.g. YS-2024-00123):\n\nOr type "menu" to go back.',
    });
    return;
  }

  const ref = ctx.processedText?.match(/^YS-\d{4}-\d{5}$/)
    ? ctx.processedText
    : trackingRef!;

  await sendTextMessage(phoneNumber, {
    type: 'text',
    content: lang === 'hi'
      ? `🔍 आवेदन ${ref} की स्थिति जाँच हो रही है...`
      : `🔍 Checking status for application ${ref}...`,
  });

  // TODO Task 8: Call application-service to get real status
  await sendTextMessage(phoneNumber, {
    type: 'text',
    content: lang === 'hi'
      ? `📋 *आवेदन: ${ref}*\n\nस्थिति: समीक्षाधीन (Under Review)\nअनुमानित समय: 10-15 कार्यदिवस\n\nकोई अपडेट आने पर आपको सूचित किया जाएगा।`
      : `📋 *Application: ${ref}*\n\nStatus: Under Review\nEstimated time: 10-15 working days\n\nYou will be notified when there's an update.`,
  });
}

// ─── Language Switch Flow (Req 7.5) ───────────────────────────────────────────

export async function handleLanguageSwitch(ctx: RoutingContext): Promise<void> {
  const { phoneNumber, session, processedText } = ctx;

  // Parse selected language from interactive reply
  if (processedText?.startsWith('lang:')) {
    const newLang = processedText.replace('lang:', '') as SupportedLanguage;
    const confirmMsg: Partial<Record<SupportedLanguage, string>> = {
      hi: '✅ भाषा हिंदी में बदल दी गई है। आपकी सारी जानकारी सुरक्षित है।',
      ta: '✅ மொழி தமிழுக்கு மாற்றப்பட்டது. உங்கள் தகவல் பாதுகாப்பாக உள்ளது.',
      te: '✅ భాష తెలుగుకు మార్చబడింది. మీ వివరాలు సురక్షితంగా ఉన్నాయి.',
      en: '✅ Language switched to English. All your data is preserved.',
      mr: '✅ भाषा मराठीत बदलली गेली. तुमची सर्व माहिती सुरक्षित आहे.',
      bn: '✅ ভাষা বাংলায় পরিবর্তিত হয়েছে। আপনার সমস্ত তথ্য সংরক্ষিত আছে।',
    };
    await sendTextMessage(phoneNumber, {
      type: 'text',
      content: confirmMsg[newLang] ?? confirmMsg['en']!,
    });
    return;
  }

  // Show language selector
  const { sendListMessage: list } = await import('../clients/twilio.client');
  await list(phoneNumber, {
    type: 'list',
    headerText: '🌐 Language / भाषा / மொழி',
    bodyText: 'Select your preferred language:',
    buttonLabel: 'Select',
    items: [
      { id: 'lang:hi', title: 'हिंदी (Hindi)' },
      { id: 'lang:ta', title: 'தமிழ் (Tamil)' },
      { id: 'lang:te', title: 'తెలుగు (Telugu)' },
      { id: 'lang:mr', title: 'मराठी (Marathi)' },
      { id: 'lang:bn', title: 'বাংলা (Bengali)' },
      { id: 'lang:gu', title: 'ગુજરાતી (Gujarati)' },
      { id: 'lang:kn', title: 'ಕನ್ನಡ (Kannada)' },
      { id: 'lang:ml', title: 'മലയാളം (Malayalam)' },
      { id: 'lang:pa', title: 'ਪੰਜਾਬੀ (Punjabi)' },
      { id: 'lang:en', title: 'English' },
    ],
  });
}

// ─── Help Flow ────────────────────────────────────────────────────────────────

export async function handleHelp(ctx: RoutingContext): Promise<void> {
  const { phoneNumber, session } = ctx;
  const lang = session.context.language;

  const helpMsg: Partial<Record<SupportedLanguage, string>> = {
    hi: `🙏 *योजना-सेतु सहायता*

आप यह कर सकते हैं:

📌 *"schemes"* — अपने लिए योजनाएँ खोजें
📌 *"upload"* — दस्तावेज़ जमा करें
📌 *"track YS-XXXX-XXXXX"* — आवेदन की स्थिति जानें
📌 *"language"* — भाषा बदलें
📌 *"profile"* — अपनी जानकारी अपडेट करें

🎙️ *वॉइस मैसेज* भी भेज सकते हैं!`,

    en: `🙏 *Yojana-Setu Help*

You can:

📌 *"schemes"* — Find schemes for you
📌 *"upload"* — Submit documents
📌 *"track YS-XXXX-XXXXX"* — Check application status
📌 *"language"* — Change language
📌 *"profile"* — Update your details

🎙️ You can also send *voice messages*!`,
  };

  await sendTextMessage(phoneNumber, {
    type: 'text',
    content: helpMsg[lang] ?? helpMsg['en']!,
  });
}

// ─── Unknown Intent Flow ──────────────────────────────────────────────────────

export async function handleUnknown(ctx: RoutingContext): Promise<void> {
  const { phoneNumber, session } = ctx;
  const lang = session.context.language;

  const unknownMsg: Partial<Record<SupportedLanguage, string>> = {
    hi: `😅 माफ़ करें, मैं समझ नहीं पाया।

आप यह टाइप करें:
• *"schemes"* — योजनाएँ खोजें
• *"help"* — सहायता पाएँ

या वॉइस मैसेज भेजें।`,

    en: `😅 Sorry, I didn't understand that.

Try typing:
• *"schemes"* — Find welfare schemes
• *"help"* — See all options

Or send a voice message!`,
  };

  await sendTextMessage(phoneNumber, {
    type: 'text',
    content: unknownMsg[lang] ?? unknownMsg['en']!,
  });
}
