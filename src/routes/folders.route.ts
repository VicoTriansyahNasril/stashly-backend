import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { authMiddleware } from '../middlewares/auth.middleware';
import { DriveService } from '../services/drive.service';
import { successResponse } from '../utils/response';
import { db } from '../db';
import { folders } from '../db/schema';
import { notFound } from '../lib/errors';
import { readJson } from '../lib/request';
import { createFolderSchema, parseOrThrow, positionSchema, uuidSchema } from '../lib/validation';

type Variables = {
  userId: string;
};

export const foldersRoute = new Hono<{ Variables: Variables }>();

// GET /folders — folder diambil langsung dari Google Drive (sumber kebenaran)
foldersRoute.get('/', authMiddleware, async (c) => {
  const driveFolders = await DriveService.listFolders(c.get('userId'));
  return c.json(successResponse(driveFolders, 'Folders retrieved successfully'));
});

// POST /folders — buat folder di Drive dan catat di DB
foldersRoute.post('/', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const { name } = parseOrThrow(createFolderSchema, await readJson(c));

  const driveFolder = await DriveService.createFolder(name, userId);
  await db.insert(folders).values({ userId, driveFolderId: driveFolder.id!, name });

  // Bentuk respons sama dengan GET /folders: `id` adalah ID folder Drive.
  return c.json(successResponse({ id: driveFolder.id!, name }, 'Folder created successfully'), 201);
});

// PUT /folders/:id/position
foldersRoute.put('/:id/position', authMiddleware, async (c) => {
  const folderId = parseOrThrow(uuidSchema, c.req.param('id'));
  const { posX, posY } = parseOrThrow(positionSchema, await readJson(c));

  const [updatedFolder] = await db
    .update(folders)
    .set({ posX, posY })
    .where(and(eq(folders.id, folderId), eq(folders.userId, c.get('userId'))))
    .returning();

  if (!updatedFolder) throw notFound('Folder tidak ditemukan');
  return c.json(successResponse(updatedFolder, 'Position updated'));
});
