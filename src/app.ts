import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { corsMiddleware } from './middlewares/cors.middleware';
import { filesRoute } from './routes/files.route';
import { foldersRoute } from './routes/folders.route';
import { cronRoute } from './routes/cron.route';
import { usersRoute } from './routes/users.route';

// Global rate limiter middleware (simple version for global routes)
const globalRateLimitMap = new Map<string, { count: number; resetTime: number }>();
const globalRateLimitMiddleware = async (c: any, next: any) => {
  const ip = c.req.header('x-forwarded-for') || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = 150; // 150 req / min global

  const record = globalRateLimitMap.get(ip);
  if (!record || now > record.resetTime) {
    globalRateLimitMap.set(ip, { count: 1, resetTime: now + windowMs });
  } else {
    if (record.count >= maxRequests) {
      return c.json({ success: false, error: 'Global Rate Limit Exceeded' }, 429);
    }
    record.count++;
  }
  await next();
};

const app = new Hono();

app.use('*', secureHeaders({
  crossOriginResourcePolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use('*', corsMiddleware);
app.use('*', globalRateLimitMiddleware);

app.get('/', (c) => {
  return c.json({ message: 'Stashly API is running' });
});

app.route('/files', filesRoute);
app.route('/folders', foldersRoute);
app.route('/cron', cronRoute);
app.route('/users', usersRoute);

export default app;
