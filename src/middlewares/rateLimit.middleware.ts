import { Context, Next } from 'hono';
import { errorResponse } from '../utils/response';

// Simple in-memory rate limiter (10 requests per minute per IP)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

export const rateLimitMiddleware = async (c: Context, next: Next) => {
  const ip = c.req.header('x-forwarded-for') || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = 10;

  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs });
  } else {
    if (record.count >= maxRequests) {
      return c.json(errorResponse('Too Many Requests', 429), 429);
    }
    record.count++;
  }

  await next();
};
