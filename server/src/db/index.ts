import fs from 'node:fs';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { config } from '../config.js';

export interface DbClient {
  query<T extends QueryResultRow = any>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }>;
  exec(sql: string): Promise<void>;
}

export interface DbEngine extends DbClient {
  kind: 'pg' | 'pglite';
  transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

let dbInstance: DbEngine | null = null;

function shouldUseSsl(url: string): boolean | { rejectUnauthorized: false } {
  if (url.includes('sslmode=disable')) return false;
  if (url.includes('localhost') || url.includes('127.0.0.1') || url.includes('.railway.internal')) {
    return false;
  }
  return { rejectUnauthorized: false };
}

export async function initDb(): Promise<DbEngine> {
  if (dbInstance) return dbInstance;

  if (config.databaseUrl && !config.databaseUrl.startsWith('pglite://')) {
    const pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: shouldUseSsl(config.databaseUrl),
      max: 15,
      idleTimeoutMillis: 30_000,
    });
    // Quick connectivity check
    await pool.query('SELECT 1');
    console.log('[DB] Connected to PostgreSQL (pg.Pool)');

    dbInstance = {
      kind: 'pg',
      async query<T extends QueryResultRow = any>(sql: string, params?: any[]) {
        const res = await pool.query<T>(sql, params);
        return { rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
      },
      async exec(sql: string) {
        await pool.query(sql);
      },
      async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
        const client: PoolClient = await pool.connect();
        try {
          await client.query('BEGIN');
          const txClient: DbClient = {
            async query<R extends QueryResultRow = any>(sql: string, params?: any[]) {
              const res = await client.query<R>(sql, params);
              return { rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
            },
            async exec(sql: string) {
              await client.query(sql);
            },
          };
          const out = await fn(txClient);
          await client.query('COMMIT');
          return out;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      },
      async close() {
        await pool.end();
        dbInstance = null;
      },
    };
    return dbInstance;
  }

  // Embedded PostgreSQL (PGlite) for local dev / automated testing
  const pgliteTarget =
    config.databaseUrl === 'pglite://memory'
      ? undefined
      : config.databaseUrl.startsWith('pglite://')
        ? config.databaseUrl.slice('pglite://'.length)
        : config.pgliteDir;

  if (pgliteTarget) {
    fs.mkdirSync(pgliteTarget, { recursive: true });
  }
  const pglite = pgliteTarget ? new PGlite(pgliteTarget) : new PGlite();
  await pglite.waitReady;
  console.log(`[DB] Running embedded PostgreSQL (PGlite: ${pgliteTarget || 'memory'})`);

  dbInstance = {
    kind: 'pglite',
    async query<T extends QueryResultRow = any>(sql: string, params?: any[]) {
      const res = await pglite.query<T>(sql, params);
      return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
    },
    async exec(sql: string) {
      await pglite.exec(sql);
    },
    async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
      return pglite.transaction(async (pgTx) => {
        const txClient: DbClient = {
          async query<R extends QueryResultRow = any>(sql: string, params?: any[]) {
            const res = await pgTx.query<R>(sql, params);
            return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
          },
          async exec(sql: string) {
            await pgTx.exec(sql);
          },
        };
        return fn(txClient);
      });
    },
    async close() {
      await pglite.close();
      dbInstance = null;
    },
  };
  return dbInstance;
}

export function getDb(): DbEngine {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return dbInstance;
}
