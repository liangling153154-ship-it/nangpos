import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolve repo root cleanly whether running via tsx (server/src) or compiled tsc (server/dist/server/src)
const repoRoot = fs.existsSync(path.resolve(__dirname, '../../client'))
  ? path.resolve(__dirname, '../..')
  : path.resolve(__dirname, '../../../..');

// Load .env from repo root, server/, or current working directory (without overriding existing OS/Railway env vars)
for (const envPath of [
  path.join(repoRoot, '.env'),
  path.join(repoRoot, 'server', '.env'),
  path.resolve(process.cwd(), '.env'),
]) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, ''),

  databaseUrl: process.env.DATABASE_URL || '',
  pgliteDir: process.env.PGLITE_DIR || path.join(repoRoot, 'data', 'pgdata'),

  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'nangcafe2026',
  sessionSecret:
    process.env.SESSION_SECRET ||
    'dev-only-session-secret-please-set-in-railway-env-32chars',
  shopAgentSecret:
    process.env.SHOP_AGENT_SECRET || 'dev-only-shop-agent-secret-change-me',

  vietqr: {
    bankBin: process.env.VIETQR_BANK_BIN || '970418',
    bankName: process.env.VIETQR_BANK_NAME || 'BIDV - CN Cao Bằng',
    accountNo: process.env.VIETQR_ACCOUNT_NO || '',
    accountName: process.env.VIETQR_ACCOUNT_NAME || 'HO KINH DOANH NANG CAFE',
  },

  ntfy: {
    baseUrl: (process.env.NTFY_BASE_URL || 'https://ntfy.sh').replace(/\/$/, ''),
    topic: process.env.NTFY_TOPIC || '',
    token: process.env.NTFY_TOKEN || '',
  },

  printUnpaidTransfer: envBool('PRINT_UNPAID_TRANSFER', false),
  sepayWebhookSecret: process.env.SEPAY_WEBHOOK_SECRET || '',
};

export function validateProdConfig(): void {
  const warnings: string[] = [];
  const fatalErrors: string[] = [];

  if (!config.vietqr.accountNo) {
    warnings.push('VIETQR_ACCOUNT_NO chưa được cấu hình — đơn chuyển khoản sẽ không tạo được mã QR thật.');
  }
  if (!config.ntfy.topic) {
    warnings.push('NTFY_TOPIC chưa được cấu hình — thông báo sang điện thoại chủ quán đang tạm tắt.');
  }
  if (config.isProd) {
    if (!process.env.ADMIN_PASSWORD || config.adminPassword === 'nangcafe2026') {
      fatalErrors.push('ADMIN_PASSWORD thiếu hoặc đang dùng mật khẩu mặc định trong production!');
    }
    if (
      !process.env.SESSION_SECRET ||
      config.sessionSecret.startsWith('dev-only-') ||
      config.sessionSecret.length < 16
    ) {
      fatalErrors.push('SESSION_SECRET thiếu, ngắn hơn 16 ký tự hoặc đang dùng giá trị mặc định!');
    }
    if (
      !process.env.SHOP_AGENT_SECRET ||
      config.shopAgentSecret.startsWith('dev-only-') ||
      config.shopAgentSecret.length < 12
    ) {
      fatalErrors.push('SHOP_AGENT_SECRET thiếu, ngắn hơn 12 ký tự hoặc đang dùng giá trị mặc định!');
    }
  }

  for (const w of warnings) {
    console.warn(`[Nâng Café Config] ${w}`);
  }
  if (fatalErrors.length > 0) {
    for (const e of fatalErrors) {
      console.error(`[Nâng Café Security FATAL] ${e}`);
    }
    throw new Error('Refusing to start in production with missing or insecure secrets.');
  }
}
