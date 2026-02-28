import express from 'express';
import { privacyRouter } from './routes/privacy.routes';
import { logger } from './config/logger';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'privacy-service' });
});

app.use('/privacy', privacyRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error in privacy-service', { error: err.message });
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  res.status(status).json({ success: false, error: { message: err.message } });
});

const PORT = Number(process.env['PORT'] ?? 3007);
app.listen(PORT, () => logger.info(`Privacy service listening on port ${PORT}`));

export { app };
