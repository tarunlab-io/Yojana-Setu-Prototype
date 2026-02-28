/**
 * Scheme Discovery Flow
 *
 * Handles: DISCOVER_SCHEMES, CHECK_ELIGIBILITY, EXPLAIN_SCHEME intents.
 *
 * Steps:
 *  1. Check profile completion — prompt if incomplete (Req 2.3)
 *  2. Search & rank matching schemes via scheme-service
 *  3. Present top 5 schemes as interactive list
 *  4. On selection: show GPT-4 explanation + eligibility questions
 *  5. Offer to start application or collect more docs
 */

import type { RoutingContext } from '../handlers/message-router';
import { ConversationStage, SupportedLanguage } from '@yojana-setu/shared';
import { sendTextMessage, sendListMessage } from '../clients/twilio.client';
import { logger } from '../config/logger';

const MAX_SCHEMES_SHOWN = 5;

// ─── Service URLs (internal microservice calls) ───────────────────────────────

const SCHEME_SERVICE_URL = process.env['SCHEME_SERVICE_URL'] ?? 'http://scheme-service:3002';

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function handleSchemeDiscovery(ctx: RoutingContext): Promise<void> {
  const { phoneNumber, session, processedText } = ctx;
  const lang = session.context.language;

  // ── Step 1: Check if a specific scheme was selected from a list ──────────
  if (processedText?.startsWith('scheme:')) {
    const schemeId = processedText.replace('scheme:', '');
    await explainScheme(phoneNumber, schemeId, lang, session.userId);
    return;
  }

  // ── Step 2: Verify profile is sufficiently complete ──────────────────────
  const completionScore = session.context.collectedData['completionScore'] as number | undefined;
  if (!completionScore || completionScore < 40) {
    await sendTextMessage(phoneNumber, {
      type: 'text',
      content: getIncompleteProfileMessage(lang),
    });
    return;
  }

  // ── Step 3: Search for matching schemes ──────────────────────────────────
  await sendTextMessage(phoneNumber, {
    type: 'text',
    content: getSearchingMessage(lang),
  });

  try {
    const response = await fetch(`${SCHEME_SERVICE_URL}/schemes/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userProfile: buildProfileFromSession(session),
        query: processedText || undefined,
      }),
    });

    const data = await response.json() as {
      success: boolean;
      data: Array<{ scheme: { schemeId: string; officialName: string; popularName?: string; shortDescription: string }; eligibilityScore: number; estimatedBenefitINR?: number }>;
      fallbackMessage?: string;
      count: number;
    };

    if (!data.success) throw new Error('Scheme service error');

    // ── Step 4: No matches — show fallback message ───────────────────────
    if (data.count === 0) {
      const fallback = data.fallbackMessage ?? getNoMatchMessage(lang);
      await sendTextMessage(phoneNumber, { type: 'text', content: fallback });
      return;
    }

    // ── Step 5: Present top schemes as an interactive list ───────────────
    const topSchemes = data.data.slice(0, MAX_SCHEMES_SHOWN);
    const headerText = getSchemeListHeader(lang, data.count);

    await sendListMessage(phoneNumber, {
      type: 'list',
      headerText,
      bodyText: getSchemeListBody(lang, data.count),
      buttonLabel: lang === 'hi' ? 'योजना चुनें' : 'Select Scheme',
      items: topSchemes.map((match) => ({
        id: `scheme:${match.scheme.schemeId}`,
        title: (match.scheme.popularName ?? match.scheme.officialName).slice(0, 24),
        description: [
          `${Math.round(match.eligibilityScore * 100)}% match`,
          match.estimatedBenefitINR
            ? `₹${(match.estimatedBenefitINR / 1000).toFixed(0)}K benefit`
            : '',
        ].filter(Boolean).join(' • '),
      })),
    });

    logger.info('Scheme list sent to user', {
      phoneNumber,
      matchCount: data.count,
      shownCount: topSchemes.length,
    });

  } catch (err) {
    logger.error('Scheme discovery failed', {
      phoneNumber,
      error: err instanceof Error ? err.message : 'Unknown',
    });
    await sendTextMessage(phoneNumber, {
      type: 'text',
      content: getServiceErrorMessage(lang),
    });
  }
}

// ─── Scheme Explanation ───────────────────────────────────────────────────────

async function explainScheme(
  phoneNumber: string,
  schemeId: string,
  lang: SupportedLanguage,
  userId: string,
): Promise<void> {
  try {
    await sendTextMessage(phoneNumber, {
      type: 'text',
      content: lang === 'hi' ? '📋 इस योजना की जानकारी तैयार हो रही है...' : '📋 Preparing scheme details...',
    });

    const response = await fetch(
      `${SCHEME_SERVICE_URL}/schemes/${schemeId}/explain?language=${lang}`,
    );
    const data = await response.json() as {
      success: boolean;
      data: { simplifiedDescription: string; applicationSteps: string[]; importantDates: Array<{ label: string; date: string }> };
    };

    if (!data.success) throw new Error('Explanation failed');

    const explanation = data.data;

    // Format for WhatsApp (no markdown headers — use bold with *)
    const steps = explanation.applicationSteps.map((s, i) => `${i + 1}. ${s}`).join('\n');
    const dates = explanation.importantDates.map((d) => `📅 ${d.label}: ${d.date}`).join('\n');

    const formatted = [
      explanation.simplifiedDescription,
      '',
      `*${lang === 'hi' ? 'आवेदन कैसे करें:' : 'How to Apply:'}*`,
      steps,
      dates ? `\n${dates}` : '',
    ].filter(Boolean).join('\n');

    await sendTextMessage(phoneNumber, { type: 'text', content: formatted });

    // Offer next steps
    await sendTextMessage(phoneNumber, {
      type: 'text',
      content: lang === 'hi'
        ? 'क्या आप इस योजना के लिए दस्तावेज़ अपलोड करना चाहेंगे? "upload" टाइप करें।\nया "menu" टाइप करें मुख्य मेनू के लिए।'
        : 'Would you like to upload documents for this scheme? Type "upload".\nOr type "menu" to go back.',
    });

  } catch (err) {
    logger.error('Scheme explanation failed', { phoneNumber, schemeId });
    await sendTextMessage(phoneNumber, {
      type: 'text',
      content: lang === 'hi'
        ? 'माफ़ करें, इस योजना की जानकारी अभी उपलब्ध नहीं है। कृपया बाद में प्रयास करें।'
        : 'Sorry, scheme details are not available right now. Please try again later.',
    });
  }
}

// ─── Profile Builder ──────────────────────────────────────────────────────────

function buildProfileFromSession(session: ReturnType<typeof import('@yojana-setu/shared')>['type']['ConversationState'] extends never ? never : any): Record<string, unknown> {
  const d = session.context.collectedData;
  return {
    userId: session.userId,
    demographics: {
      fullName: d['fullName'],
      dateOfBirth: d['dateOfBirth'],
      gender: d['gender'],
      stateCode: d['stateCode'] ?? 'IN-TN', // Default if not collected
      district: d['district'] ?? '',
      locality: d['locality'] ?? '',
      pinCode: d['pinCode'] ?? '000000',
      mobileNumber: session.phoneNumber,
    },
    socioeconomic: {
      annualIncomeINR: d['annualIncome'] ?? 0,
      casteCategory: d['casteCategory'] ?? 'GENERAL',
      isBPL: d['isBPL'] ?? false,
      educationLevel: d['educationLevel'] ?? 'none',
      employmentStatus: d['employmentStatus'] ?? 'unemployed',
      hasDisability: d['hasDisability'] ?? false,
    },
    preferences: {
      preferredLanguage: session.context.language,
      preferredChannel: 'whatsapp',
      notificationsEnabled: true,
    },
    completionScore: d['completionScore'] ?? 50,
  };
}

// ─── Message Templates ────────────────────────────────────────────────────────

function getSearchingMessage(lang: SupportedLanguage): string {
  return lang === 'hi'
    ? '🔍 आपके लिए योजनाएँ खोजी जा रही हैं...'
    : '🔍 Searching for schemes that match your profile...';
}

function getSchemeListHeader(lang: SupportedLanguage, count: number): string {
  return lang === 'hi'
    ? `🎯 आपके लिए ${count} योजनाएँ मिलीं`
    : `🎯 Found ${count} matching schemes for you`;
}

function getSchemeListBody(lang: SupportedLanguage, count: number): string {
  const shown = Math.min(count, MAX_SCHEMES_SHOWN);
  return lang === 'hi'
    ? `नीचे ${shown} सबसे उपयुक्त योजनाएँ दी गई हैं। किसी एक को चुनें और विस्तृत जानकारी पाएँ:`
    : `Here are the top ${shown} schemes matched to your profile. Select one to learn more:`;
}

function getNoMatchMessage(lang: SupportedLanguage): string {
  return lang === 'hi'
    ? '😔 अभी आपके लिए कोई योजना नहीं मिली।\n\nअपनी प्रोफ़ाइल अपडेट करके ("update profile" टाइप करें) और खोज करें।'
    : '😔 No matching schemes found right now.\n\nTry updating your profile ("update profile") and search again.';
}

function getIncompleteProfileMessage(lang: SupportedLanguage): string {
  return lang === 'hi'
    ? '⚠️ आपकी प्रोफ़ाइल अधूरी है।\n\nयोजनाएँ खोजने के लिए पहले अपनी जानकारी पूरी करें। "setup" टाइप करें।'
    : '⚠️ Your profile is incomplete.\n\nPlease complete your profile first to find schemes. Type "setup".';
}

function getServiceErrorMessage(lang: SupportedLanguage): string {
  return lang === 'hi'
    ? '😔 योजनाएँ खोजने में समस्या आई। कृपया कुछ देर बाद "schemes" टाइप करके फिर प्रयास करें।'
    : '😔 Unable to search schemes right now. Please type "schemes" again in a moment.';
}
