import { Context, Next } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { errorResponse } from '../utils/response';
import { ALLOWED_UPLOAD_TYPES, matchesSignature } from '../lib/fileSignature';
import { fileNameSchema } from '../lib/validation';

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// Tolak request terlalu besar sebelum body dibaca ke memori (sedikit kelonggaran untuk overhead multipart).
export const uploadBodyLimit = bodyLimit({
  maxSize: MAX_FILE_SIZE + 1024 * 1024,
  onError: (c) => c.json(errorResponse('Ukuran file melebihi batas 50MB', 413), 413),
});

export const validateFileMiddleware = async (c: Context, next: Next) => {
  const body = await c.req.parseBody();
  const file = body['file'];

  if (!file || !(file instanceof File)) {
    return c.json(errorResponse('Tidak ada file valid yang diunggah', 400), 400);
  }

  if (file.size === 0 || file.size > MAX_FILE_SIZE) {
    return c.json(errorResponse('Ukuran file harus antara 1 byte dan 50MB', 400), 400);
  }

  if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
    return c.json(errorResponse('Tipe file tidak diizinkan. Hanya PNG, JPEG, WEBP, PDF, dan APK.', 400), 400);
  }

  if (!(await matchesSignature(file, file.type))) {
    return c.json(errorResponse('Isi file tidak sesuai dengan tipenya', 400), 400);
  }

  if (!fileNameSchema.safeParse(file.name).success) {
    return c.json(errorResponse('Nama file tidak valid', 400), 400);
  }

  c.set('validatedFile', file);
  c.set('uploadBody', body);
  await next();
};
