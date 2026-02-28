/**
 * Indian Government Document Schemas
 *
 * Defines the expected fields, validation rules, and expiry logic
 * for every Indian document type supported by the platform.
 *
 * These schemas drive:
 *  - OCR field extraction targets
 *  - Missing field detection
 *  - Expiry date checking
 *  - Field-level confidence thresholds
 */

import { DocumentType } from '@yojana-setu/shared';

export interface FieldSchema {
  /** Field name used in extraction results */
  name: string;
  /** Human-readable label for user-facing messages */
  label: string;
  /** Whether this field is required for the document to be valid */
  required: boolean;
  /** Regex pattern the extracted value should match */
  pattern?: RegExp;
  /** Example of a valid value (shown to users in guidance) */
  example?: string;
}

export interface DocumentSchema {
  type: DocumentType;
  displayName: string;
  fields: FieldSchema[];
  /** Whether this document type has an expiry date */
  hasExpiry: boolean;
  /** Validity period in years (from issue date), if applicable */
  validityYears?: number;
  /** Minimum image quality score (0–1) to attempt OCR */
  minQualityScore: number;
  /** User guidance for taking a good photo */
  photoGuidance: string;
}

// ─── Document Schemas ─────────────────────────────────────────────────────────

export const DOCUMENT_SCHEMAS: Record<DocumentType, DocumentSchema> = {
  [DocumentType.AADHAAR]: {
    type: DocumentType.AADHAAR,
    displayName: 'Aadhaar Card',
    hasExpiry: false,
    minQualityScore: 0.6,
    photoGuidance:
      'Place your Aadhaar card on a flat surface in good light. Capture both sides. Ensure all 12 digits of the Aadhaar number are clearly visible.',
    fields: [
      {
        name: 'aadhaarNumber',
        label: 'Aadhaar Number',
        required: true,
        pattern: /^\d{4}\s?\d{4}\s?\d{4}$/,
        example: '1234 5678 9012',
      },
      { name: 'fullName', label: 'Full Name', required: true },
      { name: 'dateOfBirth', label: 'Date of Birth', required: true, example: '01/01/1990' },
      { name: 'gender', label: 'Gender', required: true, pattern: /^(MALE|FEMALE|TRANSGENDER)$/i },
      { name: 'address', label: 'Address', required: false },
    ],
  },

  [DocumentType.PAN]: {
    type: DocumentType.PAN,
    displayName: 'PAN Card',
    hasExpiry: false,
    minQualityScore: 0.65,
    photoGuidance:
      'Photograph your PAN card against a plain background. The 10-character PAN number at the top must be fully visible.',
    fields: [
      {
        name: 'panNumber',
        label: 'PAN Number',
        required: true,
        pattern: /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/,
        example: 'ABCDE1234F',
      },
      { name: 'fullName', label: 'Full Name', required: true },
      { name: 'dateOfBirth', label: 'Date of Birth', required: true },
      { name: 'fatherName', label: "Father's Name", required: false },
    ],
  },

  [DocumentType.VOTER_ID]: {
    type: DocumentType.VOTER_ID,
    displayName: 'Voter ID Card (EPIC)',
    hasExpiry: false,
    minQualityScore: 0.6,
    photoGuidance: 'Capture the front of your Voter ID card clearly. The EPIC number must be visible.',
    fields: [
      {
        name: 'epicNumber',
        label: 'EPIC Number',
        required: true,
        pattern: /^[A-Z]{3}[0-9]{7}$/,
        example: 'ABC1234567',
      },
      { name: 'fullName', label: 'Full Name', required: true },
      { name: 'dateOfBirth', label: 'Date of Birth', required: false },
      { name: 'address', label: 'Address', required: false },
    ],
  },

  [DocumentType.INCOME_CERTIFICATE]: {
    type: DocumentType.INCOME_CERTIFICATE,
    displayName: 'Income Certificate',
    hasExpiry: true,
    validityYears: 1,
    minQualityScore: 0.65,
    photoGuidance:
      'Capture the income certificate issued by the Revenue Department. The annual income amount, issue date, and official seal must be clearly visible.',
    fields: [
      { name: 'applicantName', label: 'Applicant Name', required: true },
      { name: 'annualIncome', label: 'Annual Income (₹)', required: true, example: '₹1,80,000' },
      { name: 'issueDate', label: 'Issue Date', required: true },
      { name: 'issuingAuthority', label: 'Issuing Authority', required: true },
      { name: 'certificateNumber', label: 'Certificate Number', required: false },
    ],
  },

  [DocumentType.CASTE_CERTIFICATE]: {
    type: DocumentType.CASTE_CERTIFICATE,
    displayName: 'Caste Certificate',
    hasExpiry: false,
    minQualityScore: 0.65,
    photoGuidance:
      'Photograph your caste certificate issued by the competent authority (SDM/Revenue Officer). All text must be legible.',
    fields: [
      { name: 'applicantName', label: 'Applicant Name', required: true },
      { name: 'casteCategory', label: 'Caste Category (SC/ST/OBC)', required: true, pattern: /^(SC|ST|OBC|EWS)$/i },
      { name: 'casteName', label: 'Caste Name', required: true },
      { name: 'issueDate', label: 'Issue Date', required: true },
      { name: 'issuingAuthority', label: 'Issuing Authority', required: true },
    ],
  },

  [DocumentType.BANK_PASSBOOK]: {
    type: DocumentType.BANK_PASSBOOK,
    displayName: 'Bank Passbook (First Page)',
    hasExpiry: false,
    minQualityScore: 0.6,
    photoGuidance:
      'Photograph the first page of your bank passbook showing Account Number, Account Holder Name, IFSC Code, and Bank Branch clearly.',
    fields: [
      { name: 'accountHolderName', label: 'Account Holder Name', required: true },
      {
        name: 'accountNumber',
        label: 'Account Number',
        required: true,
        pattern: /^\d{9,18}$/,
        example: '1234567890',
      },
      {
        name: 'ifscCode',
        label: 'IFSC Code',
        required: true,
        pattern: /^[A-Z]{4}0[A-Z0-9]{6}$/,
        example: 'SBIN0001234',
      },
      { name: 'bankName', label: 'Bank Name', required: true },
      { name: 'branchName', label: 'Branch Name', required: false },
    ],
  },

  [DocumentType.LAND_RECORD]: {
    type: DocumentType.LAND_RECORD,
    displayName: 'Land Record / Khata / Patta',
    hasExpiry: false,
    minQualityScore: 0.6,
    photoGuidance: 'Photograph the land record issued by the Revenue Department. The survey number and owner name must be visible.',
    fields: [
      { name: 'ownerName', label: 'Owner Name', required: true },
      { name: 'surveyNumber', label: 'Survey Number', required: true },
      { name: 'areaHectares', label: 'Land Area (Hectares)', required: false },
      { name: 'district', label: 'District', required: true },
    ],
  },

  [DocumentType.RATION_CARD]: {
    type: DocumentType.RATION_CARD,
    displayName: 'Ration Card',
    hasExpiry: false,
    minQualityScore: 0.6,
    photoGuidance: 'Photograph the front of your ration card clearly. The card number and family head name must be visible.',
    fields: [
      { name: 'rationCardNumber', label: 'Ration Card Number', required: true },
      { name: 'headOfFamily', label: 'Head of Family Name', required: true },
      { name: 'cardType', label: 'Card Type (APL/BPL/AAY)', required: false, pattern: /^(APL|BPL|AAY|PHH)$/i },
      { name: 'state', label: 'State', required: false },
    ],
  },

  [DocumentType.BIRTH_CERTIFICATE]: {
    type: DocumentType.BIRTH_CERTIFICATE,
    displayName: 'Birth Certificate',
    hasExpiry: false,
    minQualityScore: 0.65,
    photoGuidance: 'Photograph your birth certificate issued by a municipal body. Date of birth and name must be clearly legible.',
    fields: [
      { name: 'fullName', label: 'Full Name', required: true },
      { name: 'dateOfBirth', label: 'Date of Birth', required: true },
      { name: 'placeOfBirth', label: 'Place of Birth', required: false },
      { name: 'registrationNumber', label: 'Registration Number', required: false },
    ],
  },

  [DocumentType.DISABILITY_CERTIFICATE]: {
    type: DocumentType.DISABILITY_CERTIFICATE,
    displayName: 'Disability Certificate',
    hasExpiry: true,
    validityYears: 5,
    minQualityScore: 0.65,
    photoGuidance: 'Photograph the disability certificate issued by a government hospital. Disability percentage and type must be visible.',
    fields: [
      { name: 'applicantName', label: 'Applicant Name', required: true },
      { name: 'disabilityType', label: 'Type of Disability', required: true },
      {
        name: 'disabilityPercentage',
        label: 'Disability Percentage',
        required: true,
        pattern: /^\d{1,3}%?$/,
        example: '40%',
      },
      { name: 'issueDate', label: 'Issue Date', required: true },
      { name: 'issuingHospital', label: 'Issuing Hospital', required: true },
    ],
  },

  [DocumentType.PASSPORT]: {
    type: DocumentType.PASSPORT,
    displayName: 'Passport',
    hasExpiry: true,
    validityYears: 10,
    minQualityScore: 0.7,
    photoGuidance: 'Photograph the biographical data page of your passport. Passport number and expiry date must be visible.',
    fields: [
      { name: 'passportNumber', label: 'Passport Number', required: true, pattern: /^[A-Z][0-9]{7}$/, example: 'A1234567' },
      { name: 'fullName', label: 'Full Name', required: true },
      { name: 'dateOfBirth', label: 'Date of Birth', required: true },
      { name: 'expiryDate', label: 'Expiry Date', required: true },
      { name: 'nationality', label: 'Nationality', required: false },
    ],
  },

  [DocumentType.DRIVING_LICENSE]: {
    type: DocumentType.DRIVING_LICENSE,
    displayName: 'Driving Licence',
    hasExpiry: true,
    validityYears: 20,
    minQualityScore: 0.65,
    photoGuidance: 'Photograph the front of your driving licence. Licence number and validity must be visible.',
    fields: [
      { name: 'licenceNumber', label: 'Licence Number', required: true },
      { name: 'fullName', label: 'Full Name', required: true },
      { name: 'dateOfBirth', label: 'Date of Birth', required: true },
      { name: 'validityDate', label: 'Valid Until', required: true },
      { name: 'vehicleClasses', label: 'Vehicle Classes', required: false },
    ],
  },

  [DocumentType.DOMICILE_CERTIFICATE]: {
    type: DocumentType.DOMICILE_CERTIFICATE,
    displayName: 'Domicile Certificate',
    hasExpiry: true,
    validityYears: 3,
    minQualityScore: 0.65,
    photoGuidance: 'Photograph the domicile certificate issued by the Revenue Department. Applicant name, state, and issue date must be visible.',
    fields: [
      { name: 'applicantName', label: 'Applicant Name', required: true },
      { name: 'state', label: 'State of Domicile', required: true },
      { name: 'issueDate', label: 'Issue Date', required: true },
      { name: 'issuingAuthority', label: 'Issuing Authority', required: true },
    ],
  },

  [DocumentType.EDUCATIONAL_CERTIFICATE]: {
    type: DocumentType.EDUCATIONAL_CERTIFICATE,
    displayName: 'Educational Certificate / Marksheet',
    hasExpiry: false,
    minQualityScore: 0.6,
    photoGuidance: 'Photograph your certificate or marksheet clearly. Institution name, year of passing, and roll number must be visible.',
    fields: [
      { name: 'studentName', label: 'Student Name', required: true },
      { name: 'institutionName', label: 'Institution Name', required: true },
      { name: 'yearOfPassing', label: 'Year of Passing', required: true, pattern: /^\d{4}$/ },
      { name: 'examName', label: 'Examination Name', required: false },
      { name: 'rollNumber', label: 'Roll Number', required: false },
    ],
  },

  [DocumentType.OTHER]: {
    type: DocumentType.OTHER,
    displayName: 'Other Document',
    hasExpiry: false,
    minQualityScore: 0.5,
    photoGuidance: 'Photograph the document clearly ensuring all text is readable.',
    fields: [
      { name: 'documentTitle', label: 'Document Title', required: false },
      { name: 'issueDate', label: 'Issue Date', required: false },
    ],
  },
};
