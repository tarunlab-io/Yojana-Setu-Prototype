import type { SupportedLanguage, UserIntent, ConversationStage, Channel, MediaType, NotificationType } from '../enums';

// ─── WhatsApp Message Types ───────────────────────────────────────────────────

export type WhatsAppMessageType = 'text' | 'audio' | 'image' | 'document' | 'template' | 'interactive';

export interface WhatsAppTextMessage {
  type: 'text';
  body: string;
}

export interface WhatsAppAudioMessage {
  type: 'audio';
  /** Media ID from WhatsApp */
  mediaId: string;
  mimeType: MediaType;
}

export interface WhatsAppDocumentMessage {
  type: 'document';
  mediaId: string;
  mimeType: MediaType;
  filename?: string;
}

export interface WhatsAppImageMessage {
  type: 'image';
  mediaId: string;
  mimeType: MediaType;
  caption?: string;
}

export interface WhatsAppTemplateMessage {
  type: 'template';
  templateName: string;
  languageCode: string;
  parameters: Array<{ type: 'text' | 'currency' | 'date_time'; text?: string; value?: number }>;
}

export type WhatsAppMessage =
  | WhatsAppTextMessage
  | WhatsAppAudioMessage
  | WhatsAppDocumentMessage
  | WhatsAppImageMessage
  | WhatsAppTemplateMessage;

// ─── Webhook Types ────────────────────────────────────────────────────────────

export interface WhatsAppWebhookContact {
  waId: string;
  profile: { name: string };
}

export interface WhatsAppWebhookMessage {
  id: string;
  from: string;
  timestamp: string;
  type: WhatsAppMessageType;
  text?: { body: string };
  audio?: { id: string; mimeType: string };
  document?: { id: string; mimeType: string; filename?: string };
  image?: { id: string; mimeType: string; caption?: string };
}

export interface WhatsAppWebhook {
  object: 'whatsapp_business_account';
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messagingProduct: string;
        metadata: { displayPhoneNumber: string; phoneNumberId: string };
        contacts?: WhatsAppWebhookContact[];
        messages?: WhatsAppWebhookMessage[];
        statuses?: Array<{ id: string; status: string; timestamp: string; recipientId: string }>;
      };
      field: string;
    }>;
  }>;
}

export interface MessageResult {
  messageId: string;
  status: 'sent' | 'failed';
  timestamp: Date;
  errorDetails?: string;
}

// ─── Conversation State ───────────────────────────────────────────────────────

export interface ConversationTurn {
  timestamp: Date;
  userInput: string;
  systemResponse: string;
  intent: UserIntent;
  confidence: number;
  language: SupportedLanguage;
}

export interface ConversationContext {
  currentIntent: UserIntent;
  language: SupportedLanguage;
  conversationStage: ConversationStage;
  /** Data collected during this conversation */
  collectedData: Record<string, unknown>;
  /** Currently selected scheme ID, if any */
  activeSchemeId?: string;
  /** Pending document types still needed */
  pendingDocuments?: string[];
}

export interface ConversationState {
  sessionId: string;
  userId: string;
  phoneNumber: string;
  channel: Channel;
  context: ConversationContext;
  history: ConversationTurn[];
  metadata: {
    startedAt: Date;
    lastActivity: Date;
    isActive: boolean;
    /** Total message count in this session */
    messageCount: number;
  };
}

// ─── Notification ─────────────────────────────────────────────────────────────

export interface Notification {
  notificationId: string;
  userId: string;
  phoneNumber: string;
  type: NotificationType;
  channel: Channel;
  message: string;
  templateName?: string;
  scheduledAt?: Date;
  sentAt?: Date;
  status: 'pending' | 'sent' | 'failed' | 'delivered';
  metadata?: Record<string, unknown>;
}
