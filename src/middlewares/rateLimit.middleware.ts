import { Context, Next } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { errorResponse } from '../utils/response';
import { env } from '../lib/env';

/**
 * IP client. X-Forwarded-For hanya dipercaya jika TRUST_PROXY=true (app berada di belakang
 * reverse proxy yang menimpa header tersebut); jika tidak, header itu bisa dipalsukan
 * untuk mengakali rate limit.
 */
export const getClientIp = (c: Context): string => {
  if (env.trustProxy()) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address || 'unknown';
  } catch {
    return 'unknown';
  }
};

type Bucket = { count: number; resetTime: number };

// Batas jumlah key agar Map tidak tumbuh tanpa batas saat diserang banyak IP.
const MAX_KEYS = 50_000;
const limiters: Map<string, Bucket>[] = [];

const sweep = () => {
  const now = Date.now();
  for (const buckets of limiters) {
    for (const [key, bucket] of buckets) {
      if (now > bucket.resetTime) buckets.delete(key);
    }
  }
};
setInterval(sweep, 60_000).unref();

/**
 * Rate limiter in-memory per instance. Untuk deployment multi-instance,
 * ganti store ini dengan Redis atau sejenisnya.
 */
export const createRateLimiter = ({ windowMs, max, name }: { windowMs: number; max: number; name: string }) => {
  const buckets = new Map<string, Bucket>();
  limiters.push(buckets);

  return async (c: Context, next: Next) => {
    const key = getClientIp(c);
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || now > bucket.resetTime) {
      if (buckets.size >= MAX_KEYS) sweep();
      if (buckets.size >= MAX_KEYS) buckets.clear();
      buckets.set(key, { count: 1, resetTime: now + windowMs });
    } else if (bucket.count >= max) {
      c.header('Retry-After', String(Math.ceil((bucket.resetTime - now) / 1000)));
      return c.json(errorResponse(`Terlalu banyak permintaan (${name}). Coba lagi sebentar lagi.`, 429), 429);
    } else {
      bucket.count++;
    }

    await next();
  };
};

export const globalRateLimit = createRateLimiter({ name: 'global', windowMs: 60_000, max: 300 });
export const uploadRateLimit = createRateLimiter({ name: 'upload', windowMs: 60_000, max: 10 });
export const driveTokenRateLimit = createRateLimiter({ name: 'drive-token', windowMs: 60_000, max: 20 });
// Ketat untuk verifikasi password agar tidak bisa di-brute-force.
export const unlockRateLimit = createRateLimiter({ name: 'unlock', windowMs: 15 * 60_000, max: 10 });
