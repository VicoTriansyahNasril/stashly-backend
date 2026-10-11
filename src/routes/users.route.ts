import { Hono } from 'hono';
import { authMiddleware } from '../middlewares/auth.middleware';
import { successResponse, errorResponse } from '../utils/response';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';

type Variables = {
  userId: string;
};

export const usersRoute = new Hono<{ Variables: Variables }>();

// GET /users/me - Get current user settings
usersRoute.get('/me', authMiddleware, async (c) => {
  try {
    const userId = c.get('userId');
    const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    
    if (!user || user.length === 0) {
      return c.json(errorResponse('User not found', 404), 404);
    }
    
    return c.json(successResponse(user[0], 'User fetched successfully'));
  } catch (error: any) {
    return c.json(errorResponse(error.message || 'Internal Server Error'), 500);
  }
});

// PUT /users/settings - Update user settings
usersRoute.put('/settings', authMiddleware, async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json();
    
    const { username, theme, layoutStyle } = body;
    
    const updateData: any = {};
    if (username !== undefined) updateData.username = username;
    if (theme !== undefined) updateData.theme = theme;
    if (layoutStyle !== undefined) updateData.layoutStyle = layoutStyle;

    const updated = await db.update(users)
      .set(updateData)
      .where(eq(users.id, userId))
      .returning();

    return c.json(successResponse(updated[0], 'Settings updated successfully'));
  } catch (error: any) {
    return c.json(errorResponse(error.message || 'Internal Server Error'), 500);
  }
});
