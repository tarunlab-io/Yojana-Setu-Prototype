import { Router } from 'express';
import type { Request, Response } from 'express';

export const healthRouter = Router();

healthRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'yojana-setu-gateway',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

healthRouter.get('/health/ready', (_req: Request, res: Response) => {
  // In future: check DB, Redis, external APIs
  res.json({ status: 'ready' });
});
