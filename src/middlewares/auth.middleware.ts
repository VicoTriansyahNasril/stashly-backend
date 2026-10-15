import { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { and, eq, gt } from 'drizzle-orm';
import { errorResponse } from '../utils/response';
import { db } from '../db';
import { sessions } from '../db/schema';

export const authMiddleware = async (c: Context, next: Next) => {
  // Token sesi database dari NextAuth (cookie __Secure- dipakai saat HTTPS)
  const token = getCookie(c, '__Secure-next-auth.session-token') || getCookie(c, 'next-auth.session-token');

  if (!token || token.length > 512) {
    return c.json(errorResponse('Unauthorized: sesi tidak ditemukan', 401), 401);
  }

  const [session] = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.sessionToken, token), gt(sessions.expires, new Date())));

  if (!session) {
    return c.json(errorResponse('Unauthorized: sesi tidak valid atau kedaluwarsa', 401), 401);
  }

  c.set('userId', session.userId);
  await next();
};
