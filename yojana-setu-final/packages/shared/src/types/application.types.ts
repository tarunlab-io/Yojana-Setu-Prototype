import type { ApplicationStatus, Channel } from '../enums';

// ─── Application ──────────────────────────────────────────────────────────────

export interface ApplicationStatusHistory {
  status: ApplicationStatus;
  timestamp: Date;
  note?: string;
  updatedBy: 'system' | 'admin' | 'external_integration';
}

export interface Application {
  applicationId: string;
  /** Human-readable tracking reference, e.g. YS-2024-00001 */
  trackingReference: string;
  userId: string;
  schemeId: string;
  status: ApplicationStatus;
  statusHistory: ApplicationStatusHistory[];
  /** IDs of documents submitted with this application */
  submittedDocumentIds: string[];
  /** Rejection reason if status is REJECTED */
  rejectionReason?: string;
  /** Corrective actions if rejected */
  correctiveActions?: string[];
  /** Next steps if approved */
  nextSteps?: string[];
  /** Expected disbursement date if approved */
  expectedDisbursementDate?: Date;
  submittedAt: Date;
  updatedAt: Date;
  /** External reference from government portal */
  externalReferenceId?: string;
  /** Which channel the user prefers for status updates */
  notificationChannel: Channel;
}

export type ApplicationSummary = Pick<
  Application,
  'applicationId' | 'trackingReference' | 'schemeId' | 'status' | 'submittedAt' | 'updatedAt'
>;

// ─── Extended types for application-service ───────────────────────────────────

export enum ApplicationEventType {
  SUBMITTED           = 'submitted',
  REVIEW_STARTED      = 'review_started',
  DOCUMENTS_REQUESTED = 'documents_requested',
  APPROVED            = 'approved',
  REJECTED            = 'rejected',
  DISBURSED           = 'disbursed',
  WITHDRAWN           = 'withdrawn',
  STATUS_CHANGED      = 'status_changed',
}

export interface ApplicationEvent {
  eventId: string;
  applicationId: string;
  eventType: ApplicationEventType;
  fromStatus: import('../enums').ApplicationStatus | null;
  toStatus: import('../enums').ApplicationStatus;
  triggeredBy: 'user' | 'system' | 'government';
  note: string | null;
  occurredAt: Date;
}

export interface GovernmentPortalSubmission {
  applicantMobile: string;
  aadhaarNumber: string;
  formData: Record<string, unknown>;
  documentRefs: string[];
}

export interface GovernmentPortalResponse {
  success: boolean;
  governmentReferenceNumber: string | null;
  message: string;
  nextSteps: string[];
  submittedAt: Date;
  submissionChannel: 'umang_api' | 'csc_queue' | 'manual';
}

// Extended Application shape used by application-service
export interface ApplicationFull {
  applicationId: string;
  userId: string;
  schemeId: string;
  referenceNumber: string;
  status: import('../enums').ApplicationStatus;
  submittedAt?: Date;
  lastStatusChangeAt: Date;
  documentIds: string[];
  formData: Record<string, unknown>;
  governmentReference?: string;
  rejectionReason?: string;
  disbursementAmountINR?: number;
  disbursementDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApplicationFullSummary {
  application: ApplicationFull;
  history: ApplicationEvent[];
  expectedCompletionDate?: Date;
  isOverdue: boolean;
  allowedNextActions: import('../enums').ApplicationStatus[];
  progressPercentage: number;
}

export interface IApplicationService {
  startApplication(
    userId: string, schemeId: string, documentIds: string[], formData: Record<string, unknown>,
  ): Promise<ApplicationFull>;
  getApplicationsByUser(userId: string): Promise<ApplicationFull[]>;
}
