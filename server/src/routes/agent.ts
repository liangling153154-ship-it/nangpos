import { Router } from 'express';
import { z } from 'zod';
import { requireShopAgent } from '../services/auth.js';
import {
  ackPrintJob,
  getPendingPrintJobs,
  HttpError,
  recordPrintJobFailure,
} from '../services/orders.js';
import {
  buildServerTestTicket,
  enrichPrintJobForAgent,
} from '../services/receipt-renderer.js';

export const agentRouter = Router();

agentRouter.use(requireShopAgent);

agentRouter.get('/pending-jobs', async (_req, res, next) => {
  try {
    const jobs = (await getPendingPrintJobs()).map(enrichPrintJobForAgent);
    res.json({ jobs });
  } catch (err) {
    next(err);
  }
});

agentRouter.get('/test-ticket', (_req, res) => {
  res.json({ ticket: buildServerTestTicket() });
});

agentRouter.post('/print-jobs/:id/ack', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid print job id' });
      return;
    }
    const hostname =
      typeof req.body?.hostname === 'string'
        ? req.body.hostname.slice(0, 80)
        : 'windows-shop-pc';
    const result = await ackPrintJob(id, hostname);
    res.json({ ok: true, job: result.job, order: result.order });
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    next(err);
  }
});

agentRouter.post('/print-jobs/:id/fail', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const schema = z.object({ error: z.string().max(500) });
    const parsed = schema.safeParse(req.body);
    if (!Number.isInteger(id) || id <= 0 || !parsed.success) {
      res.status(400).json({ error: 'Invalid payload' });
      return;
    }
    await recordPrintJobFailure(id, parsed.data.error);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
