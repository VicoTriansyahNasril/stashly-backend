import * as bcrypt from 'bcryptjs';

export const ORIGIN = 'http://localhost:3000';
export const FILE_ID = '11111111-1111-4111-8111-111111111111';

let ipCounter = 0;
/** IP unik per request agar rate limiter tidak saling memengaruhi antar test. */
export const uniqueIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

export const jsonHeaders = (extra: Record<string, string> = {}) => ({
  'Content-Type': 'application/json',
  Origin: ORIGIN,
  'x-forwarded-for': uniqueIp(),
  ...extra,
});

export const fileRecord = (overrides: Record<string, unknown> = {}) => ({
  id: FILE_ID,
  userId: 'user-1',
  folderId: null,
  driveFileId: 'drive-file-abc123',
  fileName: 'foto.png',
  fileType: 'image/png',
  fileSize: 1234,
  isPublic: true,
  password: null as string | null,
  expiresAt: null as Date | null,
  webContentLink: 'https://drive.google.com/uc?id=drive-file-abc123&export=download',
  webViewLink: 'https://drive.google.com/file/d/drive-file-abc123/view',
  posX: 0,
  posY: 0,
  uploadedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null as Date | null,
  ...overrides,
});

export const hashPassword = (password: string) => bcrypt.hash(password, 4);

export const streamOf = (text: string) =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
