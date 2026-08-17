import { Hono } from 'hono';
import { db } from '../db';
import { files } from '../db/schema';
import { eq } from 'drizzle-orm';
import { DriveService } from '../services/drive.service';
import { successResponse, errorResponse } from '../utils/response';
import { rateLimitMiddleware } from '../middlewares/rateLimit.middleware';
import { validateFileMiddleware } from '../middlewares/validateFile.middleware';

export const filesRoute = new Hono();

// POST /files/upload
filesRoute.post('/upload', rateLimitMiddleware, validateFileMiddleware, async (c) => {
  try {
    const file = c.get('validatedFile') as File;
    const body = await c.req.parseBody();
    const isPublic = body['isPublic'] !== 'false'; // default true

    // 1. Upload to Google Drive
    const driveFileId = await DriveService.uploadToDrive(file);

    // 2. Generate public links if isPublic is true
    let links = { webContentLink: null as string | null, webViewLink: null as string | null };
    if (isPublic) {
      links = await DriveService.generatePublicLink(driveFileId);
    }

    // 3. Save metadata to DB
    const [newFile] = await db.insert(files).values({
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

// GET /files/list
filesRoute.get('/list', async (c) => {
  try {
    const allFiles = await db.select().from(files).orderBy(files.uploadedAt);
    return c.json(successResponse(allFiles, 'Files retrieved successfully'));
  } catch (error: any) {
    console.error('List error:', error);
    return c.json(errorResponse(error.message || 'Internal Server Error'), 500);
  }
});

// DELETE /files/:id
filesRoute.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id');

    // Find in DB
    const [fileRecord] = await db.select().from(files).where(eq(files.id, id));
    if (!fileRecord) {
      return c.json(errorResponse('File not found', 404), 404);
    }

    // Delete from Drive
    try {
        await DriveService.deleteFromDrive(fileRecord.driveFileId);
    } catch (e: any) {
        // If file doesn't exist on drive anymore, we can still delete from DB
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
