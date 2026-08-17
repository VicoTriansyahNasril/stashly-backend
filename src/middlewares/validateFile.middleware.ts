import { Context, Next } from 'hono';
import { errorResponse } from '../utils/response';

const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'application/vnd.android.package-archive',
];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export const validateFileMiddleware = async (c: Context, next: Next) => {
  const body = await c.req.parseBody();
  const file = body['file'];

  if (!file || !(file instanceof File)) {
    return c.json(errorResponse('No valid file uploaded', 400), 400);
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return c.json(errorResponse(`Invalid file type: ${file.type}. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`, 400), 400);
  }

  if (file.size > MAX_FILE_SIZE) {
    return c.json(errorResponse(`File size exceeds 50MB limit`, 400), 400);
  }

  // Attach to context for downstream
  c.set('validatedFile', file);
  await next();
};
