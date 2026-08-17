import { Context, Next } from 'hono';
import { errorResponse } from '../utils/response';
import { db } from '../db';
import { sessions } from '../db/schema';
import { eq } from 'drizzle-orm';
import { getCookie } from 'hono/cookie';

export const authMiddleware = async (c: Context, next: Next) => {
  // Ambil token sesi dari cookie yang dikirim NextAuth
  const token = getCookie(c, 'next-auth.session-token') || getCookie(c, '__Secure-next-auth.session-token');

  if (!token) {
    return c.json(errorResponse('Unauthorized: No session token found', 401), 401);
  }

  try {
    const [session] = await db.select().from(sessions).where(eq(sessions.sessionToken, token));
    
    if (!session || session.expires < new Date()) {
      return c.json(errorResponse('Unauthorized: Invalid or expired session', 401), 401);
    }
    
    // Set userId in context
    c.set('userId', session.userId);
  } catch (error) {
    console.error('Session verification error:', error);
    return c.json(errorResponse('Server error during auth', 500), 500);
  }

  await next();
};
