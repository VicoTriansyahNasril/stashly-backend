import { Hono } from 'hono';
import { db } from '../db';
import * as bcrypt from 'bcryptjs';
import { files, users } from '../db/schema';
import { eq, and, sql, ilike, desc, asc, isNull, isNotNull } from 'drizzle-orm';
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
    const userId = c.get('userId') as string;
    const body = await c.req.parseBody();
    
    // Check Storage Limit
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return c.json(errorResponse('User not found', 404), 404);
    
    const newStorageUsed = Number(user.storageUsed) + file.size;
    if (newStorageUsed > Number(user.storageLimit)) {
      return c.json(errorResponse('Storage limit exceeded', 400), 400);
    }

    const isPublic = body['isPublic'] !== 'false';
    const password = typeof body['password'] === 'string' && body['password'].length > 0 ? body['password'] : null;
    const expiresAtStr = typeof body['expiresAt'] === 'string' ? body['expiresAt'] : null;
    const expiresAt = expiresAtStr ? new Date(expiresAtStr) : null;
    const folderId = typeof body['folderId'] === 'string' ? body['folderId'] : undefined;

    // 1. Upload to User's Google Drive
    const driveFileId = await DriveService.uploadToDrive(file, userId, folderId);

    // 2. Generate public links
    let links = { webContentLink: null as string | null, webViewLink: null as string | null };
    if (isPublic) {
      links = await DriveService.generatePublicLink(driveFileId, userId);
    }

    // 3. Save to DB with userId
    const [newFile] = await db.insert(files).values({
      userId,
      folderId,
      driveFileId,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      isPublic,
      password: password ? await bcrypt.hash(password, 10) : null,
      expiresAt,
      webContentLink: links.webContentLink,
      webViewLink: links.webViewLink,
    }).returning();

    // 4. Update user storage usage atomically
    await db.update(users)
      .set({ storageUsed: sql`${users.storageUsed} + ${file.size}` })
      .where(eq(users.id, userId));

    return c.json(successResponse(newFile, 'File uploaded successfully'), 201);
  } catch (error: any) {
    console.error('Upload error:', error);
    return c.json(errorResponse(error.message || 'Internal Server Error'), 500);
  }
});

// GET /files/list (Protected - Dashboard View)
filesRoute.get('/list', authMiddleware, async (c) => {
  try {
    const userId = c.get('userId') as string;
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '50');
    const search = c.req.query('search') || '';
    const sort = c.req.query('sort') || 'newest'; // newest, oldest, name_asc, name_desc, size_desc
    const type = c.req.query('type') || ''; // image, document, video

    const offset = (page - 1) * limit;

    let conditions = and(
      eq(files.userId, userId),
      isNull(files.deletedAt)
    );

    if (search) {
      conditions = and(conditions, ilike(files.fileName, `%${search}%`));
    }

    if (type) {
      conditions = and(conditions, ilike(files.fileType, `${type}%`));
    }

    let orderByClause = desc(files.uploadedAt);
    if (sort === 'oldest') orderByClause = asc(files.uploadedAt);
    if (sort === 'name_asc') orderByClause = asc(files.fileName);
    if (sort === 'name_desc') orderByClause = desc(files.fileName);
    if (sort === 'size_desc') orderByClause = desc(files.fileSize);

    const userFiles = await db.select().from(files)
      .where(conditions)
      .orderBy(orderByClause)
      .limit(limit)
      .offset(offset);

    // Get total count for pagination metadata
    const [countResult] = await db.select({ count: sql`count(*)`.mapWith(Number) })
      .from(files).where(conditions);

    // Strip passwords before sending to client
    const safeFiles = userFiles.map(({ password, ...fileData }) => ({
      ...fileData,
      hasPassword: !!password
    }));

    return c.json(successResponse({
      files: safeFiles,
      pagination: {
        total: countResult.count,
        page,
        limit,
        totalPages: Math.ceil(countResult.count / limit)
      }
    }, 'Files retrieved successfully'));
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

    const [user] = await db.select().from(users).where(
      sql`LOWER(${users.username}) = ${username.toLowerCase()} OR (${users.username} IS NULL AND LOWER(REPLACE(${users.name}, ' ', '')) = ${username.toLowerCase()})`
    );

    if (!user) {
      return c.json(errorResponse('User not found', 404), 404);
    }

    // Only non-deleted, public, and not-expired files
    const publicFiles = await db.select().from(files).where(
      and(
        eq(files.userId, user.id),
        eq(files.isPublic, true),
        isNull(files.deletedAt),
        sql`(${files.expiresAt} IS NULL OR ${files.expiresAt} > NOW())`
      )
    ).orderBy(desc(files.uploadedAt));

    // Hide password protected links content URL (user needs to provide password via another endpoint to get link)
    const sanitizedFiles = publicFiles.map(f => {
      if (f.password) {
         return { ...f, webContentLink: null, webViewLink: null, isPasswordProtected: true };
      }
      return { ...f, isPasswordProtected: false };
    });

    return c.json(successResponse(sanitizedFiles, 'Public files retrieved successfully'));
  } catch (error: any) {
    console.error('Public list error:', error);
    return c.json(errorResponse(error.message || 'Internal Server Error'), 500);
  }
});

// GET /files/trash (Protected)
filesRoute.get('/trash', authMiddleware, async (c) => {
  try {
    const userId = c.get('userId') as string;
    const trashedFiles = await db.select().from(files).where(
      and(eq(files.userId, userId), isNotNull(files.deletedAt))
    ).orderBy(desc(files.deletedAt));

    const safeTrashedFiles = trashedFiles.map(({ password, ...fileData }) => ({
      ...fileData,
      hasPassword: !!password
    }));

    return c.json(successResponse(safeTrashedFiles, 'Trash retrieved successfully'));
  } catch (error: any) {
    console.error('Trash error:', error);
    return c.json(errorResponse(error.message || 'Internal Server Error'), 500);
  }
});

// DELETE /files/:id (Soft Delete)
filesRoute.delete('/:id', authMiddleware, async (c) => {
  try {
    const id = c.req.param('id') as string;
    const userId = c.get('userId') as string;

    const [fileRecord] = await db.select().from(files).where(
      and(eq(files.id, id), eq(files.userId, userId), isNull(files.deletedAt))
    );

    if (!fileRecord) {
      return c.json(errorResponse('File not found or unauthorized', 404), 404);
    }

    await db.update(files).set({ deletedAt: new Date() }).where(eq(files.id, id));

    return c.json(successResponse(null, 'File moved to trash'));
  } catch (error: any) {
    console.error('Soft delete error:', error);
    return c.json(errorResponse(error.message || 'Internal Server Error'), 500);
  }
});

// POST /files/:id/restore (Restore from Trash)
filesRoute.post('/:id/restore', authMiddleware, async (c) => {
  try {
    const id = c.req.param('id') as string;
    const userId = c.get('userId') as string;

    const [fileRecord] = await db.select().from(files).where(
      and(eq(files.id, id), eq(files.userId, userId), isNotNull(files.deletedAt))
    );

    if (!fileRecord) {
      return c.json(errorResponse('File not found in trash', 404), 404);
    }

    await db.update(files).set({ deletedAt: null }).where(eq(files.id, id));

    return c.json(successResponse(null, 'File restored successfully'));
  } catch (error: any) {
    console.error('Restore error:', error);
    return c.json(errorResponse(error.message || 'Internal Server Error'), 500);
  }
});

// DELETE /files/:id/force (Hard Delete)
filesRoute.delete('/:id/force', authMiddleware, async (c) => {
  try {
    const id = c.req.param('id') as string;
    const userId = c.get('userId') as string;

    const [fileRecord] = await db.select().from(files).where(
      and(eq(files.id, id), eq(files.userId, userId))
    );

    if (!fileRecord) {
      return c.json(errorResponse('File not found', 404), 404);
    }

    try {
        await DriveService.deleteFromDrive(fileRecord.driveFileId, userId);
    } catch (e: any) {
        console.error('Warning: could not delete from drive', e);
    }

    await db.delete(files).where(eq(files.id, id));

    // Atomic storage decrement
    await db.update(users)
       .set({ storageUsed: sql`GREATEST(0, ${users.storageUsed} - ${fileRecord.fileSize})` })
       .where(eq(users.id, userId));

    return c.json(successResponse(null, 'File permanently deleted'));
  } catch (error: any) {
    console.error('Force delete error:', error);
    return c.json(errorResponse(error.message || 'Internal Server Error'), 500);
  }
});

// POST /files/:id/unlock (Public - Unlock password protected file)
filesRoute.post('/:id/unlock', rateLimitMiddleware, async (c) => {
  try {
    const id = c.req.param('id') as string;
    const body = await c.req.parseBody();
    const password = body['password'];

    if (!password || typeof password !== 'string') {
       return c.json(errorResponse('Password is required', 400), 400);
    }

    const [fileRecord] = await db.select().from(files).where(
      and(
         eq(files.id, id), 
         eq(files.isPublic, true),
         isNull(files.deletedAt),
         sql`(${files.expiresAt} IS NULL OR ${files.expiresAt} > NOW())`
      )
    );

    if (!fileRecord) {
      return c.json(errorResponse('File not found or expired', 404), 404);
    }

    const isMatch = fileRecord.password && await bcrypt.compare(password, fileRecord.password);
    if (!isMatch) {
      return c.json(errorResponse('Incorrect password', 403), 403);
    }

    return c.json(successResponse({
      webContentLink: fileRecord.webContentLink,
      webViewLink: fileRecord.webViewLink
    }, 'File unlocked successfully'));

  } catch (error: any) {
    console.error('Unlock error:', error);
    return c.json(errorResponse(error.message || 'Internal Server Error'), 500);
  }
});

// GET /files/public/:id
// Get public file metadata (used for the Share Page)
filesRoute.get('/public/:id', async (c) => {
  try {
    const fileId = c.req.param('id') as string;
    const [fileRecord] = await db.select({
      id: files.id,
      fileName: files.fileName,
      fileSize: files.fileSize,
      fileType: files.fileType,
      isPublic: files.isPublic,
      hasPassword: isNotNull(files.password),
      expiresAt: files.expiresAt,
      uploadedAt: files.uploadedAt
    }).from(files).where(eq(files.id, fileId));

    if (!fileRecord) return c.json(errorResponse('File not found', 404), 404);
    if (!fileRecord.isPublic) return c.json(errorResponse('File is not public', 403), 403);
    
    if (fileRecord.expiresAt && new Date(fileRecord.expiresAt) < new Date()) {
      return c.json(errorResponse('Link expired', 410), 410);
    }

    return c.json(successResponse(fileRecord, 'File found'));
  } catch (error: any) {
    return c.json(errorResponse('Internal Server Error'), 500);
  }
});

// GET /files/public/:id/stream
// Streams the file content directly from Google Drive through our backend proxy
filesRoute.get('/public/:id/stream', async (c) => {
  try {
    const fileId = c.req.param('id') as string;
    const password = c.req.query('password');

    const [fileRecord] = await db.select().from(files).where(eq(files.id, fileId));

    if (!fileRecord) return c.json(errorResponse('File not found', 404), 404);
    if (!fileRecord.isPublic) return c.json(errorResponse('File is not public', 403), 403);
    
    if (fileRecord.expiresAt && new Date(fileRecord.expiresAt) < new Date()) {
      return c.json(errorResponse('Link expired', 410), 410);
    }

    if (fileRecord.password) {
      if (!password) return c.json(errorResponse('Password required', 401), 401);
      const isMatch = await bcrypt.compare(password, fileRecord.password);
      if (!isMatch) return c.json(errorResponse('Incorrect password', 403), 403);
    }

    // Proxy download stream from Drive
    const streamInfo = await DriveService.downloadStream(fileRecord.driveFileId, fileRecord.userId);
    
    // Set headers for file download
    c.header('Content-Type', fileRecord.fileType);
    c.header('Content-Disposition', `inline; filename="${fileRecord.fileName}"`);
    c.header('Content-Length', fileRecord.fileSize.toString());

    return new Response(streamInfo.stream as unknown as ReadableStream);
  } catch (error: any) {
    console.error('Stream error:', error);
    return c.json(errorResponse('Failed to stream file'), 500);
  }
});

// GET /files/:id/stream (Private)
filesRoute.get('/:id/stream', authMiddleware, async (c) => {
  try {
    const fileId = c.req.param('id') as string;
    const userId = c.get('userId') as string;

    const [fileRecord] = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.userId, userId)));
    if (!fileRecord) return c.json(errorResponse('File not found', 404), 404);

    const streamInfo = await DriveService.downloadStream(fileRecord.driveFileId, userId);
    
    c.header('Content-Type', fileRecord.fileType);
    c.header('Content-Disposition', `inline; filename="${fileRecord.fileName}"`);
    c.header('Content-Length', fileRecord.fileSize.toString());

    return new Response(streamInfo.stream as unknown as ReadableStream);
  } catch (error: any) {
    console.error('Private Stream error:', error);
    return c.json(errorResponse('Failed to stream file'), 500);
  }
});

// GET /files/drive-stream/:driveFileId (Protected) - Stream directly by driveFileId
filesRoute.get('/drive-stream/:driveFileId', authMiddleware, async (c) => {
  try {
    const driveFileId = c.req.param('driveFileId') as string;
    const userId = c.get('userId') as string;
    
    // We get metadata from query to set headers
    const mimeType = c.req.query('mimeType') || 'application/octet-stream';
    const fileName = c.req.query('fileName') || 'file';

    const streamInfo = await DriveService.downloadStream(driveFileId, userId);
    
    c.header('Content-Type', mimeType);
    c.header('Content-Disposition', `inline; filename="${fileName}"`);

    return new Response(streamInfo.stream as unknown as ReadableStream);
  } catch (error: any) {
    console.error('Drive Stream error:', error);
    return c.json(errorResponse('Failed to stream file from Drive'), 500);
  }
});

// PUT /files/:id/position (Protected)
filesRoute.put('/:id/position', authMiddleware, async (c) => {
  try {
    const fileId = c.req.param('id') as string;
    const userId = c.get('userId') as string;
    const body = await c.req.json();
    const { posX, posY } = body;

    if (typeof posX !== 'number' || typeof posY !== 'number') {
      return c.json(errorResponse('posX and posY are required and must be numbers', 400), 400);
    }

    const [updatedFile] = await db.update(files)
      .set({ posX: Math.round(posX), posY: Math.round(posY) })
      .where(and(eq(files.id, fileId), eq(files.userId, userId)))
      .returning();

    if (!updatedFile) {
      return c.json(errorResponse('File not found', 404), 404);
    }

    return c.json(successResponse(updatedFile, 'Position updated'));
  } catch (error: any) {
    console.error('Update position error:', error);
    return c.json(errorResponse(error.message || 'Internal Server Error'), 500);
  }
});

// PUT /files/:id/rename (Protected)
filesRoute.put('/:id/rename', authMiddleware, async (c) => {
  try {
    const fileId = c.req.param('id') as string;
    const userId = c.get('userId') as string;
    const body = await c.req.json();
    const { fileName } = body;

    if (!fileName || typeof fileName !== 'string' || fileName.trim().length === 0) {
      return c.json(errorResponse('Valid fileName is required', 400), 400);
    }

    const [updatedFile] = await db.update(files)
      .set({ fileName: fileName.trim() })
      .where(and(eq(files.id, fileId), eq(files.userId, userId)))
      .returning();

    if (!updatedFile) {
      return c.json(errorResponse('File not found', 404), 404);
    }

    return c.json(successResponse(updatedFile, 'File renamed successfully'));
  } catch (error: any) {
    console.error('Rename error:', error);
    return c.json(errorResponse(error.message || 'Internal Server Error'), 500);
  }
});

// GET /files/drive-files (Protected) - Fetch from Google Drive API
filesRoute.get('/drive-files', authMiddleware, async (c) => {
  try {
    const userId = c.get('userId');
    const folderId = c.req.query('folderId') || 'root';
    const driveFiles = await DriveService.listFilesFromFolder(userId, folderId);
    return c.json(successResponse(driveFiles, 'Drive files retrieved'));
  } catch (error: any) {
    return c.json(errorResponse(error.message), 500);
  }
});

// POST /files/sync (Protected) - Sync files from Drive into DB
filesRoute.post('/sync', authMiddleware, async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json();
    const { filesToSync, folderId } = body;

    if (!Array.isArray(filesToSync) || filesToSync.length === 0) {
      return c.json(errorResponse('No files provided'), 400);
    }

    const newFiles = [];
    for (const f of filesToSync) {
      // Check if file is already in our DB to prevent duplicates
      const [existingFile] = await db.select().from(files).where(and(eq(files.driveFileId, f.driveFileId), eq(files.userId, userId)));
      if (existingFile) continue;

      let links = { webContentLink: null, webViewLink: null };
      try {
        const publicLinks = await DriveService.generatePublicLink(f.driveFileId, userId);
        links = publicLinks as any;
      } catch (err) {
        console.error("Could not generate public link for", f.fileName, err);
      }

      const [newFile] = await db.insert(files).values({
        userId,
        folderId: folderId && folderId !== 'root' ? folderId : null,
        driveFileId: f.driveFileId,
        fileName: f.fileName,
        fileType: f.mimeType,
        fileSize: f.size ? parseInt(f.size, 10) : 0,
        isPublic: true,
        webContentLink: links.webContentLink,
        webViewLink: links.webViewLink,
        posX: 0,
        posY: 0,
      }).returning();
      newFiles.push(newFile);
      
      await db.update(users)
        .set({ storageUsed: sql`${users.storageUsed} + ${f.size ? parseInt(f.size, 10) : 0}` })
        .where(eq(users.id, userId));
    }

    return c.json(successResponse(newFiles, 'Files synced successfully'), 201);
  } catch (error: any) {
    console.error('Sync error:', error);
    return c.json(errorResponse(error.message), 500);
  }
});
