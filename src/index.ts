import { serve } from '@hono/node-server';
import app from './app';
import { env } from './lib/env';

const REQUIRED_ENV = ['DATABASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'ALLOWED_ORIGIN', 'STREAM_TOKEN_SECRET'];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
env.streamTokenSecret(); // validasi panjang secret saat startup
if (!env.cronSecret()) console.warn('CRON_SECRET is not set: /cron endpoints are disabled');

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`Server is running on port ${port}`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
