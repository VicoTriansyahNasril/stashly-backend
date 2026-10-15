import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { corsMiddleware, csrfMiddleware } from './middlewares/cors.middleware';
import { globalRateLimit } from './middlewares/rateLimit.middleware';
import { filesRoute } from './routes/files.route';
import { foldersRoute } from './routes/folders.route';
import { cronRoute } from './routes/cron.route';
import { usersRoute } from './routes/users.route';
import { AppError } from './lib/errors';
import { errorResponse } from './utils/response';

const app = new Hono();

// Default header ketat untuk respons API. Dipasang paling luar dan hanya bila belum diset,
// sehingga respons file (stream/thumbnail) bisa memakai CSP & framing khusus miliknya.
app.use('*', async (c, next) => {
  await next();
  if (!c.res.headers.has('Content-Security-Policy')) {
    c.res.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  }
});
app.use(
  '*',
  secureHeaders({
    crossOriginResourcePolicy: 'same-site',
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: undefined,
    xFrameOptions: false, // diatur lewat CSP frame-ancestors
  }),
);
app.use('*', corsMiddleware);
app.use('*', csrfMiddleware);
app.use('*', globalRateLimit);

app.get('/', (c) => c.json({ message: 'Stashly API is running' }));

app.route('/files', filesRoute);
app.route('/folders', foldersRoute);
app.route('/cron', cronRoute);
app.route('/users', usersRoute);

app.notFound((c) => c.json(errorResponse('Endpoint tidak ditemukan', 404), 404));

app.onError((error, c) => {
  if (error instanceof AppError) {
    if (error.status >= 500) console.error(`[${c.req.method} ${c.req.path}]`, error.cause ?? error);
    return c.json(errorResponse(error.message, error.status), error.status as any);
  }
  if (error instanceof HTTPException) {
    return c.json(errorResponse(error.message || 'Request tidak valid', error.status), error.status);
  }
  // Error tak terduga: log detail di server, client hanya menerima pesan generik.
  console.error(`[${c.req.method} ${c.req.path}] unhandled error:`, error);
  return c.json(errorResponse('Terjadi kesalahan pada server', 500), 500);
});

export default app;
