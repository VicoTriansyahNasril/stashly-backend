import { cors } from 'hono/cors';

export const corsMiddleware = cors({
  origin: (origin) => {
    const allowedOrigin = process.env.ALLOWED_ORIGIN;
    // For development, allow localhost or specified origin
    if (!origin || (allowedOrigin && origin === allowedOrigin)) {
      return origin;
    }
    return null; // Reject other origins
  },
  credentials: true,
});
