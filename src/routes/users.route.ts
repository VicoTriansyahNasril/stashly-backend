import { Hono } from 'hono';
import { and, eq, ne } from 'drizzle-orm';
import { authMiddleware } from '../middlewares/auth.middleware';
import { driveTokenRateLimit } from '../middlewares/rateLimit.middleware';
import { DriveService } from '../services/drive.service';
import { successResponse } from '../utils/response';
import { db } from '../db';
import { users } from '../db/schema';
import { AppError, notFound } from '../lib/errors';
import { readJson } from '../lib/request';
import { parseOrThrow, settingsSchema } from '../lib/validation';

type Variables = {
  userId: string;
};

export const usersRoute = new Hono<{ Variables: Variables }>();

const publicUserFields = {
  id: users.id,
  name: users.name,
  email: users.email,
  image: users.image,
  username: users.username,
  storageUsed: users.storageUsed,
  storageLimit: users.storageLimit,
  layoutStyle: users.layoutStyle,
};

// GET /users/me
usersRoute.get('/me', authMiddleware, async (c) => {
  const [user] = await db.select(publicUserFields).from(users).where(eq(users.id, c.get('userId'))).limit(1);
  if (!user) throw notFound('Pengguna tidak ditemukan');
  return c.json(successResponse(user, 'User fetched successfully'));
});

// GET /users/drive-token — access token `drive.file` berumur pendek untuk Google Picker
usersRoute.get('/drive-token', authMiddleware, driveTokenRateLimit, async (c) => {
  const token = await DriveService.getPickerAccessToken(c.get('userId'));
  c.header('Cache-Control', 'no-store');
  return c.json(successResponse(token, 'Token retrieved'));
});

// PUT /users/settings
usersRoute.put('/settings', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const input = parseOrThrow(settingsSchema, await readJson(c));

  if (input.username) {
    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.username, input.username), ne(users.id, userId)))
      .limit(1);
    if (taken) throw new AppError(409, 'Username sudah digunakan');
  }

  if (Object.keys(input).length === 0) {
    const [user] = await db.select(publicUserFields).from(users).where(eq(users.id, userId));
    return c.json(successResponse(user, 'Tidak ada perubahan'));
  }

  try {
    const [updated] = await db.update(users).set(input).where(eq(users.id, userId)).returning(publicUserFields);
    return c.json(successResponse(updated, 'Pengaturan berhasil disimpan'));
  } catch (error: any) {
    // Race condition: username diambil user lain di antara pengecekan dan update (unique violation).
    if (error?.code === '23505') throw new AppError(409, 'Username sudah digunakan');
    throw error;
  }
});
