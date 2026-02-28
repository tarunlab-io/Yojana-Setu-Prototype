import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { validateWebhookSignature } from '../clients/twilio.client';
import { routeMessage } from '../handlers/message-router';
import { logger } from '../config/logger';
import type { WhatsAppWebhook } from '@yojana-setu/shared';

export const webhookRouter = Router();

// ─── Rate Limiting (per phone number, in-memory for now) ─────────────────────

const messageTimestamps = new Map<string, number[]>();
const RATE_LIMIT = 30; // messages per hour per phone number
const RATE_WINDOW_MS = 60 * 60 * 1000;

function isRateLimited(phoneNumber: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_WINDOW_MS;
  const timestamps = (messageTimestamps.get(phoneNumber) ?? []).filter((t) => t > windowStart);
  timestamps.push(now);
  messageTimestamps.set(phoneNumber, timestamps);
  return timestamps.length > RATE_LIMIT;
}

// ─── POST /webhook ─────────────────────────────────────────────────────────
// Twilio sends WhatsApp messages here

webhookRouter.post('/', async (req: Request, res: Response) => {
  // Respond immediately — Twilio expects <5s response (Req 1.3)
  res.status(200).send('OK');

  try {
    // Validate webhook signature
    const signature = req.headers['x-twilio-signature'] as string ?? '';
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const isValid = validateWebhookSignature(signature, url, req.body as Record<string, string>);

    if (!isValid) {
      logger.warn('Invalid webhook signature — request dropped', { url });
      return;
    }

    // Parse the webhook body (Twilio sends form-encoded for WhatsApp)
    const body = req.body as Record<string, string>;
    const phoneNumber = body['From']?.replace('whatsapp:', '') ?? '';

    if (!phoneNumber) {
      logger.warn('Webhook missing From field', { body });
      return;
    }

    // Rate limit check
    if (isRateLimited(phoneNumber)) {
      logger.warn('Rate limit exceeded', { phoneNumber });
      return;
    }

    // Convert Twilio webhook to our WhatsApp webhook format
    const webhook: WhatsAppWebhook = twilioBodyToWebhook(body);

    // Get or create session
    const { getOrCreateSession } = await import('../services/session-manager');
    const session = await getOrCreateSession(phoneNumber);

    // Route and respond
    await routeMessage(webhook, session);

    logger.info('Webhook processed', { phoneNumber });

  } catch (err) {
    logger.error('Webhook processing error', {
      error: err instanceof Error ? err.message : 'Unknown',
    });
  }
});

// ─── GET /webhook ──────────────────────────────────────────────────────────
// Webhook verification (Twilio doesn't need this but WhatsApp Cloud API does)

webhookRouter.get('/', (req: Request, res: Response) => {
  res.send('Yojana-Setu WhatsApp Webhook Active');
});

// ─── Twilio → Internal Webhook Format Converter ───────────────────────────────

function twilioBodyToWebhook(body: Record<string, string>): WhatsAppWebhook {
  const from = body['From']?.replace('whatsapp:', '') ?? '';
  const messageSid = body['MessageSid'] ?? '';

  // Detect message type
  const numMedia = parseInt(body['NumMedia'] ?? '0', 10);
  const messageType = body['ButtonPayload']
    ? 'interactive'
    : numMedia > 0
    ? body['MediaContentType0']?.startsWith('audio') ? 'audio' : 'image'
    : 'text';

  const message: Record<string, unknown> = {
    id: messageSid,
    from,
    type: messageType,
    timestamp: Math.floor(Date.now() / 1000).toString(),
  };

  if (messageType === 'text') {
    message['text'] = { body: body['Body'] ?? '' };
  } else if (messageType === 'interactive') {
    message['interactive'] = {
      button_reply: { id: body['ButtonPayload'], title: body['ButtonText'] ?? '' },
    };
  } else if (messageType === 'audio' && body['MediaUrl0']) {
    message['audio'] = { id: body['MediaSid0'] ?? '', mime_type: body['MediaContentType0'] };
  } else if (messageType === 'image' && body['MediaUrl0']) {
    message['image'] = {
      id: body['MediaSid0'] ?? '',
      mime_type: body['MediaContentType0'],
      url: body['MediaUrl0'],
    };
  }

  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: body['AccountSid'] ?? '',
      changes: [{
        field: 'messages',
        value: {
          messages: [message as WhatsAppWebhook['entry'][0]['changes'][0]['value']['messages'][0]],
          contacts: [{ wa_id: from, profile: { name: body['ProfileName'] ?? '' } }],
        },
      }],
    }],
  };
}
