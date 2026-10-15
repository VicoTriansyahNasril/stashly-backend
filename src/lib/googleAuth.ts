import { google, drive_v3 } from 'googleapis';
import { db } from '../db';
import { accounts } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { AppError } from './errors';

type DriveClient = { drive: drive_v3.Drive; auth: InstanceType<typeof google.auth.OAuth2> };

// Cache singkat agar setiap request tidak perlu query DB + membuat OAuth client baru.
// TTL pendek memastikan refresh token yang dicabut/diganti cepat terbaca ulang.
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 1000;
const cache = new Map<string, { client: DriveClient; expiresAt: number }>();

export const getDriveClient = async (userId: string): Promise<DriveClient> => {
  const cached = cache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.client;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not defined');
  }

  const [account] = await db
    .select({ refreshToken: accounts.refresh_token })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, 'google')));

  if (!account?.refreshToken) {
    throw new AppError(401, 'Akun Google Drive belum terhubung. Silakan logout lalu login kembali.');
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: account.refreshToken });
  const client = { drive: google.drive({ version: 'v3', auth }), auth };

  if (cache.size >= MAX_CACHE_SIZE) cache.clear();
  cache.set(userId, { client, expiresAt: Date.now() + CACHE_TTL_MS });
  return client;
};

export const invalidateDriveClient = (userId: string) => cache.delete(userId);
