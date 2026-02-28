import express from 'express';
import { voiceRouter } from './routes/voice.routes';
import { logger } from './config/logger';

const app = express();
app.use(express.json({ limit: '50mb' })); // Large limit for base64 audio

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'voice-service' });
});

app.use('/voice', voiceRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error in voice-service', { error: err.message });
  res.status(500).json({ success: false, error: { message: err.message } });
});

const PORT = Number(process.env['PORT'] ?? 3003);
app.listen(PORT, () => {
  logger.info(`Voice service listening on port ${PORT}`);
});

export { app };
