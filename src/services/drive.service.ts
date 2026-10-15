import { Readable } from 'stream';
import type { ReadableStream as NodeWebReadableStream } from 'stream/web';
import { getDriveClient, invalidateDriveClient } from '../lib/googleAuth';
import { AppError } from '../lib/errors';
import { driveFolderIdSchema, driveIdSchema, parseOrThrow } from '../lib/validation';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

/**
 * Stashly hanya meminta scope `drive.file`: aplikasi hanya bisa mengakses file yang dibuat
 * lewat Stashly atau yang dipilih sendiri oleh pengguna melalui Google Picker.
 */
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

const statusOf = (error: any): number | undefined => error?.code ?? error?.response?.status;

/** Ubah error Google API menjadi AppError dengan pesan aman; detail asli hanya masuk log. */
const toDriveError = (error: any, action: string, userId?: string): AppError => {
  if (error instanceof AppError) return error;
  console.error(`[drive] gagal ${action}:`, error?.message ?? error);

  const status = statusOf(error);
  const reason = error?.errors?.[0]?.reason ?? error?.response?.data?.error;
  const message = String(error?.message ?? '').toLowerCase();

  if (reason === 'invalid_grant' || status === 401) {
    if (userId) invalidateDriveClient(userId);
    return new AppError(401, 'Akses Google Drive kedaluwarsa atau dicabut. Silakan logout lalu login kembali.', error);
  }
  if (reason === 'storageQuotaExceeded' || message.includes('quota') && message.includes('storage')) {
    return new AppError(507, 'Kapasitas Google Drive Anda penuh. Kosongkan sebagian ruang lalu coba lagi.', error);
  }
  if (status === 404) return new AppError(404, 'File tidak ditemukan di Google Drive', error);
  if (status === 403 || status === 429) {
    return new AppError(503, 'Google Drive sedang membatasi permintaan. Coba lagi sebentar lagi.', error);
  }
  return new AppError(502, `Gagal ${action} di Google Drive`, error);
};

export type DriveFileMetadata = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  webViewLink: string | null;
  /** Folder induk di Drive (null jika tidak diketahui / root). */
  parentId: string | null;
};

export class DriveService {
  static async uploadToDrive(
    file: File,
    userId: string,
    targetFolderId?: string,
  ): Promise<{ id: string; webViewLink: string | null }> {
    const { drive } = await getDriveClient(userId);
    const folderId = targetFolderId ? parseOrThrow(driveFolderIdSchema, targetFolderId) : 'root';

    try {
      const response = await drive.files.create({
        requestBody: {
          name: file.name,
          ...(folderId !== 'root' && { parents: [folderId] }),
        },
        // Stream untuk menghindari buffer ganda pada file besar
        media: { mimeType: file.type, body: Readable.fromWeb(file.stream() as NodeWebReadableStream) },
        fields: 'id, webViewLink',
      });
      return { id: response.data.id!, webViewLink: response.data.webViewLink ?? null };
    } catch (error) {
      throw toDriveError(error, 'mengunggah file', userId);
    }
  }

  /** Hapus file dari Drive. File yang sudah tidak ada (404) dianggap berhasil dihapus. */
  static async deleteFromDrive(fileId: string, userId: string): Promise<void> {
    const { drive } = await getDriveClient(userId);
    try {
      await drive.files.delete({ fileId });
    } catch (error) {
      if (statusOf(error) === 404) return;
      throw toDriveError(error, 'menghapus file', userId);
    }
  }

  /**
   * Cabut akses "siapa saja yang memiliki link". Semua akses publik kini lewat backend
   * (yang menegakkan password, kedaluwarsa, dan status trash), jadi file di Drive harus privat.
   */
  static async revokePublicAccess(fileId: string, userId: string): Promise<void> {
    const { drive } = await getDriveClient(userId);
    try {
      await drive.permissions.delete({ fileId, permissionId: 'anyoneWithLink' });
    } catch (error) {
      if (statusOf(error) === 404) return; // memang tidak publik
      throw toDriveError(error, 'mencabut akses publik', userId);
    }
  }

  static async getFileMetadata(driveFileId: string, userId: string): Promise<DriveFileMetadata> {
    parseOrThrow(driveIdSchema, driveFileId);
    const { drive } = await getDriveClient(userId);
    try {
      const { data } = await drive.files.get({
        fileId: driveFileId,
        fields: 'id, name, mimeType, size, webViewLink, trashed, parents',
      });
      if (data.trashed || data.mimeType === FOLDER_MIME) throw new AppError(404, 'File tidak ditemukan di Google Drive');
      return {
        id: data.id!,
        name: data.name ?? 'file',
        mimeType: data.mimeType ?? 'application/octet-stream',
        size: data.size ? Number(data.size) : 0,
        webViewLink: data.webViewLink ?? null,
        parentId: data.parents?.[0] ?? null,
      };
    } catch (error) {
      throw toDriveError(error, 'mengambil info file', userId);
    }
  }

  static async downloadStream(driveFileId: string, userId: string): Promise<ReadableStream> {
    const { drive } = await getDriveClient(userId);
    try {
      const response = await drive.files.get({ fileId: driveFileId, alt: 'media' }, { responseType: 'stream' });
      return Readable.toWeb(response.data as Readable) as unknown as ReadableStream;
    } catch (error) {
      throw toDriveError(error, 'mengambil file', userId);
    }
  }

  /** Thumbnail kecil dari Drive (jauh lebih ringan daripada streaming file asli). Null jika tidak tersedia. */
  static async getThumbnail(driveFileId: string, userId: string, size = 480): Promise<Response | null> {
    const { drive, auth } = await getDriveClient(userId);
    try {
      const { data } = await drive.files.get({ fileId: driveFileId, fields: 'thumbnailLink' });
      if (!data.thumbnailLink) return null;

      const url = data.thumbnailLink.replace(/=s\d+$/, `=s${size}`);
      // Hanya kirim token ke domain Google untuk mencegah token bocor ke host lain.
      if (!/^https:\/\/[a-z0-9.-]+\.(googleusercontent|google)\.com\//.test(url)) return null;

      const { token } = await auth.getAccessToken();
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      return res.ok && res.body ? res : null;
    } catch (error) {
      if (statusOf(error) === 404) return null;
      throw toDriveError(error, 'mengambil thumbnail', userId);
    }
  }

  static async renameFile(driveFileId: string, name: string, userId: string): Promise<void> {
    const { drive } = await getDriveClient(userId);
    try {
      await drive.files.update({ fileId: driveFileId, requestBody: { name } });
    } catch (error) {
      throw toDriveError(error, 'mengganti nama file', userId);
    }
  }

  static async listFolders(userId: string) {
    const { drive } = await getDriveClient(userId);
    try {
      const response = await drive.files.list({
        q: `mimeType='${FOLDER_MIME}' and trashed=false and 'me' in owners`,
        fields: 'files(id, name)',
        orderBy: 'name',
        pageSize: 1000,
        spaces: 'drive',
      });
      return response.data.files || [];
    } catch (error) {
      throw toDriveError(error, 'mengambil daftar folder', userId);
    }
  }

  /**
   * Access token berumur pendek untuk Google Picker di browser. Token di-downscope ke
   * `drive.file` saja, sehingga browser tidak pernah memegang token dengan akses lebih luas
   * walaupun refresh token lama pengguna masih memiliki scope `drive`.
   */
  static async getPickerAccessToken(userId: string): Promise<{ accessToken: string; expiresAt: number }> {
    const { auth } = await getDriveClient(userId);
    const refreshToken = auth.credentials.refresh_token;
    if (!refreshToken) throw new AppError(401, 'Akun Google Drive belum terhubung. Silakan logout lalu login kembali.');

    let res: Response;
    try {
      res = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID ?? '',
          client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
          scope: DRIVE_FILE_SCOPE,
        }),
      });
    } catch (error) {
      throw toDriveError(error, 'menghubungi Google', userId);
    }

    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !body.access_token) {
      console.error('[drive] gagal membuat token picker:', res.status, body.error);
      if (body.error === 'invalid_grant' || body.error === 'invalid_scope') {
        invalidateDriveClient(userId);
        throw new AppError(401, 'Izin Google Drive perlu diperbarui. Silakan logout lalu login kembali.');
      }
      throw new AppError(502, 'Gagal mendapatkan akses Google Drive');
    }

    return { accessToken: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  }

  static async createFolder(name: string, userId: string) {
    const { drive } = await getDriveClient(userId);
    try {
      const response = await drive.files.create({
        requestBody: { name, mimeType: FOLDER_MIME },
        fields: 'id, name',
      });
      return response.data;
    } catch (error) {
      throw toDriveError(error, 'membuat folder', userId);
    }
  }
}
