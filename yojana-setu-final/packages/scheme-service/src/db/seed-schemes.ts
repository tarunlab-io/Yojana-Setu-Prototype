/**
 * Seed data for government schemes database.
 * Run with: ts-node seed-schemes.ts
 *
 * Contains real central government schemes for demonstration purposes.
 * Eligibility criteria are approximate — always verify with official sources.
 */

import type { GovernmentScheme } from '@yojana-setu/shared';
import { SchemeStatus, SchemeCategory, Gender, CasteCategory } from '@yojana-setu/shared';

export const SEED_SCHEMES: Omit<GovernmentScheme, 'schemeId' | 'createdAt' | 'updatedAt'>[] = [
  {
    officialName: 'PM Kisan Samman Nidhi',
    popularName: 'PM Kisan',
    shortDescription: 'Direct income support of ₹6,000 per year to small and marginal farmers',
    fullDescription:
      'The PM-KISAN scheme provides income support to all landholding farmers\' families with cultivable land. The financial benefit of ₹6000 per year is transferred in three equal installments of ₹2000 each, directly to the bank accounts of the beneficiaries.',
    simplifiedExplanation:
      'If you are a farmer who owns farmland, the government gives you ₹6,000 every year directly to your bank account. The money comes in 3 payments of ₹2,000 each.',
    category: SchemeCategory.AGRICULTURE,
    level: 'central',
    ministry: 'Ministry of Agriculture and Farmers Welfare',
    status: SchemeStatus.ACTIVE,
    eligibilityCriteria: {
      employmentStatus: ['farmer'],
      additionalCriteria: {
        requiresLandOwnership: true,
        excludesInstitutionalLandholders: true,
      },
    },
    requiredDocuments: [
      { documentType: 'aadhaar', description: 'Aadhaar Card', isMandatory: true, acceptedFormats: ['jpg', 'png', 'pdf'], exampleDescription: 'Your blue Aadhaar card issued by UIDAI' },
      { documentType: 'land_record', description: 'Land Ownership Document (Khata/Patta)', isMandatory: true, acceptedFormats: ['jpg', 'png', 'pdf'], exampleDescription: 'Revenue department document showing you own farmland' },
      { documentType: 'bank_passbook', description: 'Bank Passbook (first page)', isMandatory: true, acceptedFormats: ['jpg', 'png', 'pdf'], exampleDescription: 'First page of passbook showing account number and IFSC' },
    ],
    benefitDetails: {
      benefitType: 'cash',
      estimatedValueINR: 6000,
      description: '₹6,000 per year in 3 installments of ₹2,000',
      disbursementMode: 'direct_bank_transfer',
    },
    applicationUrl: 'https://pmkisan.gov.in',
    officialNotificationUrl: 'https://pmkisan.gov.in',
    translations: {},
  },

  {
    officialName: 'Pradhan Mantri Matru Vandana Yojana',
    popularName: 'PMMVY',
    shortDescription: 'Maternity benefit of ₹5,000 for pregnant women and lactating mothers',
    fullDescription:
      'PMMVY provides cash incentive of ₹5,000 in three installments to pregnant women and lactating mothers for the first living child. The scheme aims to provide partial compensation for wage loss in terms of cash incentives.',
    simplifiedExplanation:
      'If you are pregnant for the first time, the government gives you ₹5,000. The money comes in 3 payments to support you during pregnancy and after childbirth.',
    category: SchemeCategory.WOMEN_AND_CHILD,
    level: 'central',
    ministry: 'Ministry of Women and Child Development',
    status: SchemeStatus.ACTIVE,
    eligibilityCriteria: {
      eligibleGenders: [Gender.FEMALE],
      ageRange: { min: 19 },
      incomeRange: { maxINR: 800000 },
    },
    requiredDocuments: [
      { documentType: 'aadhaar', description: 'Aadhaar Card', isMandatory: true, acceptedFormats: ['jpg', 'png', 'pdf'] },
      { documentType: 'bank_passbook', description: 'Bank Passbook', isMandatory: true, acceptedFormats: ['jpg', 'png', 'pdf'] },
      { documentType: 'birth_certificate', description: 'MCP Card (Mother and Child Protection Card)', isMandatory: true, acceptedFormats: ['jpg', 'png', 'pdf'] },
    ],
    benefitDetails: {
      benefitType: 'cash',
      estimatedValueINR: 5000,
      description: '₹5,000 in three installments during pregnancy and after delivery',
      disbursementMode: 'direct_bank_transfer',
    },
    applicationUrl: 'https://wcd.nic.in/schemes/pradhan-mantri-matru-vandana-yojana',
    translations: {},
  },

  {
    officialName: 'PM Awas Yojana - Gramin',
    popularName: 'PMAY-G',
    shortDescription: 'Financial assistance to rural households for construction of pucca house',
    fullDescription:
      'PM Awas Yojana (Gramin) provides financial assistance to BPL households in rural areas for construction of a pucca house with basic amenities. Beneficiaries get ₹1.20 lakh in plains and ₹1.30 lakh in hill states/north-east.',
    simplifiedExplanation:
      'If you live in a village and do not have a good house, the government will give you ₹1,20,000 to build one. You must be from a poor family (BPL) and should not already own a pucca house.',
    category: SchemeCategory.HOUSING,
    level: 'central',
    ministry: 'Ministry of Rural Development',
    status: SchemeStatus.ACTIVE,
    eligibilityCriteria: {
      requiresBPL: true,
      incomeRange: { maxINR: 300000 },
      eligibleCasteCategories: [CasteCategory.SC, CasteCategory.ST, CasteCategory.OBC, CasteCategory.EWS, CasteCategory.GENERAL],
      additionalCriteria: {
        requiresRuralResidence: true,
        mustNotOwnPuccaHouse: true,
      },
    },
    requiredDocuments: [
      { documentType: 'aadhaar', description: 'Aadhaar Card', isMandatory: true, acceptedFormats: ['jpg', 'png', 'pdf'] },
      { documentType: 'income_certificate', description: 'BPL Certificate or Income Certificate', isMandatory: true, acceptedFormats: ['jpg', 'png', 'pdf'] },
      { documentType: 'bank_passbook', description: 'Bank Passbook (linked to Aadhaar)', isMandatory: true, acceptedFormats: ['jpg', 'png', 'pdf'] },
      { documentType: 'land_record', description: 'Land ownership/allotment documents', isMandatory: false, acceptedFormats: ['jpg', 'png', 'pdf'] },
    ],
    benefitDetails: {
      benefitType: 'cash',
      estimatedValueINR: 120000,
      description: '₹1,20,000 for plain areas; ₹1,30,000 for hilly/north-east states',
      disbursementMode: 'direct_bank_transfer',
    },
    applicationUrl: 'https://pmayg.nic.in',
    translations: {},
  },

  {
    officialName: 'Ayushman Bharat Pradhan Mantri Jan Arogya Yojana',
    popularName: 'PM-JAY / Ayushman Card',
    shortDescription: 'Free health insurance of ₹5 lakh per family per year for secondary and tertiary care',
    fullDescription:
      'AB PM-JAY provides health cover of ₹5 lakh per family per year for secondary and tertiary care hospitalisation to the bottom 50 crore (500 million) poor and vulnerable families of India. The scheme covers pre and post-hospitalisation expenses.',
    simplifiedExplanation:
      'If you are from a poor family, you get a free Ayushman Card that lets you get hospital treatment worth up to ₹5,00,000 every year without paying anything. You can use it at government and empanelled private hospitals.',
    category: SchemeCategory.HEALTH,
    level: 'central',
    ministry: 'Ministry of Health and Family Welfare',
    status: SchemeStatus.ACTIVE,
    eligibilityCriteria: {
      requiresBPL: false, // Based on SECC 2011 data, not just BPL card
      incomeRange: { maxINR: 300000 },
      additionalCriteria: {
        basedOnSECC2011: true,
        coversEntireFamily: true,
      },
    },
    requiredDocuments: [
      { documentType: 'aadhaar', description: 'Aadhaar Card (any family member)', isMandatory: true, acceptedFormats: ['jpg', 'png', 'pdf'] },
      { documentType: 'ration_card', description: 'Ration Card', isMandatory: false, acceptedFormats: ['jpg', 'png', 'pdf'] },
    ],
    benefitDetails: {
      benefitType: 'insurance',
      estimatedValueINR: 500000,
      description: '₹5 lakh health insurance per family per year for hospitalisation',
      disbursementMode: 'in_kind',
    },
    applicationUrl: 'https://pmjay.gov.in',
    translations: {},
  },

  {
    officialName: 'National Scholarship Portal - Post Matric Scholarship for SC Students',
    popularName: 'Post Matric Scholarship SC',
    shortDescription: 'Scholarship for SC students pursuing post-matriculation courses',
    fullDescription:
      'This scholarship provides financial assistance to Scheduled Caste students studying in Class 11 and above (post-matric) to enable them to complete their education. The amount varies from ₹1,200 to ₹20,000 per year depending on the course.',
    simplifiedExplanation:
      'If you belong to SC category and are studying in Class 11, college, or doing any course after 10th, you can get money from the government to support your studies.',
    category: SchemeCategory.EDUCATION,
    level: 'central',
    ministry: 'Ministry of Social Justice and Empowerment',
    status: SchemeStatus.ACTIVE,
    eligibilityCriteria: {
      eligibleCasteCategories: [CasteCategory.SC],
      incomeRange: { maxINR: 250000 },
      ageRange: { min: 14, max: 35 },
      requiredEducationLevel: 'higher_secondary',
      employmentStatus: ['student'],
    },
    requiredDocuments: [
      { documentType: 'aadhaar', description: 'Aadhaar Card', isMandatory: true, acceptedFormats: ['jpg', 'png', 'pdf'] },
      { documentType: 'caste_certificate', description: 'Caste Certificate (SC)', isMandatory: true, acceptedFormats: ['jpg', 'png', 'pdf'], exampleDescription: 'Certificate issued by Revenue/SDM office confirming SC category' },
      { documentType: 'income_certificate', description: 'Family Income Certificate', isMandatory: true, acceptedFormats: ['jpg', 'png', 'pdf'] },
      { documentType: 'educational_certificate', description: 'Previous year marksheet', isMandatory: true, acceptedFormats: ['jpg', 'png', 'pdf'] },
      { documentType: 'bank_passbook', description: 'Bank Passbook', isMandatory: true, acceptedFormats: ['jpg', 'png', 'pdf'] },
    ],
    benefitDetails: {
      benefitType: 'scholarship',
      estimatedValueINR: 12000,
      description: '₹1,200 to ₹20,000 per year depending on course level',
      disbursementMode: 'direct_bank_transfer',
    },
    applicationUrl: 'https://scholarships.gov.in',
    translations: {},
  },
];
