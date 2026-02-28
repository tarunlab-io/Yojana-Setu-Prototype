// ─── Base Error ───────────────────────────────────────────────────────────────

export class YojanaSetuError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

// ─── Validation Errors ────────────────────────────────────────────────────────

export class ValidationError extends YojanaSetuError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details);
  }
}

export class ProfileIncompleteError extends YojanaSetuError {
  constructor(missingFields: string[]) {
    super('User profile is incomplete', 'PROFILE_INCOMPLETE', 422, { missingFields });
  }
}

// ─── Not Found Errors ─────────────────────────────────────────────────────────

export class UserNotFoundError extends YojanaSetuError {
  constructor(identifier: string) {
    super(`User not found: ${identifier}`, 'USER_NOT_FOUND', 404);
  }
}

export class SchemeNotFoundError extends YojanaSetuError {
  constructor(schemeId: string) {
    super(`Scheme not found: ${schemeId}`, 'SCHEME_NOT_FOUND', 404);
  }
}

export class ApplicationNotFoundError extends YojanaSetuError {
  constructor(identifier: string) {
    super(`Application not found: ${identifier}`, 'APPLICATION_NOT_FOUND', 404);
  }
}

// ─── Document Errors ──────────────────────────────────────────────────────────

export class DocumentQualityError extends YojanaSetuError {
  constructor(issues: string[]) {
    super('Document quality is insufficient', 'DOCUMENT_QUALITY_ERROR', 422, { issues });
  }
}

export class DocumentExpiredError extends YojanaSetuError {
  constructor(documentType: string, expiryDate: Date) {
    super(`Document has expired: ${documentType}`, 'DOCUMENT_EXPIRED', 422, {
      documentType,
      expiryDate: expiryDate.toISOString(),
    });
  }
}

export class UnsupportedDocumentError extends YojanaSetuError {
  constructor(documentType: string) {
    super(`Unsupported document type: ${documentType}`, 'UNSUPPORTED_DOCUMENT', 400);
  }
}

// ─── External API Errors ──────────────────────────────────────────────────────

export class BhashiniAPIError extends YojanaSetuError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(`Bhashini API error: ${message}`, 'BHASHINI_API_ERROR', 503, details);
  }
}

export class WhatsAppAPIError extends YojanaSetuError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(`WhatsApp API error: ${message}`, 'WHATSAPP_API_ERROR', 503, details);
  }
}

export class OCREngineError extends YojanaSetuError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(`OCR engine error: ${message}`, 'OCR_ENGINE_ERROR', 503, details);
  }
}

export class OpenAIError extends YojanaSetuError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(`OpenAI API error: ${message}`, 'OPENAI_API_ERROR', 503, details);
  }
}

// ─── Auth Errors ──────────────────────────────────────────────────────────────

export class AuthenticationError extends YojanaSetuError {
  constructor(message = 'Authentication failed') {
    super(message, 'AUTHENTICATION_ERROR', 401);
  }
}

export class AuthorizationError extends YojanaSetuError {
  constructor(message = 'Insufficient permissions') {
    super(message, 'AUTHORIZATION_ERROR', 403);
  }
}

export class ConsentRequiredError extends YojanaSetuError {
  constructor(consentType: string) {
    super(`Consent required: ${consentType}`, 'CONSENT_REQUIRED', 403, { consentType });
  }
}

// ─── Rate Limit ───────────────────────────────────────────────────────────────

export class RateLimitError extends YojanaSetuError {
  constructor(retryAfterSeconds: number) {
    super('Rate limit exceeded', 'RATE_LIMIT_EXCEEDED', 429, { retryAfterSeconds });
  }
}

export class InvalidStatusTransitionError extends YojanaSetuError {
  constructor(applicationId: string, from: string, to: string) {
    super(
      `Invalid status transition for application ${applicationId}: ${from} → ${to}`,
      'INVALID_STATUS_TRANSITION',
    );
    this.statusCode = 409;
  }
}

export class DuplicateApplicationError extends YojanaSetuError {
  constructor(userId: string, schemeId: string) {
    super(
      `User ${userId} already has an active application for scheme ${schemeId}`,
      'DUPLICATE_APPLICATION',
    );
    this.statusCode = 409;
  }
}

export class GovernmentPortalError extends YojanaSetuError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'GOVERNMENT_PORTAL_ERROR');
    this.statusCode = 502;
    if (details) Object.assign(this, { details });
  }
}
