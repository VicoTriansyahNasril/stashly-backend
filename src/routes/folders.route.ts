import { Hono } from 'hono';
import { authMiddleware } from '../middlewares/auth.middleware';
import { DriveService } from '../services/drive.service';
import { successResponse, errorResponse } from '../utils/response';
import { db } from '../db';
import { folders } from '../db/schema';
import { eq, and } from 'drizzle-orm';

type Variables = {
  userId: string;
};

export const foldersRoute = new Hono<{ Variables: Variables }>();

// GET /folders (List all folders in user's DB/Drive)
foldersRoute.get('/', authMiddleware, async (c) => {
  try {
    const userId = c.get('userId');
    // Fetch directly from Google Drive to ensure all actual folders are shown
    const folders = await DriveService.listFolders(userId);
    return c.json(successResponse(folders, 'Folders retrieved successfully'));
  } catch (error: any) {
    console.error('List folders error:', error);
    return c.json(errorResponse(error.message || 'Internal Server Error'), 500);
  }
});

// POST /folders (Create a new folder in user's Drive and DB)
foldersRoute.post('/', authMiddleware, async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json();
    const folderName = body.name;

    if (!folderName || typeof folderName !== 'string') {
      return c.json(errorResponse('Folder name is required', 400), 400);
    }

    const driveFolder = await DriveService.createFolder(folderName, userId);
    
    // Insert into DB
    const [newFolder] = await db.insert(folders).values({
      userId,
      driveFolderId: driveFolder.id!,
      name: folderName,
      posX: 0,
      posY: 0,
    }).returning();

    return c.json(successResponse(newFolder, 'Folder created successfully'), 201);
  } catch (error: any) {
    console.error('Create folder error:', error);
    return c.json(errorResponse(error.message || 'Internal Server Error'), 500);
  }
});

// PUT /folders/:id/position (Protected)
foldersRoute.put('/:id/position', authMiddleware, async (c) => {
  try {
    const folderId = c.req.param('id') as string;
    const userId = c.get('userId') as string;
    const body = await c.req.json();
    const { posX, posY } = body;

    if (typeof posX !== 'number' || typeof posY !== 'number') {
      return c.json(errorResponse('posX and posY are required and must be numbers', 400), 400);
    }

    const [updatedFolder] = await db.update(folders)
      .set({ posX, posY })
      .where(and(eq(folders.id, folderId), eq(folders.userId, userId)))
      .returning();

    if (!updatedFolder) {
      return c.json(errorResponse('Folder not found', 404), 404);
    }

    return c.json(successResponse(updatedFolder, 'Position updated'));
  } catch (error: any) {
    console.error('Update position error:', error);
    return c.json(errorResponse(error.message || 'Internal Server Error'), 500);
  }
});
