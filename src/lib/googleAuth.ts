import { google } from 'googleapis';
import { db } from '../db';
import { accounts } from '../db/schema';
import { eq, and } from 'drizzle-orm';

export const getOAuthDriveService = async (userId: string) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) are not defined');
  }

  const [account] = await db.select().from(accounts).where(
    and(
      eq(accounts.userId, userId),
      eq(accounts.provider, 'google')
    )
  );

  if (!account || !account.refresh_token) {
    throw new Error('User has not connected Google Drive or refresh_token is missing');
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({
    refresh_token: account.refresh_token,
  });

  return google.drive({ version: 'v3', auth: oauth2Client });
};
