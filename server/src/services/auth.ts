import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

export const ADMIN_COOKIE_NAME = 'nang_admin_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Simple login rate limiter by IP
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

export function checkLoginRateLimit(ip: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || rec.resetAt < now) {
    return { allowed: true };
  }
  if (rec.count >= 8) {
    return { allowed: false, retryAfterSec: Math.ceil((rec.resetAt - now) / 1000) };
  }
  return { allowed: true };
}

export function recordFailedLogin(ip: string): void {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || rec.resetAt < now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
  } else {
    rec.count += 1;
  }
}

export function clearFailedLogins(ip: string): void {
  loginAttempts.delete(ip);
}

function timingSafeStrEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function verifyAdminCredentials(username: string, password: string): boolean {
  const uOk = timingSafeStrEqual(username.trim(), config.adminUsername);
  const pOk = timingSafeStrEqual(password, config.adminPassword);
  return uOk && pOk;
}

export function verifyShopAgentSecret(secret: string): boolean {
  if (!secret) return false;
  return timingSafeStrEqual(secret, config.shopAgentSecret);
}

export function createSessionToken(username: string): string {
  const payload = Buffer.from(
    JSON.stringify({ u: username, exp: Date.now() + SESSION_TTL_MS })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySessionToken(token: string | undefined): { username: string } | null {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(payload)
    .digest('base64url');
  if (!timingSafeStrEqual(sig, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      u: string;
      exp: number;
    };
    if (!parsed.u || typeof parsed.exp !== 'number' || parsed.exp < Date.now()) {
      return null;
    }
    return { username: parsed.u };
  } catch {
    return null;
  }
}

export function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = val;
  }
  return out;
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[ADMIN_COOKIE_NAME] as string | undefined;
  const session = verifySessionToken(token);
  if (!session) {
    res.status(401).json({ error: 'Vui lòng đăng nhập trang quản lý.' });
    return;
  }
  (req as any).adminUser = session.username;
  next();
}

export function requireShopAgent(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('x-agent-secret') || '';
  const authHeader = req.header('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const token = header || bearer;
  if (!verifyShopAgentSecret(token)) {
    res.status(401).json({ error: 'Unauthorized shop agent' });
    return;
  }
  next();
}
