import { Hono } from 'hono';
import { db } from '../db';
import { files, users } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { DriveService } from '../services/drive.service';
import { successResponse, errorResponse } from '../utils/response';
import { rateLimitMiddleware } from '../middlewares/rateLimit.middleware';
import { validateFileMiddleware } from '../middlewares/validateFile.middleware';
import { authMiddleware } from '../middlewares/auth.middleware';

type Variables = {
  validatedFile: File;
  userId: string;
};

export const filesRoute = new Hono<{ Variables: Variables }>();

// POST /files/upload (Protected)
filesRoute.post('/upload', authMiddleware, rateLimitMiddleware, validateFileMiddleware, async (c) => {
  try {
    const file = c.get('validatedFile') as File;
    const userId = c.get('userId');
    const body = await c.req.parseBody();
    const isPublic = body['isPublic'] !== 'false';

    // 1. Upload to User's Google Drive
    const driveFileId = await DriveService.uploadToDrive(file, userId);

    // 2. Generate public links
    let links = { webContentLink: null as string | null, webViewLink: null as string | null };
    if (isPublic) {
      links = await DriveService.generatePublicLink(driveFileId, userId);
    }

    // 3. Save to DB with userId
    const [newFile] = await db.insert(files).values({
      userId,
      driveFileId,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      isPublic,
      webContentLink: links.webContentLink,
      webViewLink: links.webViewLink,
    }).returning();

    return c.json(successResponse(newFile, 'File uploaded successfully'), 201);
  } catch (error: any) {
    console.error('Upload error:', error);
    return c.json(errorResponse(error.message || 'Internal Server Error'), 500);
  }
});

// GET /files/list (Protected - Dashboard View)
filesRoute.get('/list', authMiddleware, async (c) => {
  try {
    const userId = c.get('userId');
    const userFiles = await db.select().from(files).where(eq(files.userId, userId)).orderBy(files.uploadedAt);
    return c.json(successResponse(userFiles, 'Files retrieved successfully'));
  } catch (error: any) {
    console.error('List error:', error);
    return c.json(errorResponse(error.message || 'Internal Server Error'), 500);
  }
});

// GET /files/public (Public - View by username)
filesRoute.get('/public', async (c) => {
  try {
    const username = c.req.query('username');
    if (!username) {
      return c.json(errorResponse('Username query is required', 400), 400);
    }

    // Find the user by comparing lowercase, space-removed name
    const [user] = await db.select().from(users).where(
      sql`LOWER(REPLACE(${users.name}, ' ', '')) = ${username.toLowerCase()}`
    );

    if (!user) {
      return c.json(errorResponse('User not found', 404), 404);
    }

    const publicFiles = await db.select().from(files).where(
      and(
        eq(files.userId, user.id),
        eq(files.isPublic, true)
      )
    ).orderBy(files.uploadedAt);

    return c.json(successResponse(publicFiles, 'Public files retrieved successfully'));
  } catch (error: any) {
    console.error('Public list error:', error);
    return c.json(errorResponse(error.message || 'Internal Server Error'), 500);
  }
});

// DELETE /files/:id (Protected)
filesRoute.delete('/:id', authMiddleware, async (c) => {
  try {
    const id = c.req.param('id') as string;
    const userId = c.get('userId');

    // Find in DB (must belong to this user)
    const [fileRecord] = await db.select().from(files).where(
      and(eq(files.id, id), eq(files.userId, userId))
    );

    if (!fileRecord) {
      return c.json(errorResponse('File not found or unauthorized', 404), 404);
    }

    // Delete from Drive
    try {
        await DriveService.deleteFromDrive(fileRecord.driveFileId, userId);
    } catch (e: any) {
        console.error('Warning: could not delete from drive', e);
    }

    // Delete from DB
    await db.delete(files).where(eq(files.id, id));

    return c.json(successResponse(null, 'File deleted successfully'));
  } catch (error: any) {
    console.error('Delete error:', error);
    return c.json(errorResponse(error.message || 'Internal Server Error'), 500);
  }
});
