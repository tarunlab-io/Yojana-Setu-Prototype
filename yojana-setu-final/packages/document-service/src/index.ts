import express from 'express';
import { documentRouter } from './routes/document.routes';
import { logger } from './config/logger';

const app = express();
app.use(express.json({ limit: '20mb' })); // Large limit for base64 document images

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'document-service' });
});

app.use('/documents', documentRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error in document-service', { error: err.message });
  res.status(500).json({ success: false, error: { message: err.message } });
});

const PORT = Number(process.env['PORT'] ?? 3004);
app.listen(PORT, () => {
  logger.info(`Document service listening on port ${PORT}`);
});

export { app };
