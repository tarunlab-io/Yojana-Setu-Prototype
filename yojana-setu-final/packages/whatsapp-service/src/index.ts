import express from 'express';
import { webhookRouter } from './routes/webhook.routes';
import { logger } from './config/logger';

const app = express();

// Twilio sends webhooks as form-encoded AND JSON
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '5mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'whatsapp-service' });
});

app.use('/webhook', webhookRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error in whatsapp-service', { error: err.message });
  res.status(500).json({ success: false, error: { message: err.message } });
});

const PORT = Number(process.env['PORT'] ?? 3005);
app.listen(PORT, () => {
  logger.info(`WhatsApp service listening on port ${PORT}`);
});

export { app };
