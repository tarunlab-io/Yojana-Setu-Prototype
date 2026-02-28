/**
 * Greeting Flow
 *
 * Handles:
 *  - First-time user onboarding
 *  - Language selection
 *  - Consent collection (Req 2.5)
 *  - Warm handoff to profile collection or main menu
 */

import type { RoutingContext } from '../handlers/message-router';
import { ConversationStage, SupportedLanguage, ConsentType } from '@yojana-setu/shared';
import { sendTextMessage, sendListMessage, sendButtonMessage } from '../clients/twilio.client';
import { logger } from '../config/logger';

// ─── Language Selection Menu ──────────────────────────────────────────────────

const LANGUAGE_OPTIONS = [
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
];

// ─── Greeting Messages by Language ───────────────────────────────────────────

const GREETING: Partial<Record<SupportedLanguage, string>> = {
  hi: `🙏 *योजना-सेतु में आपका स्वागत है!*

मैं आपको सरकारी कल्याण योजनाओं के बारे में जानकारी देने और आवेदन करने में मदद करूँगा।

आप मुझसे हिंदी या अंग्रेजी में बात कर सकते हैं — या वॉइस मैसेज भेज सकते हैं।

_आपकी जानकारी पूरी तरह सुरक्षित रहेगी।_`,

  ta: `🙏 *யோஜனா-சேது-க்கு வரவேற்கிறோம்!*

அரசாங்க நலத்திட்டங்களைப் பற்றி தெரிந்துகொள்ளவும் விண்ணப்பிக்கவும் உதவுவேன்.

தமிழிலோ ஆங்கிலத்திலோ அல்லது குரல் செய்தியிலோ பேசலாம்.

_உங்கள் தகவல் பாதுகாப்பாக இருக்கும்._`,

  te: `🙏 *యోజన-సేతుకు స్వాగతం!*

ప్రభుత్వ సంక్షేమ పథకాల గురించి తెలుసుకోవడానికి మరియు దరఖాస్తు చేయడానికి సహాయం చేస్తాను.

తెలుగు లేదా ఆంగ్లంలో మాట్లాడవచ్చు — లేదా వాయిస్ మెసేజ్ పంపవచ్చు.`,

  en: `🙏 *Welcome to Yojana-Setu!*

I help you discover and apply for Indian government welfare schemes.

You can talk to me in any Indian language — or send a voice message!

_Your information is safe and private._`,
};

const CONSENT_MESSAGE: Partial<Record<SupportedLanguage, string>> = {
  hi: `आगे बढ़ने के लिए, मुझे आपकी व्यक्तिगत जानकारी (जैसे उम्र, आमदनी, जाति) संग्रहित करने की अनुमति चाहिए।

यह जानकारी केवल योजनाओं की पात्रता जाँचने के लिए उपयोग होगी और किसी के साथ साझा नहीं की जाएगी।

क्या आप सहमत हैं?`,

  en: `To help you find schemes, I need to store your personal information (such as age, income, caste category).

This data will ONLY be used to check your eligibility for schemes and will never be shared.

Do you agree?`,
};

const PRIVACY_LINK = 'https://yojana-setu.gov.in/privacy';

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function handleGreeting(ctx: RoutingContext): Promise<void> {
  const { phoneNumber, session, processedText } = ctx;
  const lang = session.context.language;

  // ── Case 1: Language selection reply ────────────────────────────────────
  if (processedText?.startsWith('lang:')) {
    const selectedLang = processedText.replace('lang:', '') as SupportedLanguage;
    // Language switch is handled by language-switch.flow after routing
    // Here we just acknowledge and proceed to consent
    await sendConsentRequest(phoneNumber, selectedLang);
    return;
  }

  // ── Case 2: Consent response ─────────────────────────────────────────────
  const isConsentStage = session.context.collectedData['awaitingConsent'] === true;
  if (isConsentStage) {
    const text = processedText?.toLowerCase().trim() ?? '';
    const agreed = ['yes', 'haan', 'हाँ', 'ஆம்', 'అవును', 'ok', 'okay', '1'].includes(text)
      || text.includes('agree') || text.includes('yes');

    if (agreed) {
      // Consent granted — move to profile collection
      logger.info('Consent granted', { phoneNumber });
      await sendTextMessage(phoneNumber, {
        type: 'text',
        content: getThankYouMessage(lang),
      });
      // The profile collection flow will handle the next step
      // We just need to update context here — profile-collection.flow takes over
      return;
    } else {
      // Consent declined
      await sendTextMessage(phoneNumber, {
        type: 'text',
        content: getConsentDeclinedMessage(lang),
      });
      return;
    }
  }

  // ── Case 3: Returning user ───────────────────────────────────────────────
  if (session.userId && session.context.conversationStage !== ConversationStage.GREETING) {
    const welcomeBack = getWelcomeBackMessage(lang, session.context.collectedData['firstName'] as string | undefined);
    await sendTextMessage(phoneNumber, { type: 'text', content: welcomeBack });
    await sendMainMenu(phoneNumber, lang);
    return;
  }

  // ── Case 4: Brand new user — send greeting + language selector ───────────
  const greetingText = GREETING[lang] ?? GREETING['en']!;
  await sendTextMessage(phoneNumber, { type: 'text', content: greetingText });

  await sendListMessage(phoneNumber, {
    type: 'list',
    headerText: '🌐 Choose Your Language / भाषा चुनें',
    bodyText: 'Please select your preferred language to continue:',
    buttonLabel: 'Select Language',
    items: LANGUAGE_OPTIONS,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function sendConsentRequest(phoneNumber: string, lang: SupportedLanguage): Promise<void> {
  const message = CONSENT_MESSAGE[lang] ?? CONSENT_MESSAGE['en']!;
  const fullMessage = `${message}\n\n🔗 Privacy Policy: ${PRIVACY_LINK}`;

  await sendButtonMessage(phoneNumber, {
    type: 'button',
    bodyText: fullMessage,
    buttons: [
      { id: 'consent:yes', title: lang === 'hi' ? 'हाँ, मैं सहमत हूँ' : 'Yes, I Agree' },
      { id: 'consent:no', title: lang === 'hi' ? 'नहीं' : 'No' },
    ],
  });
}

async function sendMainMenu(phoneNumber: string, lang: SupportedLanguage): Promise<void> {
  const menus: Partial<Record<SupportedLanguage, string>> = {
    hi: `आप क्या करना चाहते हैं?\n\n1️⃣ *योजनाएँ खोजें* — अपने लिए सरकारी योजनाएँ ढूंढें\n2️⃣ *दस्तावेज़ अपलोड करें* — आधार, पैन आदि जमा करें\n3️⃣ *आवेदन ट्रैक करें* — आवेदन की स्थिति जानें\n4️⃣ *भाषा बदलें* — Language change करें\n\nकोई विकल्प चुनें या अपना सवाल पूछें:`,
    en: `What would you like to do?\n\n1️⃣ *Find Schemes* — Discover welfare schemes for you\n2️⃣ *Upload Documents* — Submit Aadhaar, PAN etc.\n3️⃣ *Track Application* — Check application status\n4️⃣ *Change Language* — Switch language\n\nChoose an option or ask your question:`,
  };
  await sendTextMessage(phoneNumber, {
    type: 'text',
    content: menus[lang] ?? menus['en']!,
  });
}

function getThankYouMessage(lang: SupportedLanguage): string {
  const msgs: Partial<Record<SupportedLanguage, string>> = {
    hi: '✅ धन्यवाद! अब मुझे आपकी कुछ बुनियादी जानकारी चाहिए ताकि मैं आपके लिए सही योजनाएँ खोज सकूँ।\n\nआपका पूरा नाम क्या है?',
    en: '✅ Thank you! I need a few details to find the right schemes for you.\n\nWhat is your full name?',
  };
  return msgs[lang] ?? msgs['en']!;
}

function getConsentDeclinedMessage(lang: SupportedLanguage): string {
  const msgs: Partial<Record<SupportedLanguage, string>> = {
    hi: '🙏 समझ में आया। बिना सहमति के हम आगे नहीं बढ़ सकते। जब आप तैयार हों, "start" टाइप करें।',
    en: '🙏 Understood. We cannot proceed without consent. Type "start" when you are ready.',
  };
  return msgs[lang] ?? msgs['en']!;
}

function getWelcomeBackMessage(lang: SupportedLanguage, firstName?: string): string {
  const name = firstName ? ` ${firstName}` : '';
  const msgs: Partial<Record<SupportedLanguage, string>> = {
    hi: `🙏 वापस स्वागत है${name}! मैं आपकी कैसे मदद कर सकता हूँ?`,
    en: `🙏 Welcome back${name}! How can I help you today?`,
  };
  return msgs[lang] ?? msgs['en']!;
}
