import express from 'express';
import { applicationRouter } from './routes/application.routes';
import { logger } from './config/logger';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'application-service' });
});

app.use('/applications', applicationRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err.message });
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  res.status(status).json({ success: false, error: { message: err.message } });
});

const PORT = Number(process.env['PORT'] ?? 3006);
app.listen(PORT, () => logger.info(`Application service listening on port ${PORT}`));

export { app };
