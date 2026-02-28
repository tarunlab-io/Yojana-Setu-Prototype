import type {
  ISchemeMatcherService,
  UserProfile,
  GovernmentScheme,
  SchemeMatch,
  SchemeExplanation,
  EligibilityResult,
  SchemeUpdate,
  EligibilityQuestion,
  SupportedLanguage,
} from '@yojana-setu/shared';
import {
  SchemeNotFoundError,
  UserNotFoundError,
} from '@yojana-setu/shared';
import { SchemeRepository } from '../db/scheme.repository';
import { buildSchemeMatch, rankMatches, buildEligibilityResult } from './eligibility-matcher';
import { chatComplete, chatCompleteJSON } from './openai-client';
import {
  SCHEME_EXPLAINER_SYSTEM_PROMPT,
  FALLBACK_SUGGESTION_SYSTEM_PROMPT,
  buildExplanationPrompt,
  buildFallbackPrompt,
  buildEligibilityQuestionsPrompt,
} from '../prompts/scheme-prompts';
import { cacheGet, cacheSet, TTL } from '../config/cache';
import { logger } from '../config/logger';

export class SchemeService implements ISchemeMatcherService {
  private readonly repo: SchemeRepository;

  constructor(repo?: SchemeRepository) {
    this.repo = repo ?? new SchemeRepository();
  }

  // ─── Find Eligible Schemes ────────────────────────────────────────────────
  // Requirement 1.3, 1.4: Return ranked schemes within 5 seconds

  async findEligibleSchemes(
    userProfile: UserProfile,
    query?: string,
  ): Promise<SchemeMatch[]> {
    const startTime = Date.now();

    // Cache key based on user profile + optional query
    const cacheKey = `matches:${userProfile.userId}:${query ?? 'all'}`;
    const cached = await cacheGet<SchemeMatch[]>(cacheKey);
    if (cached) {
      logger.debug('Scheme matches served from cache', { userId: userProfile.userId });
      return cached;
    }

    // Get candidate schemes — filtered by state first to reduce scoring load
    const candidates = await this.repo.findByState(userProfile.demographics.stateCode);

    // Score and filter
    const matches: SchemeMatch[] = [];
    for (const scheme of candidates) {
      // If a text query is provided, do a lightweight relevance check
      if (query && !this.isRelevantToQuery(scheme, query)) continue;

      const match = buildSchemeMatch(userProfile, scheme);
      if (match) matches.push(match);
    }

    // Rank: eligibility score DESC, then benefit amount DESC (Req 1.4)
    const ranked = rankMatches(matches);

    const elapsed = Date.now() - startTime;
    logger.info('Scheme matching completed', {
      userId: userProfile.userId,
      candidateCount: candidates.length,
      matchCount: ranked.length,
      elapsedMs: elapsed,
    });

    // Warn if we're approaching the 5-second SLA (Req 1.3)
    if (elapsed > 4000) {
      logger.warn('Scheme matching approaching 5s SLA', { elapsedMs: elapsed });
    }

    await cacheSet(cacheKey, ranked, TTL.MATCH);
    return ranked;
  }

  // ─── Explain Scheme (GPT-4 powered) ──────────────────────────────────────
  // Requirement 3.1–3.4: Simple explanation with yes/no questions and document examples

  async explainScheme(
    schemeId: string,
    language: SupportedLanguage,
    userProfile?: UserProfile,
  ): Promise<SchemeExplanation> {
    const cacheKey = `explanation:${schemeId}:${language}`;
    const cached = await cacheGet<SchemeExplanation>(cacheKey);
    if (cached) return cached;

    const scheme = await this.repo.findById(schemeId);
    if (!scheme) throw new SchemeNotFoundError(schemeId);

    // Generate simplified description via GPT-4
    const explanationPrompt = buildExplanationPrompt(scheme, language, userProfile);
    const simplifiedDescription = await chatComplete(
      SCHEME_EXPLAINER_SYSTEM_PROMPT,
      explanationPrompt,
      { maxTokens: 800, temperature: 0.4 },
    );

    // Generate yes/no eligibility questions via GPT-4
    const questionsPrompt = buildEligibilityQuestionsPrompt(scheme, language);
    let eligibilityQuestions: EligibilityQuestion[] = [];
    try {
      const rawQuestions = await chatCompleteJSON<
        Array<{ question: string; expectedAnswer: 'yes' | 'no'; criteriaKey: string }>
      >(SCHEME_EXPLAINER_SYSTEM_PROMPT, questionsPrompt, { maxTokens: 500 });

      eligibilityQuestions = rawQuestions.map((q, i) => ({
        questionId: `${schemeId}-q${i + 1}`,
        question: q.question,
        expectedAnswer: q.expectedAnswer,
        criteriaKey: q.criteriaKey,
      }));
    } catch (err) {
      logger.warn('Failed to generate eligibility questions, continuing without them', {
        schemeId,
        error: err instanceof Error ? err.message : 'Unknown',
      });
    }

    const explanation: SchemeExplanation = {
      schemeId,
      language,
      simplifiedDescription,
      eligibilityQuestions,
      requiredDocumentExamples: scheme.requiredDocuments.map(
        (d) => d.exampleDescription ?? d.description,
      ),
      importantDates: scheme.applicationDeadline
        ? [{ label: 'Application Deadline', date: scheme.applicationDeadline }]
        : [],
      applicationSteps: scheme.applicationUrl
        ? [`Visit: ${scheme.applicationUrl}`, 'Fill the application form', 'Attach required documents', 'Submit and collect receipt']
        : ['Visit your nearest Common Service Centre (CSC)', 'Carry all required documents', 'Fill the application form', 'Collect acknowledgement slip'],
      generatedAt: new Date(),
    };

    await cacheSet(cacheKey, explanation, TTL.EXPLANATION);
    return explanation;
  }

  // ─── Check Eligibility ────────────────────────────────────────────────────

  async checkEligibility(
    schemeId: string,
    userProfile: UserProfile,
  ): Promise<EligibilityResult> {
    const scheme = await this.repo.findById(schemeId);
    if (!scheme) throw new SchemeNotFoundError(schemeId);

    return buildEligibilityResult(userProfile.userId, scheme, userProfile);
  }

  // ─── Get Scheme By ID ─────────────────────────────────────────────────────

  async getSchemeById(schemeId: string): Promise<GovernmentScheme | null> {
    return this.repo.findById(schemeId);
  }

  // ─── Search Schemes ───────────────────────────────────────────────────────

  async searchSchemes(
    query: string,
    _language?: SupportedLanguage,
  ): Promise<GovernmentScheme[]> {
    return this.repo.search(query);
  }

  // ─── Scheme Updates ───────────────────────────────────────────────────────
  // Requirement 6.2: Notify affected users when criteria change

  async getSchemeUpdates(userId: string): Promise<SchemeUpdate[]> {
    // TODO Task 8: Cross-reference user's application history with recently updated schemes
    // For now, return recently updated active schemes as potential updates
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000); // last 48 hours
    const updated = await this.repo.getRecentlyUpdated(since);

    return updated.map((scheme) => ({
      schemeId: scheme.schemeId,
      updateType: 'modified' as const,
      description: `${scheme.officialName} has been updated`,
      updatedAt: scheme.updatedAt,
    }));
  }

  // ─── Fallback Suggestions (Req 1.5) ──────────────────────────────────────

  async generateFallbackSuggestion(
    userProfile: UserProfile,
    originalQuery: string,
    language: SupportedLanguage,
  ): Promise<string> {
    const prompt = buildFallbackPrompt(language, userProfile, originalQuery);
    return chatComplete(FALLBACK_SUGGESTION_SYSTEM_PROMPT, prompt, {
      maxTokens: 300,
      temperature: 0.5,
    });
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private isRelevantToQuery(scheme: GovernmentScheme, query: string): boolean {
    const lowerQuery = query.toLowerCase();
    const searchFields = [
      scheme.officialName,
      scheme.popularName ?? '',
      scheme.shortDescription,
      scheme.category,
      scheme.ministry,
    ].map((f) => f.toLowerCase());

    return searchFields.some((field) => field.includes(lowerQuery));
  }
}
