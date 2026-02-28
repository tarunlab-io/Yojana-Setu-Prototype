import type { GovernmentScheme, UserProfile, SupportedLanguage } from '@yojana-setu/shared';

// ─── System Prompts ───────────────────────────────────────────────────────────

export const SCHEME_EXPLAINER_SYSTEM_PROMPT = `You are Yojana-Setu, a helpful assistant that explains Indian government welfare schemes to citizens in simple, clear language.

Your role:
- Explain complex government schemes in simple terms that any citizen can understand
- Use everyday language, avoid bureaucratic jargon
- Be warm, encouraging, and patient
- Always respond in the language specified by the user
- When explaining eligibility, break it down into clear yes/no questions
- Mention specific benefit amounts and deadlines prominently
- Always end with clear next steps

Important guidelines:
- Do NOT make up scheme details — only use the information provided
- If a deadline has passed, clearly state the scheme is no longer accepting applications
- Format responses for WhatsApp (no markdown headers, use simple line breaks and emojis sparingly)
- Keep responses concise — under 500 words`;

export const FALLBACK_SUGGESTION_SYSTEM_PROMPT = `You are Yojana-Setu, a helpful assistant for Indian government welfare schemes.

When no schemes match a user's profile exactly, your job is to:
1. Explain kindly why no exact matches were found
2. Suggest what profile information would help find better matches
3. Mention 1-2 general categories of schemes they might explore
4. Ask a targeted question to collect missing profile information

Be encouraging — many schemes exist and the user likely qualifies for something.
Always respond in the specified language.`;

// ─── Explanation Prompt Builder ───────────────────────────────────────────────

export function buildExplanationPrompt(
  scheme: GovernmentScheme,
  language: SupportedLanguage,
  userProfile?: UserProfile,
): string {
  const deadline = scheme.applicationDeadline
    ? `Application Deadline: ${scheme.applicationDeadline.toLocaleDateString('en-IN')}`
    : 'No application deadline specified';

  const userContext = userProfile
    ? `
User Context (use this to personalise the explanation):
- Age: ${calculateAge(userProfile.demographics.dateOfBirth)} years
- Gender: ${userProfile.demographics.gender}
- State: ${userProfile.demographics.stateCode}
- Caste Category: ${userProfile.socioeconomic.casteCategory}
- Annual Income: ₹${userProfile.socioeconomic.annualIncomeINR.toLocaleString('en-IN')}
- Education: ${userProfile.socioeconomic.educationLevel}
- Employment: ${userProfile.socioeconomic.employmentStatus}
- BPL Card: ${userProfile.socioeconomic.isBPL ? 'Yes' : 'No'}`
    : '';

  return `Please explain this government scheme in simple language.
Respond ONLY in ${language} (language code). If the language is 'en', respond in English.

SCHEME INFORMATION:
Name: ${scheme.officialName}${scheme.popularName ? ` (also known as "${scheme.popularName}")` : ''}
Ministry: ${scheme.ministry}
Type: ${scheme.level === 'central' ? 'Central Government Scheme' : `State Scheme (${scheme.stateCode})`}
Short Description: ${scheme.shortDescription}
Full Description: ${scheme.fullDescription}
${deadline}

ELIGIBILITY CRITERIA:
${JSON.stringify(scheme.eligibilityCriteria, null, 2)}

BENEFIT DETAILS:
Type: ${scheme.benefitDetails.benefitType}
${scheme.benefitDetails.estimatedValueINR ? `Amount: ₹${scheme.benefitDetails.estimatedValueINR.toLocaleString('en-IN')}` : ''}
Description: ${scheme.benefitDetails.description}

REQUIRED DOCUMENTS:
${scheme.requiredDocuments.map((d) => `- ${d.description} (${d.isMandatory ? 'Required' : 'Optional'})`).join('\n')}
${userContext}

Your response MUST follow this structure:
1. What is this scheme? (2-3 simple sentences)
2. Who can apply? (use simple yes/no eligibility questions)
3. What benefit will you get? (be specific about amounts)
4. What documents do you need? (simple list)
5. How to apply and by when? (clear steps)

Keep it conversational and warm. Use simple words. Format for WhatsApp readability.`;
}

// ─── Fallback Suggestion Prompt Builder ──────────────────────────────────────

export function buildFallbackPrompt(
  language: SupportedLanguage,
  userProfile: UserProfile,
  originalQuery: string,
): string {
  return `A citizen searched for welfare schemes but no exact matches were found.

Respond ONLY in ${language} language code. If 'en', use English.

USER'S QUERY: "${originalQuery}"

USER PROFILE:
- State: ${userProfile.demographics.stateCode}
- Age: ${calculateAge(userProfile.demographics.dateOfBirth)} years
- Gender: ${userProfile.demographics.gender}
- Caste: ${userProfile.socioeconomic.casteCategory}
- Annual Income: ₹${userProfile.socioeconomic.annualIncomeINR.toLocaleString('en-IN')}
- Education: ${userProfile.socioeconomic.educationLevel}
- Employment: ${userProfile.socioeconomic.employmentStatus}
- BPL: ${userProfile.socioeconomic.isBPL ? 'Yes' : 'No'}
- Profile Completeness: ${userProfile.completionScore}%

Please:
1. Gently explain no exact matches were found (1-2 sentences)
2. Suggest 1-2 categories of schemes they likely qualify for
3. Ask ONE specific question to help narrow down matching schemes
4. Keep the response under 200 words and format for WhatsApp`;
}

// ─── Eligibility Q&A Prompt Builder ──────────────────────────────────────────

export function buildEligibilityQuestionsPrompt(
  scheme: GovernmentScheme,
  language: SupportedLanguage,
): string {
  return `Convert these eligibility criteria into simple yes/no questions for a citizen.
Respond ONLY in ${language} language code. If 'en', use English.

SCHEME: ${scheme.officialName}
ELIGIBILITY CRITERIA: ${JSON.stringify(scheme.eligibilityCriteria, null, 2)}

Rules:
- Generate exactly one question per criterion
- Each question must have a clear yes/no answer
- Start each question with "क्या" (in Hindi) or equivalent in the target language
- Make questions simple enough for someone with primary school education
- Return as a JSON array with this format:
  [{"question": "...", "expectedAnswer": "yes" | "no", "criteriaKey": "..."}]

Return ONLY the JSON array, no other text.`;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function calculateAge(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  if (
    now.getMonth() < dob.getMonth() ||
    (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate())
  ) age--;
  return age;
}
