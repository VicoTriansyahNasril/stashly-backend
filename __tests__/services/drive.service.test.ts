import { beforeEach, describe, expect, it, vi } from 'vitest';

const driveMock = {
  files: { list: vi.fn(), delete: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() },
  permissions: { delete: vi.fn() },
};

vi.mock('../../src/lib/googleAuth', () => ({
  getDriveClient: vi.fn(async () => ({
    drive: driveMock,
    auth: { getAccessToken: async () => ({ token: 't' }), credentials: { refresh_token: 'refresh-123' } },
  })),
  invalidateDriveClient: vi.fn(),
}));

const { DriveService, DRIVE_FILE_SCOPE } = await import('../../src/services/drive.service');
const { AppError } = await import('../../src/lib/errors');

const googleError = (code: number, message: string, reason?: string) =>
  Object.assign(new Error(message), { code, errors: reason ? [{ reason }] : undefined });

describe('DriveService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hapus file yang sudah tidak ada (404) dianggap berhasil', async () => {
    driveMock.files.delete.mockRejectedValue(googleError(404, 'File not found: abc'));
    await expect(DriveService.deleteFromDrive('abc', 'u1')).resolves.toBeUndefined();
  });

  it('error Google tidak membocorkan detail internal ke pesan publik', async () => {
    driveMock.files.delete.mockRejectedValue(googleError(500, 'internal backend error token=SECRET'));
    const error = await DriveService.deleteFromDrive('abc', 'u1').catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(502);
    expect(error.message).not.toContain('SECRET');
  });

  it('kuota Drive penuh dipetakan ke pesan yang jelas', async () => {
    driveMock.files.create.mockRejectedValue(googleError(403, 'The user storage quota has been exceeded', 'storageQuotaExceeded'));
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    await expect(DriveService.uploadToDrive(file, 'u1')).rejects.toMatchObject({ status: 507 });
  });

  it('refresh token dicabut → 401 dengan instruksi login ulang', async () => {
    driveMock.files.get.mockRejectedValue(Object.assign(new Error('invalid_grant'), { response: { status: 400, data: { error: 'invalid_grant' } } }));
    await expect(DriveService.getFileMetadata('abcde12345', 'u1')).rejects.toMatchObject({ status: 401 });
  });

  it('mencabut akses publik: file yang memang tidak publik (404) diabaikan', async () => {
    driveMock.permissions.delete.mockRejectedValue(googleError(404, 'Permission not found'));
    await expect(DriveService.revokePublicAccess('abc', 'u1')).resolves.toBeUndefined();
    expect(driveMock.permissions.delete).toHaveBeenCalledWith({ fileId: 'abc', permissionId: 'anyoneWithLink' });
  });

  it('thumbnail tidak dikirim token ke host selain Google', async () => {
    driveMock.files.get.mockResolvedValue({ data: { thumbnailLink: 'https://evil.example.com/t=s220' } });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await DriveService.getThumbnail('abc', 'u1')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('menolak folder tujuan upload dengan karakter injection', async () => {
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    await expect(DriveService.uploadToDrive(file, 'u1', "x' or '1'='1")).rejects.toMatchObject({ status: 400 });
    expect(driveMock.files.create).not.toHaveBeenCalled();
  });

  it('metadata menyertakan folder induk dari Drive', async () => {
    driveMock.files.get.mockResolvedValue({
      data: { id: 'abcde12345', name: 'a.pdf', mimeType: 'application/pdf', size: '10', parents: ['parent_1'] },
    });
    await expect(DriveService.getFileMetadata('abcde12345', 'u1')).resolves.toMatchObject({ parentId: 'parent_1', size: 10 });
  });
});

describe('DriveService.getPickerAccessToken', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('meminta token yang di-downscope ke drive.file saja', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ access_token: 'ya29.short', expires_in: 3599 }), { status: 200 }));
    const result = await DriveService.getPickerAccessToken('u1');
    expect(result.accessToken).toBe('ya29.short');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(String(init!.body));
    expect(body.get('scope')).toBe(DRIVE_FILE_SCOPE);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('refresh-123');
  });

  it('refresh token lama tanpa izin drive.file → 401 minta login ulang', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_scope' }), { status: 400 }));
    const error = await DriveService.getPickerAccessToken('u1').catch((e) => e);
    expect(error.status).toBe(401);
    expect(error.message).toContain('login kembali');
  });

  it('error lain dari Google tidak membocorkan detail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'server_error', error_description: 'SECRET' }), { status: 500 }),
    );
    const error = await DriveService.getPickerAccessToken('u1').catch((e) => e);
    expect(error.status).toBe(502);
    expect(error.message).not.toContain('SECRET');
  });
});
