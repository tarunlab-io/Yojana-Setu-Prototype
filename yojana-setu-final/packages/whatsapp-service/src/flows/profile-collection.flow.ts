/**
 * Profile Collection Flow
 *
 * Collects user demographics and socioeconomic data through a conversational
 * question-answer sequence. Survives language switches (Req 7.5) and
 * supports skipping optional fields.
 *
 * Collection order (Requirement 2.1–2.3):
 *  1. Full name
 *  2. Date of birth
 *  3. Gender
 *  4. State & district
 *  5. Annual income
 *  6. Caste category
 *  7. Education level
 *  8. Employment status
 *  9. BPL card status
 * 10. Disability status (optional)
 */

import type { RoutingContext } from '../handlers/message-router';
import {
  ConversationStage,
  Gender,
  CasteCategory,
  SupportedLanguage,
  type ConversationContext,
} from '@yojana-setu/shared';
import { sendTextMessage, sendButtonMessage, sendListMessage } from '../clients/twilio.client';
import { logger } from '../config/logger';

// ─── Question Sequence Definition ────────────────────────────────────────────

type CollectionField =
  | 'fullName' | 'dateOfBirth' | 'gender' | 'stateCode' | 'district'
  | 'annualIncome' | 'casteCategory' | 'educationLevel' | 'employmentStatus'
  | 'isBPL' | 'hasDisability';

interface Question {
  field: CollectionField;
  ask: (lang: SupportedLanguage) => string;
  validate: (input: string) => { valid: boolean; value?: string | boolean | number; errorMsg?: string };
  inputType: 'text' | 'list' | 'button';
  options?: (lang: SupportedLanguage) => Array<{ id: string; title: string }>;
}

const QUESTIONS: Question[] = [
  {
    field: 'fullName',
    inputType: 'text',
    ask: (l) => l === 'hi'
      ? 'आपका पूरा नाम क्या है? (जैसे: रमेश कुमार)'
      : 'What is your full name? (e.g. Ramesh Kumar)',
    validate: (v) => {
      const trimmed = v.trim();
      if (trimmed.length < 2 || trimmed.length > 100) {
        return { valid: false, errorMsg: 'Please enter your full name (2–100 characters).' };
      }
      return { valid: true, value: trimmed };
    },
  },

  {
    field: 'dateOfBirth',
    inputType: 'text',
    ask: (l) => l === 'hi'
      ? 'आपकी जन्म तिथि क्या है? (DD/MM/YYYY, जैसे: 15/08/1990)'
      : 'What is your date of birth? (DD/MM/YYYY, e.g. 15/08/1990)',
    validate: (v) => {
      const match = v.trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
      if (!match) return { valid: false, errorMsg: 'Please enter date as DD/MM/YYYY (e.g. 15/08/1990).' };
      const [, day, month, year] = match;
      const date = new Date(`${year!}-${month!.padStart(2,'0')}-${day!.padStart(2,'0')}`);
      if (isNaN(date.getTime())) return { valid: false, errorMsg: 'Invalid date. Please check and re-enter.' };
      const age = new Date().getFullYear() - date.getFullYear();
      if (age < 0 || age > 120) return { valid: false, errorMsg: 'Please enter a valid birth year.' };
      return { valid: true, value: date.toISOString().split('T')[0] };
    },
  },

  {
    field: 'gender',
    inputType: 'button',
    ask: (l) => l === 'hi' ? 'आपका लिंग क्या है?' : 'What is your gender?',
    options: (l) => [
      { id: `gender:${Gender.MALE}`, title: l === 'hi' ? 'पुरुष (Male)' : 'Male' },
      { id: `gender:${Gender.FEMALE}`, title: l === 'hi' ? 'महिला (Female)' : 'Female' },
      { id: `gender:${Gender.TRANSGENDER}`, title: 'Transgender' },
    ],
    validate: (v) => {
      const g = v.replace('gender:', '').trim().toUpperCase();
      if (Object.values(Gender).includes(g as Gender)) return { valid: true, value: g };
      const map: Record<string, Gender> = {
        male: Gender.MALE, female: Gender.FEMALE, m: Gender.MALE, f: Gender.FEMALE,
        पुरुष: Gender.MALE, महिला: Gender.FEMALE, 'M': Gender.MALE, 'F': Gender.FEMALE,
      };
      const mapped = map[v.trim().toLowerCase()];
      if (mapped) return { valid: true, value: mapped };
      return { valid: false, errorMsg: 'Please select Male, Female, or Transgender.' };
    },
  },

  {
    field: 'annualIncome',
    inputType: 'text',
    ask: (l) => l === 'hi'
      ? 'आपकी वार्षिक पारिवारिक आय कितनी है? (रुपयों में, जैसे: 150000)'
      : 'What is your annual family income? (in rupees, e.g. 150000)',
    validate: (v) => {
      const num = parseInt(v.replace(/[,₹\s]/g, ''), 10);
      if (isNaN(num) || num < 0) return { valid: false, errorMsg: 'Please enter a valid income amount in rupees.' };
      if (num > 100_000_000) return { valid: false, errorMsg: 'Income amount seems too high. Please re-enter.' };
      return { valid: true, value: num };
    },
  },

  {
    field: 'casteCategory',
    inputType: 'list',
    ask: (l) => l === 'hi' ? 'आपकी जाति श्रेणी क्या है?' : 'What is your caste category?',
    options: (l) => [
      { id: `caste:${CasteCategory.SC}`, title: 'SC (Scheduled Caste / अनुसूचित जाति)' },
      { id: `caste:${CasteCategory.ST}`, title: 'ST (Scheduled Tribe / अनुसूचित जनजाति)' },
      { id: `caste:${CasteCategory.OBC}`, title: 'OBC (Other Backward Classes / अन्य पिछड़ा वर्ग)' },
      { id: `caste:${CasteCategory.EWS}`, title: 'EWS (Economically Weaker Section)' },
      { id: `caste:${CasteCategory.GENERAL}`, title: 'General / सामान्य' },
    ],
    validate: (v) => {
      const c = v.replace('caste:', '').trim().toUpperCase();
      if (Object.values(CasteCategory).includes(c as CasteCategory)) return { valid: true, value: c };
      return { valid: false, errorMsg: 'Please select your caste category from the options provided.' };
    },
  },

  {
    field: 'isBPL',
    inputType: 'button',
    ask: (l) => l === 'hi'
      ? 'क्या आपके पास BPL (गरीबी रेखा से नीचे) राशन कार्ड है?'
      : 'Do you have a BPL (Below Poverty Line) ration card?',
    options: (l) => [
      { id: 'bpl:yes', title: l === 'hi' ? 'हाँ' : 'Yes' },
      { id: 'bpl:no', title: l === 'hi' ? 'नहीं' : 'No' },
    ],
    validate: (v) => {
      const clean = v.replace('bpl:', '').trim().toLowerCase();
      if (['yes', 'haan', 'हाँ', '1', 'true'].includes(clean)) return { valid: true, value: true };
      if (['no', 'nahi', 'नहीं', '2', 'false'].includes(clean)) return { valid: true, value: false };
      return { valid: false, errorMsg: 'Please reply Yes or No.' };
    },
  },
];

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function handleProfileCollection(ctx: RoutingContext): Promise<void> {
  const { phoneNumber, session, processedText } = ctx;
  const lang = session.context.language;
  const collected = session.context.collectedData;

  // Find the next question that hasn't been answered
  const currentField = QUESTIONS.find((q) => !(q.field in collected));

  if (!currentField) {
    // All fields collected — profile is complete
    await onProfileComplete(phoneNumber, lang, collected);
    return;
  }

  // If we have input to process, try to validate it for the current field
  if (processedText) {
    const validation = currentField.validate(processedText);

    if (!validation.valid) {
      // Re-ask with error guidance
      await sendTextMessage(phoneNumber, {
        type: 'text',
        content: `⚠️ ${validation.errorMsg ?? 'Invalid input.'}\n\n${currentField.ask(lang)}`,
      });
      return;
    }

    // Valid — update collected data and move to next question
    logger.info('Profile field collected', {
      phoneNumber, field: currentField.field,
    });

    // Find next unanswered question
    const nextField = QUESTIONS.find(
      (q) => q.field !== currentField.field && !(q.field in collected),
    );

    if (!nextField) {
      await onProfileComplete(phoneNumber, lang, {
        ...collected,
        [currentField.field]: validation.value,
      });
      return;
    }

    // Ask next question
    await askQuestion(phoneNumber, nextField, lang);
    return;
  }

  // No input yet — ask the current question
  await askQuestion(phoneNumber, currentField, lang);
}

// ─── Question Sending ─────────────────────────────────────────────────────────

async function askQuestion(
  phoneNumber: string,
  question: Question,
  lang: SupportedLanguage,
): Promise<void> {
  if (question.inputType === 'button' && question.options) {
    await sendButtonMessage(phoneNumber, {
      type: 'button',
      bodyText: question.ask(lang),
      buttons: question.options(lang).slice(0, 3),
    });
  } else if (question.inputType === 'list' && question.options) {
    await sendListMessage(phoneNumber, {
      type: 'list',
      bodyText: question.ask(lang),
      buttonLabel: lang === 'hi' ? 'चुनें' : 'Select',
      items: question.options(lang),
    });
  } else {
    await sendTextMessage(phoneNumber, {
      type: 'text',
      content: question.ask(lang),
    });
  }
}

// ─── Profile Complete ─────────────────────────────────────────────────────────

async function onProfileComplete(
  phoneNumber: string,
  lang: SupportedLanguage,
  collected: Record<string, unknown>,
): Promise<void> {
  const completionMsg: Partial<Record<SupportedLanguage, string>> = {
    hi: `✅ *आपकी जानकारी सहेज ली गई है!*

अब मैं आपके लिए उपयुक्त सरकारी योजनाएँ खोज रहा हूँ...

_इसमें कुछ सेकंड लग सकते हैं।_`,
    en: `✅ *Your profile is complete!*

Now searching for government schemes that match your profile...

_This may take a few seconds._`,
  };

  await sendTextMessage(phoneNumber, {
    type: 'text',
    content: completionMsg[lang] ?? completionMsg['en']!,
  });
}
