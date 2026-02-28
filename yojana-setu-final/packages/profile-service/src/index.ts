import express from 'express';
import { profileRouter } from './routes/profile.routes';
import { logger } from './config/logger';
import { closePool } from './db/pg-client';

const app = express();

app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'profile-service' });
});

// Profile routes
app.use('/profiles', profileRouter);

// Error handling — imported from gateway in full setup; local stub here
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error in profile-service', { error: err.message });
  res.status(500).json({ success: false, error: { message: err.message } });
});

const PORT = Number(process.env['PORT'] ?? 3001);
const server = app.listen(PORT, () => {
  logger.info(`Profile service listening on port ${PORT}`);
});

process.on('SIGTERM', () => {
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
});

export { app };
