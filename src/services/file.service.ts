import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { files, users } from '../db/schema';
import { AppError } from '../lib/errors';

export type FileRecord = typeof files.$inferSelect;

/** Data file untuk pemiliknya: tanpa hash password. */
export const toOwnerFile = ({ password, webContentLink: _legacyLink, ...file }: FileRecord) => ({
  ...file,
  hasPassword: !!password,
});

/**
 * Data file untuk publik: whitelist eksplisit. Jangan pernah menambahkan driveFileId,
 * link Drive, userId, atau hash password di sini — semua akses publik harus lewat backend.
 */
export const toPublicFile = (file: FileRecord) => ({
  id: file.id,
  fileName: file.fileName,
  fileType: file.fileType,
  fileSize: file.fileSize,
  uploadedAt: file.uploadedAt,
  expiresAt: file.expiresAt,
  hasPassword: !!file.password,
});

/** Kondisi file yang boleh diakses publik: publik, tidak di trash, dan belum kedaluwarsa. */
export const publiclyAccessible = () =>
  and(
    eq(files.isPublic, true),
    isNull(files.deletedAt),
    or(isNull(files.expiresAt), gt(files.expiresAt, sql`NOW()`)),
  );

/**
 * Reservasi kuota secara atomik (cek + tambah dalam satu UPDATE) sehingga upload paralel
 * tidak bisa melewati batas kuota (race condition).
 */
export const reserveStorage = async (userId: string, bytes: number) => {
  const reserved = await db
    .update(users)
    .set({ storageUsed: sql`${users.storageUsed} + ${bytes}` })
    .where(and(eq(users.id, userId), sql`${users.storageUsed} + ${bytes} <= ${users.storageLimit}`))
    .returning({ id: users.id });

  if (reserved.length === 0) {
    throw new AppError(400, 'Kuota penyimpanan Stashly Anda tidak mencukupi');
  }
};

export const releaseStorage = async (userId: string, bytes: number, tx: Pick<typeof db, 'update'> = db) => {
  await tx
    .update(users)
    .set({ storageUsed: sql`GREATEST(0, ${users.storageUsed} - ${bytes})` })
    .where(eq(users.id, userId));
};
