import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { logger } from './config/logger';
import { requestLogger } from './middleware/request-logger';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { healthRouter } from './routes/health';

// ─── App Setup ────────────────────────────────────────────────────────────────

const app = express();

// Security headers
app.use(helmet());

// CORS - restrict in production
app.use(
  cors({
    origin: env.NODE_ENV === 'production' ? false : '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  }),
);

// Body parsing
app.use(express.json({ limit: '10mb' })); // 10mb for document uploads
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use(requestLogger);

// Rate limiting
const limiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please wait before trying again.',
    },
  },
});
app.use(limiter);

// ─── Routes ───────────────────────────────────────────────────────────────────

const apiPrefix = `/api/${env.API_VERSION}`;

// Health (no auth required)
app.use(apiPrefix, healthRouter);

// TODO (Task 7): Mount WhatsApp webhook routes
// app.use(`${apiPrefix}/whatsapp`, whatsappRouter);

// TODO (Task 2): Mount user profile routes
// app.use(`${apiPrefix}/profiles`, profileRouter);

// TODO (Task 3): Mount scheme routes
// app.use(`${apiPrefix}/schemes`, schemeRouter);

// TODO (Task 6): Mount document routes
// app.use(`${apiPrefix}/documents`, documentRouter);

// TODO (Task 9): Mount application tracking routes
// app.use(`${apiPrefix}/applications`, applicationRouter);

// ─── Error Handling ───────────────────────────────────────────────────────────

app.use(notFoundHandler);
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────

const server = app.listen(env.PORT, () => {
  logger.info(`🚀 Yojana-Setu Gateway started`, {
    port: env.PORT,
    environment: env.NODE_ENV,
    apiPrefix,
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed.');
    process.exit(0);
  });
});

export { app };
