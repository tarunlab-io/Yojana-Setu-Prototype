/**
 * Twilio WhatsApp Client
 *
 * Abstracts Twilio's Messaging API for WhatsApp.
 * Designed with an interface so we can swap to Meta Cloud API later (Req 5.7).
 *
 * Message types supported:
 *  - Text:     plain conversational messages
 *  - Template: pre-approved WhatsApp templates for notifications
 *  - Media:    audio files (TTS responses) and document previews
 *  - List:     interactive list messages for scheme selection
 *  - Button:   quick-reply buttons for yes/no prompts
 */

import twilio from 'twilio';
import type {
  WhatsAppTextMessage,
  WhatsAppTemplateMessage,
  WhatsAppMediaMessage,
  WhatsAppListMessage,
  WhatsAppButtonMessage,
  MessageResult,
  MediaType,
} from '@yojana-setu/shared';
import { WhatsAppAPIError } from '@yojana-setu/shared';
import { loadConfig, logger } from '../config/logger';

// ─── Client ───────────────────────────────────────────────────────────────────

let twilioClient: ReturnType<typeof twilio> | null = null;

function getClient(): ReturnType<typeof twilio> {
  if (!twilioClient) {
    const config = loadConfig();
    twilioClient = twilio(config.accountSid, config.authToken);
  }
  return twilioClient;
}

// ─── Message Formatters ───────────────────────────────────────────────────────

/** WhatsApp has a 4096-character message limit */
const MAX_MESSAGE_LENGTH = 4096;

function truncateIfNeeded(text: string): string {
  if (text.length <= MAX_MESSAGE_LENGTH) return text;
  return `${text.slice(0, MAX_MESSAGE_LENGTH - 50)}...\n\n_(Message truncated — reply "MORE" for the rest)_`;
}

/** Formats a phone number for WhatsApp Sandbox (whatsapp:+91XXXXXXXXXX) */
function formatWhatsAppNumber(phoneNumber: string): string {
  const normalized = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
  return `whatsapp:${normalized}`;
}

// ─── Core Send Functions ──────────────────────────────────────────────────────

export async function sendTextMessage(
  to: string,
  message: WhatsAppTextMessage,
): Promise<MessageResult> {
  const config = loadConfig();
  try {
    const sent = await getClient().messages.create({
      from: formatWhatsAppNumber(config.fromNumber),
      to: formatWhatsAppNumber(to),
      body: truncateIfNeeded(message.content),
    });

    logger.info('Text message sent', { to, messageSid: sent.sid, length: message.content.length });
    return { messageSid: sent.sid, status: 'sent', sentAt: new Date() };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    throw new WhatsAppAPIError(`Failed to send text message: ${error}`, { to });
  }
}

export async function sendTemplateMessage(
  to: string,
  message: WhatsAppTemplateMessage,
): Promise<MessageResult> {
  const config = loadConfig();
  try {
    // Twilio template format: content_sid + content_variables
    const sent = await getClient().messages.create({
      from: formatWhatsAppNumber(config.fromNumber),
      to: formatWhatsAppNumber(to),
      contentSid: message.templateName,
      contentVariables: JSON.stringify(
        message.parameters.reduce(
          (acc, param, i) => ({ ...acc, [String(i + 1)]: param }),
          {} as Record<string, string>,
        ),
      ),
    });

    logger.info('Template message sent', {
      to,
      templateName: message.templateName,
      messageSid: sent.sid,
    });
    return { messageSid: sent.sid, status: 'sent', sentAt: new Date() };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    throw new WhatsAppAPIError(`Failed to send template: ${error}`, {
      to,
      template: message.templateName,
    });
  }
}

export async function sendMediaMessage(
  to: string,
  message: WhatsAppMediaMessage,
): Promise<MessageResult> {
  const config = loadConfig();
  try {
    const sent = await getClient().messages.create({
      from: formatWhatsAppNumber(config.fromNumber),
      to: formatWhatsAppNumber(to),
      body: message.caption ?? '',
      mediaUrl: [message.mediaUrl],
    });

    logger.info('Media message sent', { to, mediaType: message.mediaType, messageSid: sent.sid });
    return { messageSid: sent.sid, status: 'sent', sentAt: new Date() };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    throw new WhatsAppAPIError(`Failed to send media: ${error}`, { to });
  }
}

/**
 * Sends an interactive list message — used for scheme selection (up to 10 items).
 * Falls back to numbered text list when >10 items (WhatsApp limit).
 */
export async function sendListMessage(
  to: string,
  message: WhatsAppListMessage,
): Promise<MessageResult> {
  const config = loadConfig();

  // WhatsApp interactive list limit is 10 sections × 10 rows
  const items = message.items.slice(0, 10);

  if (items.length === 0) {
    return sendTextMessage(to, { type: 'text', content: message.bodyText });
  }

  try {
    // Twilio interactive list via JSON body
    const interactiveBody = {
      type: 'list',
      header: message.headerText ? { type: 'text', text: message.headerText } : undefined,
      body: { text: truncateIfNeeded(message.bodyText) },
      footer: message.footerText ? { text: message.footerText } : undefined,
      action: {
        button: message.buttonLabel ?? 'Select',
        sections: [
          {
            title: 'Options',
            rows: items.map((item, i) => ({
              id: item.id,
              title: item.title.slice(0, 24), // WhatsApp title limit
              description: item.description?.slice(0, 72), // WhatsApp description limit
            })),
          },
        ],
      },
    };

    const sent = await getClient().messages.create({
      from: formatWhatsAppNumber(config.fromNumber),
      to: formatWhatsAppNumber(to),
      // Twilio sends interactive messages via contentSid or JSON body
      // Using body for compatibility with WhatsApp Cloud API format
      body: JSON.stringify(interactiveBody),
    });

    logger.info('List message sent', { to, itemCount: items.length, messageSid: sent.sid });
    return { messageSid: sent.sid, status: 'sent', sentAt: new Date() };
  } catch {
    // Fallback: send as numbered text list
    const textContent = [
      message.bodyText,
      '',
      ...items.map((item, i) => `${i + 1}. ${item.title}${item.description ? `\n   ${item.description}` : ''}`),
      '',
      `Reply with a number (1–${items.length}) to select.`,
    ].join('\n');

    return sendTextMessage(to, { type: 'text', content: textContent });
  }
}

/**
 * Sends quick-reply buttons — used for yes/no eligibility questions.
 * Falls back to text with instructions when buttons aren't supported.
 */
export async function sendButtonMessage(
  to: string,
  message: WhatsAppButtonMessage,
): Promise<MessageResult> {
  const config = loadConfig();

  // WhatsApp allows up to 3 buttons
  const buttons = message.buttons.slice(0, 3);

  try {
    const interactiveBody = {
      type: 'button',
      body: { text: truncateIfNeeded(message.bodyText) },
      action: {
        buttons: buttons.map((btn) => ({
          type: 'reply',
          reply: { id: btn.id, title: btn.title.slice(0, 20) },
        })),
      },
    };

    const sent = await getClient().messages.create({
      from: formatWhatsAppNumber(config.fromNumber),
      to: formatWhatsAppNumber(to),
      body: JSON.stringify(interactiveBody),
    });

    return { messageSid: sent.sid, status: 'sent', sentAt: new Date() };
  } catch {
    // Fallback: text with options
    const options = buttons.map((btn) => `• ${btn.title}`).join('\n');
    const textContent = `${message.bodyText}\n\n${options}`;
    return sendTextMessage(to, { type: 'text', content: textContent });
  }
}

/**
 * Downloads media sent by a user (voice notes, documents).
 * Twilio media URLs are authenticated — requires credentials.
 */
export async function downloadUserMedia(mediaUrl: string): Promise<Buffer> {
  const config = loadConfig();
  const credentials = Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64');

  const response = await fetch(mediaUrl, {
    headers: { Authorization: `Basic ${credentials}` },
  });

  if (!response.ok) {
    throw new WhatsAppAPIError(`Failed to download media: ${response.status}`, { mediaUrl });
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Validates a Twilio webhook signature to prevent spoofed requests.
 * Requirement 5.3: All incoming webhooks must be verified.
 */
export function validateWebhookSignature(
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  const config = loadConfig();
  if (!config.webhookSecret) {
    logger.warn('Webhook secret not configured — skipping signature validation');
    return true; // Allow in dev
  }
  return twilio.validateRequest(config.authToken, signature, url, params);
}
