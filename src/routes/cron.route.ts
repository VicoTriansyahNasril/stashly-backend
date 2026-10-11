import { Hono } from 'hono';
import { db } from '../db';
import { files, users } from '../db/schema';
import { lte, isNotNull, eq, sql } from 'drizzle-orm';
import { DriveService } from '../services/drive.service';
import { successResponse, errorResponse } from '../utils/response';

export const cronRoute = new Hono();

// DELETE /cron/cleanup-trash
// Triggered by an external scheduler (e.g. Vercel Cron)
cronRoute.post('/cleanup-trash', async (c) => {
  try {
    // 1. Find files older than 30 days in the trash
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const expiredFiles = await db.select().from(files).where(
      lte(files.deletedAt, thirtyDaysAgo)
    );

    let deletedCount = 0;
    let failedCount = 0;

    for (const fileRecord of expiredFiles) {
      try {
        // Delete from Drive
        await DriveService.deleteFromDrive(fileRecord.driveFileId, fileRecord.userId);
        
        // Delete from DB
        await db.delete(files).where(eq(files.id, fileRecord.id));

        // Decrement Storage Usage (Atomic)
        await db.update(users)
           .set({ storageUsed: sql`GREATEST(0, ${users.storageUsed} - ${fileRecord.fileSize})` })
           .where(eq(users.id, fileRecord.userId));

        deletedCount++;
      } catch (e) {
        console.error(`Failed to cleanup file ${fileRecord.id}:`, e);
        failedCount++;
      }
    }

    return c.json(successResponse({ deletedCount, failedCount }, 'Trash cleanup completed'));
  } catch (error: any) {
    console.error('Cleanup trash error:', error);
    return c.json(errorResponse(error.message || 'Internal Server Error'), 500);
  }
});
