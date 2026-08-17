import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { corsMiddleware } from './middlewares/cors.middleware';
import { filesRoute } from './routes/files.route';

const app = new Hono();

app.use('*', secureHeaders());
app.use('*', corsMiddleware);

app.get('/', (c) => {
  return c.json({ message: 'Stashly API is running' });
});

app.route('/files', filesRoute);

const port = process.env.PORT ? parseInt(process.env.PORT) : 3001;
console.log(`Server is running on port ${port}`);

serve({
  fetch: app.fetch,
  port
});
