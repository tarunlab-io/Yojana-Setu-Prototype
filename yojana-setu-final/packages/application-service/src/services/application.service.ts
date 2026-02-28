import {
  type ApplicationFull as Application,
  type ApplicationFullSummary as ApplicationSummary,
  type ApplicationEvent,
  type GovernmentPortalSubmission,
  ApplicationStatus,
  DuplicateApplicationError,
  ApplicationNotFoundError,
  InvalidStatusTransitionError,
  generateUUID,
} from '@yojana-setu/shared';
import { ApplicationRepository } from '../db/application.repository';
import {
  assertValidTransition,
  isTerminalState,
  generateReferenceNumber,
  buildStatusEvent,
  getExpectedCompletionDate,
  isOverdue,
  getAllowedTransitions,
} from './application-state-machine';
import {
  submitApplication,
  pollApplicationStatus,
} from '../clients/government-portal.client';
import { notifyUserOfStatusChange } from '../clients/notification.client';
import { logger } from '../config/logger';
import type { SupportedLanguage } from '@yojana-setu/shared';

export class ApplicationService {
  private readonly repo: ApplicationRepository;

  constructor(repo?: ApplicationRepository) {
    this.repo = repo ?? new ApplicationRepository();
  }

  // ─── Start Application (Req 6.1) ─────────────────────────────────────────
  // Creates a DRAFT application — user can review before submitting.

  async startApplication(
    userId: string,
    schemeId: string,
    documentIds: string[],
    formData: Record<string, unknown>,
  ): Promise<Application> {
    // Guard: no duplicate active applications for same scheme
    const existing = await this.repo.countByUserAndScheme(userId, schemeId);
    if (existing > 0) {
      throw new DuplicateApplicationError(userId, schemeId);
    }

    const seqNumber = await this.repo.getNextSequenceNumber();
    const referenceNumber = generateReferenceNumber(seqNumber);

    const application = await this.repo.create({
      userId,
      schemeId,
      referenceNumber,
      documentIds,
      formData,
    });

    // Record CREATED event
    const event = buildStatusEvent(
      application.applicationId,
      ApplicationStatus.DRAFT,
      ApplicationStatus.DRAFT,
      'user',
      'Application created',
    );
    await this.repo.appendEvent(event);

    logger.info('Application started', {
      applicationId: application.applicationId,
      referenceNumber,
      userId,
      schemeId,
    });

    return application;
  }

  // ─── Submit Application (Req 6.2) ────────────────────────────────────────
  // Transitions DRAFT → SUBMITTED and dispatches to government portal.

  async submitApplication(
    applicationId: string,
    userId: string,
    portalSubmission: GovernmentPortalSubmission,
    userLanguage: SupportedLanguage,
  ): Promise<Application> {
    const application = await this.getApplicationForUser(applicationId, userId);

    assertValidTransition(
      applicationId,
      application.status,
      ApplicationStatus.SUBMITTED,
    );

    // Submit to government portal
    const portalResponse = await submitApplication(application, portalSubmission);

    // Transition to SUBMITTED
    const submitted = await this.repo.updateStatus(
      applicationId,
      ApplicationStatus.SUBMITTED,
      {
        governmentReference: portalResponse.governmentReferenceNumber ?? undefined,
        submittedAt: new Date(),
      },
    );

    // Append event
    const event = buildStatusEvent(
      applicationId,
      application.status,
      ApplicationStatus.SUBMITTED,
      'user',
      portalResponse.message,
    );
    await this.repo.appendEvent(event);

    // Notify user via WhatsApp
    await notifyUserOfStatusChange(
      portalSubmission.applicantMobile,
      submitted,
      event,
      userLanguage,
    );

    logger.info('Application submitted', {
      applicationId,
      referenceNumber: application.referenceNumber,
      channel: portalResponse.submissionChannel,
      govRef: portalResponse.governmentReferenceNumber,
    });

    return submitted;
  }

  // ─── Track Application (Req 6.3, 6.4) ────────────────────────────────────
  // Returns current status with progress context and expected completion.

  async trackApplication(
    applicationId: string,
    userId: string,
  ): Promise<ApplicationSummary> {
    const application = await this.getApplicationForUser(applicationId, userId);
    const history = await this.repo.getEventHistory(applicationId);

    // Poll government portal for fresh status if applicable
    if (
      application.governmentReference &&
      !isTerminalState(application.status) &&
      application.status !== ApplicationStatus.DRAFT
    ) {
      const portalStatus = await pollApplicationStatus(
        application.governmentReference,
        application.schemeId,
      );

      if (portalStatus && this.mapsToNewStatus(portalStatus.status, application.status)) {
        await this.applyGovernmentStatusUpdate(application, portalStatus);
      }
    }

    const expectedCompletion = getExpectedCompletionDate(
      application.status,
      application.lastStatusChangeAt,
    );

    const overdue = isOverdue(application.status, application.lastStatusChangeAt);
    if (overdue) {
      logger.warn('Application overdue', {
        applicationId,
        status: application.status,
        lastChange: application.lastStatusChangeAt,
      });
    }

    return {
      application,
      history,
      expectedCompletionDate: expectedCompletion ?? undefined,
      isOverdue: overdue,
      allowedNextActions: getAllowedTransitions(application.status),
      progressPercentage: this.calculateProgress(application.status),
    };
  }

  // ─── Track by Reference Number ────────────────────────────────────────────

  async trackByReferenceNumber(referenceNumber: string): Promise<ApplicationSummary> {
    const application = await this.repo.findByReferenceNumber(referenceNumber);
    if (!application) {
      throw new ApplicationNotFoundError(referenceNumber);
    }
    return this.trackApplication(application.applicationId, application.userId);
  }

  // ─── Add Documents ────────────────────────────────────────────────────────
  // Used when government requests additional documents (DOCUMENTS_REQUIRED state).

  async addDocuments(
    applicationId: string,
    userId: string,
    documentIds: string[],
    userLanguage: SupportedLanguage,
    phoneNumber: string,
  ): Promise<Application> {
    const application = await this.getApplicationForUser(applicationId, userId);

    const updated = await this.repo.addDocuments(applicationId, documentIds);

    // If in DOCUMENTS_REQUIRED, transition back to UNDER_REVIEW
    if (application.status === ApplicationStatus.DOCUMENTS_REQUIRED) {
      assertValidTransition(applicationId, application.status, ApplicationStatus.UNDER_REVIEW);

      const resubmitted = await this.repo.updateStatus(
        applicationId,
        ApplicationStatus.UNDER_REVIEW,
      );

      const event = buildStatusEvent(
        applicationId,
        application.status,
        ApplicationStatus.UNDER_REVIEW,
        'user',
        `${documentIds.length} document(s) added`,
      );
      await this.repo.appendEvent(event);
      await notifyUserOfStatusChange(phoneNumber, resubmitted, event, userLanguage);

      return resubmitted;
    }

    return updated;
  }

  // ─── Withdraw Application ─────────────────────────────────────────────────

  async withdrawApplication(
    applicationId: string,
    userId: string,
    reason: string,
  ): Promise<Application> {
    const application = await this.getApplicationForUser(applicationId, userId);

    assertValidTransition(applicationId, application.status, ApplicationStatus.WITHDRAWN);

    const withdrawn = await this.repo.updateStatus(
      applicationId,
      ApplicationStatus.WITHDRAWN,
      { rejectionReason: reason },
    );

    const event = buildStatusEvent(
      applicationId,
      application.status,
      ApplicationStatus.WITHDRAWN,
      'user',
      reason,
    );
    await this.repo.appendEvent(event);

    logger.info('Application withdrawn', { applicationId, reason });
    return withdrawn;
  }

  // ─── Government Status Webhook (Req 6.5) ─────────────────────────────────
  // Called when government portals push status updates.

  async handleGovernmentStatusUpdate(
    governmentReference: string,
    newStatus: ApplicationStatus,
    details: {
      rejectionReason?: string;
      disbursementAmountINR?: number;
      disbursementDate?: Date;
      note?: string;
    },
    phoneNumber: string,
    userLanguage: SupportedLanguage,
  ): Promise<void> {
    // Find application by government reference
    const applications = await this.repo.findAllByUser('__gov_search__');
    // TODO: add findByGovernmentReference to repo
    // For now, log and continue
    logger.info('Government status update received', {
      governmentReference,
      newStatus,
      details,
    });
  }

  // ─── Get User Applications ────────────────────────────────────────────────

  async getApplicationsByUser(userId: string): Promise<Application[]> {
    return this.repo.findAllByUser(userId);
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async getApplicationForUser(
    applicationId: string,
    userId: string,
  ): Promise<Application> {
    const application = await this.repo.findById(applicationId);
    if (!application) {
      throw new ApplicationNotFoundError(applicationId);
    }
    if (application.userId !== userId) {
      throw new ApplicationNotFoundError(applicationId); // Don't leak existence
    }
    return application;
  }

  private async applyGovernmentStatusUpdate(
    application: Application,
    portalStatus: { status: string; message: string; updatedAt: Date },
  ): Promise<void> {
    const statusMap: Record<string, ApplicationStatus> = {
      APPROVED:  ApplicationStatus.APPROVED,
      REJECTED:  ApplicationStatus.REJECTED,
      DISBURSED: ApplicationStatus.DISBURSED,
      PENDING_DOCS: ApplicationStatus.DOCUMENTS_REQUIRED,
    };

    const mappedStatus = statusMap[portalStatus.status.toUpperCase()];
    if (!mappedStatus) return;

    try {
      assertValidTransition(application.applicationId, application.status, mappedStatus);
    } catch {
      return; // Already in this state or invalid — skip
    }

    await this.repo.updateStatus(application.applicationId, mappedStatus);

    const event = buildStatusEvent(
      application.applicationId,
      application.status,
      mappedStatus,
      'government',
      portalStatus.message,
    );
    await this.repo.appendEvent(event);
  }

  private mapsToNewStatus(
    portalStatus: string,
    currentStatus: ApplicationStatus,
  ): boolean {
    const statusMap: Record<string, ApplicationStatus> = {
      APPROVED: ApplicationStatus.APPROVED,
      REJECTED: ApplicationStatus.REJECTED,
      DISBURSED: ApplicationStatus.DISBURSED,
      PENDING_DOCS: ApplicationStatus.DOCUMENTS_REQUIRED,
    };
    const mapped = statusMap[portalStatus.toUpperCase()];
    return !!mapped && mapped !== currentStatus;
  }

  private calculateProgress(status: ApplicationStatus): number {
    const progressMap: Record<ApplicationStatus, number> = {
      [ApplicationStatus.DRAFT]:              10,
      [ApplicationStatus.SUBMITTED]:          30,
      [ApplicationStatus.UNDER_REVIEW]:       60,
      [ApplicationStatus.DOCUMENTS_REQUIRED]: 45,
      [ApplicationStatus.APPROVED]:           85,
      [ApplicationStatus.DISBURSED]:         100,
      [ApplicationStatus.REJECTED]:          100,
      [ApplicationStatus.WITHDRAWN]:         100,
    };
    return progressMap[status] ?? 0;
  }
}
