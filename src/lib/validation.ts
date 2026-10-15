import { z } from 'zod';
import { badRequest } from './errors';

export const parseOrThrow = <T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> => {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length ? `${issue.path.join('.')}: ` : '';
    throw badRequest(`${path}${issue.message}`);
  }
  return result.data;
};

export const uuidSchema = z.string().uuid('ID tidak valid');

// ID Google Drive hanya berisi karakter URL-safe. Validasi ini mencegah injection ke query Drive (`q`).
export const driveIdSchema = z.string().regex(/^[A-Za-z0-9_-]{5,200}$/, 'ID Google Drive tidak valid');
export const driveFolderIdSchema = z.union([z.literal('root'), driveIdSchema]);

// Tidak boleh ada karakter kontrol (mencegah header injection & nama file aneh).
const noControlChars = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);

export const fileNameSchema = z
  .string()
  .trim()
  .min(1, 'Nama tidak boleh kosong')
  .max(255, 'Nama maksimal 255 karakter')
  .refine(noControlChars, 'Nama mengandung karakter tidak valid')
  .refine((v) => !/[\\/]/.test(v), 'Nama tidak boleh mengandung / atau \\');

export const sharePasswordSchema = z
  .string()
  .min(4, 'Password minimal 4 karakter')
  .max(128, 'Password maksimal 128 karakter');

export const futureDateSchema = z
  .string()
  .datetime({ offset: true, message: 'Format tanggal tidak valid' })
  .transform((v) => new Date(v))
  .refine((d) => d.getTime() > Date.now(), 'Tanggal kedaluwarsa harus di masa depan');

export const positionSchema = z.object({
  posX: z.number().finite().min(-100_000).max(100_000).transform(Math.round),
  posY: z.number().finite().min(-100_000).max(100_000).transform(Math.round),
});

export const FILE_TYPE_FILTERS = {
  image: 'image/',
  video: 'video/',
  pdf: 'application/pdf',
} as const;

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  search: z.string().trim().max(100).default(''),
  sort: z.enum(['newest', 'oldest', 'name_asc', 'name_desc', 'size_desc']).default('newest'),
  type: z.union([z.literal(''), z.enum(['image', 'video', 'pdf'])]).default(''),
});

export const publicListQuerySchema = z.object({
  username: z.string().trim().min(1).max(64),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});

/** Escape karakter wildcard LIKE agar input pencarian diperlakukan sebagai teks biasa. */
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);

export const RESERVED_USERNAMES = new Set([
  'admin', 'api', 'app', 'assets', 'auth', 'dashboard', 'favicon.ico', 'files', 'help',
  'icon.png', 'login', 'logout', 'me', 'privacy', 'public', 's', 'settings', 'stashly', 'support', 'terms', 'trash', 'www',
]);

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9](?:[a-z0-9_-]{1,28})[a-z0-9]$/,
    'Username 3-30 karakter: huruf kecil, angka, - atau _, dan tidak diawali/diakhiri simbol',
  )
  .refine((v) => !RESERVED_USERNAMES.has(v), 'Username ini tidak dapat digunakan');

export const settingsSchema = z
  .object({
    username: usernameSchema.nullable().optional(),
    layoutStyle: z.enum(['grid', 'list', 'canvas']).optional(),
  })
  .strict();

export const shareSettingsSchema = z
  .object({
    isPublic: z.boolean().optional(),
    // undefined = tidak diubah, null = hapus password
    password: sharePasswordSchema.nullable().optional(),
    expiresAt: futureDateSchema.nullable().optional(),
  })
  .strict();

export const unlockSchema = z.object({ password: z.string().min(1, 'Password wajib diisi').max(128) });

export const createFolderSchema = z.object({ name: fileNameSchema });

export const renameSchema = z.object({ fileName: fileNameSchema });

export const syncSchema = z.object({
  driveFileIds: z.array(driveIdSchema).min(1, 'Tidak ada file yang dipilih').max(100, 'Maksimal 100 file per sinkronisasi'),
});
