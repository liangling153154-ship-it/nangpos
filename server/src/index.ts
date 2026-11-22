import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { config, validateProdConfig } from './config.js';
import { initDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { seedDatabase } from './db/seed.js';
import { publicRouter } from './routes/public.js';
import { adminRouter } from './routes/admin.js';
import { agentRouter } from './routes/agent.js';
import { webhooksRouter } from './routes/webhooks.js';
import { realtimeHub } from './services/ws.js';
import { getPendingPrintJobs, verifyOrderPublicToken } from './services/orders.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Works for both tsx (`server/src`) and compiled tsc (`server/dist/server/src`)
const repoRoot = fs.existsSync(path.resolve(__dirname, '../../client'))
  ? path.resolve(__dirname, '../..')
  : path.resolve(__dirname, '../../../..');
const clientDistDir = path.join(repoRoot, 'client', 'dist');

export async function startServer() {
  validateProdConfig();
  const db = await initDb();
  await runMigrations();
  await seedDatabase();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Required behind Railway TLS reverse proxy for Secure cookies & IP rate limiting
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Security headers (HSTS, CSP, Permissions-Policy, anti-sniff, clickjacking)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=()'
    );
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "media-src 'self'",
        "connect-src 'self' ws: wss:",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'self'",
      ].join('; ')
    );
    if (config.isProd) {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains'
      );
    }
    next();
  });

  // API routes
  app.use('/api', publicRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/agent', agentRouter);
  app.use('/api/webhooks', webhooksRouter);

  // Serve built frontend PWA & Admin SPA
  if (fs.existsSync(clientDistDir)) {
    app.use(
      express.static(clientDistDir, {
        maxAge: config.isProd ? '7d' : 0,
        setHeaders(res, filePath) {
          if (filePath.endsWith('sw.js') || filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );

    // SPA fallback for / and /admin (anything not under /api or /ws)
    app.get(/^\/(?!api|ws).*/, (_req, res) => {
      res.sendFile(path.join(clientDistDir, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.send(
        'Nâng Café API đang chạy. Chạy `npm run build:client` hoặc dùng Vite dev server tại cổng 5173.'
      );
    });
  }

  // Error handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Server Error]', err);
    res.status(500).json({ error: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại.' });
  });

  const server = http.createServer(app);

  // Attach WebSocket hub with agent pending-job sync + customer token verification
  realtimeHub.attach(server, {
    onAgentConnected: async (agentWs) => {
      const pending = await getPendingPrintJobs();
      if (pending.length > 0) {
        console.log(`[WS] Pushing ${pending.length} pending print job(s) to reconnected Shop Agent`);
        realtimeHub.pushPendingJobsToAgent(agentWs, pending);
      }
    },
    verifyCustomerToken: verifyOrderPublicToken,
  });

  await new Promise<void>((resolve) => {
    server.listen(config.port, '0.0.0.0', () => {
      console.log(`[Nâng Café] Server running on http://0.0.0.0:${config.port} (${config.nodeEnv})`);
      resolve();
    });
  });

  const shutdown = async () => {
    console.log('[Nâng Café] Shutting down...');
    server.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { app, server, db };
}

startServer().catch((err) => {
  console.error('[Nâng Café] Fatal startup error:', err);
  process.exit(1);
});
