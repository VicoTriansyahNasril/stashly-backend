import { Context, Hono, Next } from 'hono';
import { createHash, timingSafeEqual } from 'crypto';
import { asc, eq, lte } from 'drizzle-orm';
import { db } from '../db';
import { files } from '../db/schema';
import { DriveService } from '../services/drive.service';
import { releaseStorage } from '../services/file.service';
import { successResponse, errorResponse } from '../utils/response';
import { env } from '../lib/env';

export const cronRoute = new Hono();

const TRASH_RETENTION_DAYS = 30;
const BATCH_SIZE = 200;

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Hanya scheduler yang mengetahui CRON_SECRET (header `Authorization: Bearer <secret>`) yang boleh memanggil. */
export const cronAuth = async (c: Context, next: Next) => {
  const secret = env.cronSecret();
  if (secret.length < 16) {
    return c.json(errorResponse('Cron is disabled: CRON_SECRET is not configured', 503), 503);
  }
  const provided = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  // Bandingkan digest agar panjang sama dan perbandingan constant-time.
  if (!timingSafeEqual(digest(provided), digest(secret))) {
    return c.json(errorResponse('Unauthorized', 401), 401);
  }
  await next();
};

// POST /cron/cleanup-trash — dipanggil scheduler eksternal (mis. Vercel Cron)
cronRoute.post('/cleanup-trash', cronAuth, async (c) => {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  // Diproses per batch agar satu run tidak memuat semua data / melewati timeout.
  const expiredFiles = await db
    .select()
    .from(files)
    .where(lte(files.deletedAt, cutoff))
    .orderBy(asc(files.deletedAt))
    .limit(BATCH_SIZE);

  let deletedCount = 0;
  let failedCount = 0;

  for (const fileRecord of expiredFiles) {
    try {
      await DriveService.deleteFromDrive(fileRecord.driveFileId, fileRecord.userId);
      await db.transaction(async (tx) => {
        await tx.delete(files).where(eq(files.id, fileRecord.id));
        await releaseStorage(fileRecord.userId, fileRecord.fileSize, tx);
      });
      deletedCount++;
    } catch (error) {
      console.error(`[cron] gagal membersihkan file ${fileRecord.id}:`, error);
      failedCount++;
    }
  }

  return c.json(
    successResponse({ deletedCount, failedCount, hasMore: expiredFiles.length === BATCH_SIZE }, 'Trash cleanup completed'),
  );
});
