import { Context, Hono } from 'hono';
import * as bcrypt from 'bcryptjs';
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, like, sql } from 'drizzle-orm';
import { db } from '../db';
import { files, users } from '../db/schema';
import { DriveService } from '../services/drive.service';
import {
  FileRecord,
  publiclyAccessible,
  releaseStorage,
  reserveStorage,
  toOwnerFile,
  toPublicFile,
} from '../services/file.service';
import { successResponse } from '../utils/response';
import { authMiddleware } from '../middlewares/auth.middleware';
import { unlockRateLimit, uploadRateLimit } from '../middlewares/rateLimit.middleware';
import { uploadBodyLimit, validateFileMiddleware } from '../middlewares/validateFile.middleware';
import { AppError, badRequest, notFound, unauthorized } from '../lib/errors';
import { isInlineSafe, setFileResponseHeaders } from '../lib/fileHeaders';
import { createStreamToken, verifyStreamToken } from '../lib/streamToken';
import { mapWithConcurrency, readJson } from '../lib/request';
import {
  FILE_TYPE_FILTERS,
  driveFolderIdSchema,
  escapeLike,
  futureDateSchema,
  listQuerySchema,
  parseOrThrow,
  positionSchema,
  publicListQuerySchema,
  renameSchema,
  sharePasswordSchema,
  shareSettingsSchema,
  syncSchema,
  unlockSchema,
  uuidSchema,
} from '../lib/validation';
import { z } from 'zod';

type Variables = {
  validatedFile: File;
  uploadBody: Record<string, string | File | (string | File)[]>;
  userId: string;
};

const BCRYPT_ROUNDS = 12;
const GOOGLE_APPS_MIME_PREFIX = 'application/vnd.google-apps.';

export const filesRoute = new Hono<{ Variables: Variables }>();

const fileIdParam = (c: Context) => parseOrThrow(uuidSchema, c.req.param('id'));

const findOwnedFile = async (id: string, userId: string, state: 'active' | 'trashed' | 'any' = 'any') => {
  const stateCondition =
    state === 'active' ? isNull(files.deletedAt) : state === 'trashed' ? isNotNull(files.deletedAt) : undefined;
  const [record] = await db
    .select()
    .from(files)
    .where(and(eq(files.id, id), eq(files.userId, userId), stateCondition));
  if (!record) throw notFound('File tidak ditemukan');
  return record;
};

/** File publik yang masih bisa diakses. File privat/trash/tidak ada dibalas 404 agar tidak bisa dienumerasi. */
const findPublicFile = async (id: string) => {
  const [record] = await db
    .select()
    .from(files)
    .where(and(eq(files.id, id), eq(files.isPublic, true), isNull(files.deletedAt)));
  if (!record) throw notFound('File tidak ditemukan atau tidak dibagikan');
  if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
    throw new AppError(410, 'Tautan file ini sudah kedaluwarsa');
  }
  return record;
};

const streamFile = async (c: Context, record: FileRecord, options: { download: boolean; cache: 'private' | 'public' }) => {
  const stream = await DriveService.downloadStream(record.driveFileId, record.userId);
  setFileResponseHeaders(c, record, options);
  return c.body(stream);
};

const sendThumbnail = async (c: Context, record: FileRecord, cache: 'private' | 'public') => {
  if (!record.fileType.startsWith('image/') && record.fileType !== 'application/pdf' && !record.fileType.startsWith('video/')) {
    throw notFound('Thumbnail tidak tersedia');
  }
  const thumbnail = await DriveService.getThumbnail(record.driveFileId, record.userId);
  if (thumbnail?.body) {
    c.header('Content-Type', thumbnail.headers.get('content-type')?.startsWith('image/') ? thumbnail.headers.get('content-type')! : 'image/jpeg');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Content-Security-Policy', "default-src 'none'");
    c.header('Cache-Control', `${cache}, max-age=3600`);
    return c.body(thumbnail.body);
  }
  // Fallback: gambar kecil boleh dikirim apa adanya (hanya tipe yang aman ditampilkan).
  if (isInlineSafe(record.fileType) && record.fileType.startsWith('image/') && record.fileSize <= 5 * 1024 * 1024) {
    return streamFile(c, record, { download: false, cache });
  }
  throw notFound('Thumbnail tidak tersedia');
};

// ───────────────────────────── Owner (butuh login) ─────────────────────────────

const uploadOptionsSchema = z.object({
  isPublic: z.boolean(),
  password: sharePasswordSchema.optional(),
  expiresAt: futureDateSchema.optional(),
  folderId: driveFolderIdSchema,
});

const formString = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : undefined);

// POST /files/upload
filesRoute.post('/upload', authMiddleware, uploadRateLimit, uploadBodyLimit, validateFileMiddleware, async (c) => {
  const file = c.get('validatedFile');
  const userId = c.get('userId');
  const body = c.get('uploadBody');

  const options = parseOrThrow(uploadOptionsSchema, {
    isPublic: body['isPublic'] !== 'false',
    password: formString(body['password']),
    expiresAt: formString(body['expiresAt']),
    folderId: formString(body['folderId']) ?? 'root',
  });

  await reserveStorage(userId, file.size);

  let driveFileId: string | undefined;
  try {
    const driveFile = await DriveService.uploadToDrive(file, userId, options.folderId);
    driveFileId = driveFile.id;

    const [newFile] = await db
      .insert(files)
      .values({
        userId,
        folderId: options.folderId === 'root' ? null : options.folderId,
        driveFileId: driveFile.id,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        isPublic: options.isPublic,
        password: options.password ? await bcrypt.hash(options.password, BCRYPT_ROUNDS) : null,
        expiresAt: options.expiresAt ?? null,
        webViewLink: driveFile.webViewLink,
      })
      .returning();

    return c.json(successResponse(toOwnerFile(newFile), 'File berhasil diunggah'), 201);
  } catch (error) {
    // Kompensasi: kembalikan kuota dan hapus file yatim di Drive bila penyimpanan ke DB gagal.
    await releaseStorage(userId, file.size).catch((e) => console.error('[upload] gagal mengembalikan kuota', e));
    if (driveFileId) {
      await DriveService.deleteFromDrive(driveFileId, userId).catch((e) =>
        console.error('[upload] gagal menghapus file yatim di Drive', driveFileId, e),
      );
    }
    throw error;
  }
});

// GET /files/list
filesRoute.get('/list', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const { page, limit, search, sort, type } = parseOrThrow(listQuerySchema, c.req.query());

  const conditions = and(
    eq(files.userId, userId),
    isNull(files.deletedAt),
    search ? ilike(files.fileName, `%${escapeLike(search)}%`) : undefined,
    type === 'pdf' ? eq(files.fileType, FILE_TYPE_FILTERS.pdf) : undefined,
    type === 'image' || type === 'video' ? like(files.fileType, `${FILE_TYPE_FILTERS[type]}%`) : undefined,
  );

  const orderBy = {
    newest: desc(files.uploadedAt),
    oldest: asc(files.uploadedAt),
    name_asc: asc(files.fileName),
    name_desc: desc(files.fileName),
    size_desc: desc(files.fileSize),
  }[sort];

  const [userFiles, [{ count }]] = await Promise.all([
    db.select().from(files).where(conditions).orderBy(orderBy, desc(files.id)).limit(limit).offset((page - 1) * limit),
    db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(files).where(conditions),
  ]);

  return c.json(
    successResponse(
      {
        files: userFiles.map(toOwnerFile),
        pagination: { total: count, page, limit, totalPages: Math.max(1, Math.ceil(count / limit)) },
      },
      'Files retrieved successfully',
    ),
  );
});

// GET /files/trash
filesRoute.get('/trash', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const trashedFiles = await db
    .select()
    .from(files)
    .where(and(eq(files.userId, userId), isNotNull(files.deletedAt)))
    .orderBy(desc(files.deletedAt))
    .limit(500);

  return c.json(successResponse(trashedFiles.map(toOwnerFile), 'Trash retrieved successfully'));
});

// POST /files/sync — impor file yang dipilih pengguna lewat Google Picker
filesRoute.post('/sync', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const { driveFileIds } = parseOrThrow(syncSchema, await readJson(c));
  const uniqueIds = [...new Set(driveFileIds)];

  const existing = await db
    .select({ driveFileId: files.driveFileId })
    .from(files)
    .where(and(eq(files.userId, userId), inArray(files.driveFileId, uniqueIds)));
  const existingIds = new Set(existing.map((f) => f.driveFileId));
  const candidates = uniqueIds.filter((id) => !existingIds.has(id));

  // Metadata (nama, tipe, ukuran) selalu diambil dari Drive — input client tidak dipercaya.
  const results = await mapWithConcurrency(candidates, 5, (id) => DriveService.getFileMetadata(id, userId));
  const metas = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const importable = metas.filter((m) => !m.mimeType.startsWith(GOOGLE_APPS_MIME_PREFIX));
  const skipped = uniqueIds.length - importable.length;

  if (importable.length === 0) {
    return c.json(successResponse({ files: [], skipped }, 'Tidak ada file baru untuk disinkronkan'));
  }

  const totalSize = importable.reduce((sum, m) => sum + m.size, 0);
  await reserveStorage(userId, totalSize);

  try {
    const inserted = await db
      .insert(files)
      .values(
        importable.map((m) => ({
          userId,
          folderId: m.parentId,
          driveFileId: m.id,
          fileName: m.name.slice(0, 255),
          fileType: m.mimeType.slice(0, 255),
          fileSize: m.size,
          // File hasil sinkronisasi privat secara default; pemilik bisa membagikannya lewat menu Bagikan.
          isPublic: false,
          webViewLink: m.webViewLink,
        })),
      )
      .returning();

    return c.json(successResponse({ files: inserted.map(toOwnerFile), skipped }, 'Files synced successfully'), 201);
  } catch (error) {
    await releaseStorage(userId, totalSize).catch((e) => console.error('[sync] gagal mengembalikan kuota', e));
    throw error;
  }
});

// DELETE /files/:id — pindahkan ke trash
filesRoute.delete('/:id', authMiddleware, async (c) => {
  const record = await findOwnedFile(fileIdParam(c), c.get('userId'), 'active');
  await db.update(files).set({ deletedAt: new Date() }).where(eq(files.id, record.id));
  return c.json(successResponse(null, 'File dipindahkan ke tong sampah'));
});

// POST /files/:id/restore
filesRoute.post('/:id/restore', authMiddleware, async (c) => {
  const record = await findOwnedFile(fileIdParam(c), c.get('userId'), 'trashed');
  await db.update(files).set({ deletedAt: null }).where(eq(files.id, record.id));
  return c.json(successResponse(null, 'File berhasil dipulihkan'));
});

// DELETE /files/:id/force — hapus permanen (Drive + DB)
filesRoute.delete('/:id/force', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const record = await findOwnedFile(fileIdParam(c), userId);

  // Jika Drive gagal, data DB dipertahankan agar file tidak menjadi yatim dan kuota tetap konsisten.
  await DriveService.deleteFromDrive(record.driveFileId, userId);

  await db.transaction(async (tx) => {
    await tx.delete(files).where(eq(files.id, record.id));
    await releaseStorage(userId, record.fileSize, tx);
  });

  return c.json(successResponse(null, 'File dihapus permanen'));
});

// GET /files/:id/stream (pemilik) — ?download=1 untuk memaksa unduhan
filesRoute.get('/:id/stream', authMiddleware, async (c) => {
  const record = await findOwnedFile(fileIdParam(c), c.get('userId'));
  return streamFile(c, record, { download: c.req.query('download') === '1', cache: 'private' });
});

// GET /files/:id/thumbnail (pemilik)
filesRoute.get('/:id/thumbnail', authMiddleware, async (c) => {
  const record = await findOwnedFile(fileIdParam(c), c.get('userId'));
  return sendThumbnail(c, record, 'private');
});

// PUT /files/:id/position
filesRoute.put('/:id/position', authMiddleware, async (c) => {
  const id = fileIdParam(c);
  const { posX, posY } = parseOrThrow(positionSchema, await readJson(c));
  const [updated] = await db
    .update(files)
    .set({ posX, posY })
    .where(and(eq(files.id, id), eq(files.userId, c.get('userId'))))
    .returning();
  if (!updated) throw notFound('File tidak ditemukan');
  return c.json(successResponse(toOwnerFile(updated), 'Position updated'));
});

// PUT /files/:id/rename — nama di Drive dan DB tetap sinkron
filesRoute.put('/:id/rename', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const record = await findOwnedFile(fileIdParam(c), userId, 'active');
  const { fileName } = parseOrThrow(renameSchema, await readJson(c));

  await DriveService.renameFile(record.driveFileId, fileName, userId);
  const [updated] = await db.update(files).set({ fileName }).where(eq(files.id, record.id)).returning();
  return c.json(successResponse(toOwnerFile(updated), 'Nama file berhasil diubah'));
});

// PUT /files/:id/share — atur publik/privat, password, dan kedaluwarsa tautan
filesRoute.put('/:id/share', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const record = await findOwnedFile(fileIdParam(c), userId, 'active');
  const input = parseOrThrow(shareSettingsSchema, await readJson(c));

  const update: Partial<typeof files.$inferInsert> = {};
  if (input.isPublic !== undefined) update.isPublic = input.isPublic;
  if (input.password !== undefined) {
    update.password = input.password === null ? null : await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  }
  if (input.expiresAt !== undefined) update.expiresAt = input.expiresAt;

  if (Object.keys(update).length === 0) {
    return c.json(successResponse(toOwnerFile(record), 'Tidak ada perubahan'));
  }

  const [updated] = await db.update(files).set(update).where(eq(files.id, record.id)).returning();

  // File lama mungkin masih punya izin "anyone with link" di Drive yang bisa melewati
  // password/kedaluwarsa. Cabut agar semua akses publik lewat backend.
  await DriveService.revokePublicAccess(record.driveFileId, userId).catch((e) =>
    console.error('[share] gagal mencabut akses publik Drive', record.id, e),
  );

  return c.json(successResponse(toOwnerFile(updated), 'Pengaturan berbagi disimpan'));
});

// ───────────────────────────────── Publik ─────────────────────────────────

// GET /files/public?username=&page=&limit=
filesRoute.get('/public', async (c) => {
  const { username, page, limit } = parseOrThrow(publicListQuerySchema, c.req.query());
  const normalized = username.toLowerCase();

  // Utamakan username resmi; fallback ke nama tanpa spasi hanya bila hasilnya tepat satu user.
  let [user] = await db.select({ id: users.id }).from(users).where(eq(users.username, normalized)).limit(1);
  if (!user) {
    const candidates = await db
      .select({ id: users.id })
      .from(users)
      .where(and(isNull(users.username), sql`LOWER(REPLACE(${users.name}, ' ', '')) = ${normalized}`))
      .limit(2);
    if (candidates.length === 1) user = candidates[0];
  }
  if (!user) throw notFound('Pengguna tidak ditemukan');

  const conditions = and(eq(files.userId, user.id), publiclyAccessible());
  const [publicFiles, [{ count }]] = await Promise.all([
    db.select().from(files).where(conditions).orderBy(desc(files.uploadedAt), desc(files.id)).limit(limit).offset((page - 1) * limit),
    db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(files).where(conditions),
  ]);

  return c.json(
    successResponse(
      {
        files: publicFiles.map(toPublicFile),
        pagination: { total: count, page, limit, totalPages: Math.max(1, Math.ceil(count / limit)) },
      },
      'Public files retrieved successfully',
    ),
  );
});

// GET /files/public/:id — metadata untuk halaman share
filesRoute.get('/public/:id', async (c) => {
  const record = await findPublicFile(fileIdParam(c));
  return c.json(successResponse(toPublicFile(record), 'File found'));
});

// POST /files/public/:id/unlock — verifikasi password, balas token stream berumur pendek
filesRoute.post('/public/:id/unlock', unlockRateLimit, async (c) => {
  const record = await findPublicFile(fileIdParam(c));
  const { password } = parseOrThrow(unlockSchema, await readJson(c));

  if (!record.password) throw badRequest('File ini tidak dilindungi password');
  if (!(await bcrypt.compare(password, record.password))) {
    throw new AppError(403, 'Password salah');
  }

  return c.json(successResponse(createStreamToken(record.id, record.password), 'File berhasil dibuka'));
});

// GET /files/public/:id/stream?token=&download=1
filesRoute.get('/public/:id/stream', async (c) => {
  const record = await findPublicFile(fileIdParam(c));

  if (record.password) {
    const token = c.req.query('token');
    if (!token || !verifyStreamToken(token, record.id, record.password)) {
      throw unauthorized('Password diperlukan untuk mengakses file ini');
    }
  }

  return streamFile(c, record, {
    download: c.req.query('download') === '1',
    cache: record.password ? 'private' : 'public',
  });
});

// GET /files/public/:id/thumbnail — tidak tersedia untuk file berpassword
filesRoute.get('/public/:id/thumbnail', async (c) => {
  const record = await findPublicFile(fileIdParam(c));
  if (record.password) throw notFound('Thumbnail tidak tersedia');
  return sendThumbnail(c, record, 'public');
});
