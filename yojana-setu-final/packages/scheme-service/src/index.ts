import express from 'express';
import { schemeRouter } from './routes/scheme.routes';
import { logger } from './config/logger';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'scheme-service' });
});

app.use('/schemes', schemeRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error in scheme-service', { error: err.message });
  res.status(500).json({ success: false, error: { message: err.message } });
});

const PORT = Number(process.env['PORT'] ?? 3002);
app.listen(PORT, () => {
  logger.info(`Scheme service listening on port ${PORT}`);
});

export { app };
