import { Context, Next } from 'hono';
import { cors } from 'hono/cors';
import { env } from '../lib/env';
import { errorResponse } from '../utils/response';

export const corsMiddleware = cors({
  origin: (origin) => (origin === env.allowedOrigin() ? origin : null),
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
  credentials: true,
  maxAge: 600,
});

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Proteksi CSRF: auth memakai cookie, jadi request yang mengubah data hanya boleh datang
 * dari origin frontend. Request server-to-server (tanpa Origin, mis. cron) tetap diizinkan
 * karena browser selalu mengirim Origin/Sec-Fetch-Site pada request lintas situs.
 */
export const csrfMiddleware = async (c: Context, next: Next) => {
  if (!SAFE_METHODS.has(c.req.method)) {
    const origin = c.req.header('origin');
    const fetchSite = c.req.header('sec-fetch-site');
    const crossSiteWithoutOrigin = !origin && fetchSite === 'cross-site';
    if ((origin && origin !== env.allowedOrigin()) || crossSiteWithoutOrigin) {
      return c.json(errorResponse('Forbidden: invalid origin', 403), 403);
    }
  }
  await next();
};
