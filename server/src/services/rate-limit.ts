export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec?: number;
  remaining?: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Bounded in-memory fixed-window rate limiter.
 * Automatically prunes expired buckets to prevent unbounded memory growth under IP spray attacks.
 */
export class BoundedRateLimiter {
  private buckets = new Map<string, Bucket>();
  private lastPruneAt = Date.now();

  constructor(
    private maxRequests: number,
    private windowMs: number,
    private maxBuckets = 5000
  ) {}

  private prune(now: number): void {
    if (now - this.lastPruneAt < 60_000 && this.buckets.size < this.maxBuckets) {
      return;
    }
    this.lastPruneAt = now;
    for (const [k, v] of this.buckets) {
      if (v.resetAt <= now) {
        this.buckets.delete(k);
      }
    }
    // Hard cap safety if still above limit under DDoS
    if (this.buckets.size > this.maxBuckets) {
      const overflow = this.buckets.size - this.maxBuckets;
      let removed = 0;
      for (const k of this.buckets.keys()) {
        this.buckets.delete(k);
        if (++removed >= overflow) break;
      }
    }
  }

  check(key: string): RateLimitResult {
    const now = Date.now();
    this.prune(now);
    const rec = this.buckets.get(key);
    if (!rec || rec.resetAt <= now) {
      return { allowed: true, remaining: this.maxRequests };
    }
    if (rec.count >= this.maxRequests) {
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((rec.resetAt - now) / 1000)),
        remaining: 0,
      };
    }
    return { allowed: true, remaining: this.maxRequests - rec.count };
  }

  consume(key: string): RateLimitResult {
    const now = Date.now();
    this.prune(now);
    const rec = this.buckets.get(key);
    if (!rec || rec.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: Math.max(0, this.maxRequests - 1) };
    }
    if (rec.count >= this.maxRequests) {
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((rec.resetAt - now) / 1000)),
        remaining: 0,
      };
    }
    rec.count += 1;
    return { allowed: true, remaining: Math.max(0, this.maxRequests - rec.count) };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }
}
