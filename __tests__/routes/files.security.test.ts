import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calledWith, dbError, queueResults, resetDb } from '../helpers/mockDb';
import { FILE_ID, ORIGIN, fileRecord, hashPassword, jsonHeaders, streamOf, uniqueIp } from '../helpers/testApp';

vi.mock('../../src/db', async () => await import('../helpers/mockDb'));

vi.mock('../../src/middlewares/auth.middleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('userId', 'user-1');
    await next();
  },
}));

vi.mock('../../src/services/drive.service', () => ({
  DriveService: {
    uploadToDrive: vi.fn(),
    deleteFromDrive: vi.fn(),
    revokePublicAccess: vi.fn(),
    getFileMetadata: vi.fn(),
    downloadStream: vi.fn(),
    getThumbnail: vi.fn(),
    renameFile: vi.fn(),
    listFolders: vi.fn(),
    createFolder: vi.fn(),
  },
}));

const { default: app } = await import('../../src/app');
const { DriveService } = await import('../../src/services/drive.service');
const drive = vi.mocked(DriveService);

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
  drive.downloadStream.mockResolvedValue(streamOf('file-content') as any);
  drive.deleteFromDrive.mockResolvedValue(undefined);
  drive.revokePublicAccess.mockResolvedValue(undefined);
});

describe('Kebocoran data publik', () => {
  it('GET /files/public tidak membocorkan password hash, driveFileId, link Drive, atau userId', async () => {
    queueResults(
      [{ id: 'user-1' }], // lookup username
      [fileRecord({ password: await hashPassword('rahasia') })], // files
      [{ count: 1 }], // count
    );

    const res = await app.request('/files/public?username=budi');
    expect(res.status).toBe(200);
    const body = await res.json();
    const [file] = body.data.files;

    expect(file).toEqual({
      id: FILE_ID,
      fileName: 'foto.png',
      fileType: 'image/png',
      fileSize: 1234,
      uploadedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: null,
      hasPassword: true,
    });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('drive-file-abc123');
    expect(raw).not.toContain('$2');
    expect(raw).not.toContain('user-1');
  });

  it('GET /files/public/:id juga hanya mengirim field whitelist', async () => {
    queueResults([fileRecord()]);
    const res = await app.request(`/files/public/${FILE_ID}`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(Object.keys(body.data).sort()).toEqual(
      ['expiresAt', 'fileName', 'fileSize', 'fileType', 'hasPassword', 'id', 'uploadedAt'].sort(),
    );
  });

  it('GET /files/list (owner) tidak mengirim hash password', async () => {
    queueResults([fileRecord({ password: await hashPassword('x1234') })], [{ count: 1 }]);
    const res = await app.request('/files/list');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.files[0].hasPassword).toBe(true);
    expect(body.data.files[0]).not.toHaveProperty('password');
  });
});

describe('Akses file publik', () => {
  it('ID bukan UUID ditolak 400 (tanpa query ke DB)', async () => {
    const res = await app.request("/files/public/1' OR '1'='1");
    expect(res.status).toBe(400);
    expect(calledWith('select')).toHaveLength(0);
  });

  it('file privat / di trash / tidak ada → 404', async () => {
    queueResults([]);
    const res = await app.request(`/files/public/${FILE_ID}/stream`);
    expect(res.status).toBe(404);
    expect(drive.downloadStream).not.toHaveBeenCalled();
  });

  it('file kedaluwarsa → 410', async () => {
    queueResults([fileRecord({ expiresAt: new Date(Date.now() - 1000) })]);
    const res = await app.request(`/files/public/${FILE_ID}/stream`);
    expect(res.status).toBe(410);
    expect(drive.downloadStream).not.toHaveBeenCalled();
  });

  it('file berpassword tanpa token → 401', async () => {
    queueResults([fileRecord({ password: await hashPassword('rahasia') })]);
    const res = await app.request(`/files/public/${FILE_ID}/stream`);
    expect(res.status).toBe(401);
    expect(drive.downloadStream).not.toHaveBeenCalled();
  });

  it('password via query string tidak lagi diterima', async () => {
    queueResults([fileRecord({ password: await hashPassword('rahasia') })]);
    const res = await app.request(`/files/public/${FILE_ID}/stream?password=rahasia`);
    expect(res.status).toBe(401);
  });

  it('alur unlock: password salah 403, benar → token yang bisa dipakai untuk stream', async () => {
    const hash = await hashPassword('rahasia');
    const ip = uniqueIp();

    queueResults([fileRecord({ password: hash })]);
    const wrong = await app.request(`/files/public/${FILE_ID}/unlock`, {
      method: 'POST',
      headers: jsonHeaders({ 'x-forwarded-for': ip }),
      body: JSON.stringify({ password: 'salah' }),
    });
    expect(wrong.status).toBe(403);

    queueResults([fileRecord({ password: hash })]);
    const ok = await app.request(`/files/public/${FILE_ID}/unlock`, {
      method: 'POST',
      headers: jsonHeaders({ 'x-forwarded-for': ip }),
      body: JSON.stringify({ password: 'rahasia' }),
    });
    expect(ok.status).toBe(200);
    const { data } = await ok.json();
    expect(data.token).toMatch(/^\d+\.[\w-]+$/);

    queueResults([fileRecord({ password: hash })]);
    const stream = await app.request(`/files/public/${FILE_ID}/stream?token=${encodeURIComponent(data.token)}`);
    expect(stream.status).toBe(200);
    expect(await stream.text()).toBe('file-content');

    // Token tidak berlaku lagi setelah password diganti
    queueResults([fileRecord({ password: await hashPassword('baru123') })]);
    const stale = await app.request(`/files/public/${FILE_ID}/stream?token=${encodeURIComponent(data.token)}`);
    expect(stale.status).toBe(401);
  });

  it('unlock dibatasi rate limit (anti brute force)', async () => {
    const ip = uniqueIp();
    const hash = await hashPassword('rahasia');
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      queueResults([fileRecord({ password: hash })]);
      const res = await app.request(`/files/public/${FILE_ID}/unlock`, {
        method: 'POST',
        headers: jsonHeaders({ 'x-forwarded-for': ip }),
        body: JSON.stringify({ password: `tebak-${i}` }),
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 403)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe('Header respons file (anti XSS)', () => {
  it('file HTML dipaksa download sebagai octet-stream dengan CSP ketat', async () => {
    queueResults([fileRecord({ fileType: 'text/html', fileName: 'x.html' })]);
    const res = await app.request(`/files/public/${FILE_ID}/stream`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('content-security-policy')).toContain(`frame-ancestors ${ORIGIN}`);
  });

  it('SVG (bisa berisi script) tidak pernah ditampilkan inline', async () => {
    queueResults([fileRecord({ fileType: 'image/svg+xml', fileName: 'logo.svg' })]);
    const res = await app.request(`/files/public/${FILE_ID}/stream`);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
  });

  it('gambar aman ditampilkan inline; nama file berbahaya di-escape', async () => {
    queueResults([fileRecord({ fileName: 'a"b\\c ünï.png' })]);
    const res = await app.request(`/files/public/${FILE_ID}/stream`);
    expect(res.headers.get('content-type')).toBe('image/png');
    const disposition = res.headers.get('content-disposition')!;
    expect(disposition).toBe(`inline; filename="a_b_c _n_.png"; filename*=UTF-8''a%22b%5Cc%20%C3%BCn%C3%AF.png`);
  });

  it('?download=1 memaksa attachment', async () => {
    queueResults([fileRecord()]);
    const res = await app.request(`/files/public/${FILE_ID}/stream?download=1`);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
  });

  it('respons JSON API memakai CSP default yang ketat', async () => {
    const res = await app.request('/');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; frame-ancestors 'none'");
  });
});

describe('Validasi input & injection', () => {
  it('limit di luar batas ditolak', async () => {
    const res = await app.request('/files/list?limit=100000');
    expect(res.status).toBe(400);
  });

  it('page bukan angka ditolak 400, bukan 500', async () => {
    const res = await app.request('/files/list?page=abc');
    expect(res.status).toBe(400);
  });

  it('sort/type di luar whitelist ditolak', async () => {
    expect((await app.request('/files/list?sort=password')).status).toBe(400);
    expect((await app.request('/files/list?type=%25')).status).toBe(400);
  });

  it('wildcard LIKE pada pencarian di-escape', async () => {
    queueResults([], [{ count: 0 }]);
    const res = await app.request('/files/list?search=100%25_off');
    expect(res.status).toBe(200);
    const { PgDialect } = await import('drizzle-orm/pg-core');
    const query = new PgDialect().sqlToQuery(calledWith('where')[0].args[0] as any);
    expect(query.sql).toContain('ilike');
    expect(query.params).toContain('%100\\%\\_off%');
  });

  it('endpoint listing isi Drive sudah tidak ada (scope drive.file)', async () => {
    expect((await app.request('/files/drive-files?folderId=root')).status).toBe(404);
    expect((await app.request('/files/drive-stream/abcdef12345')).status).toBe(404);
  });

  it('JSON rusak → 400', async () => {
    queueResults([fileRecord()]);
    const res = await app.request(`/files/${FILE_ID}/rename`, {
      method: 'PUT',
      headers: jsonHeaders(),
      body: '{bukan json',
    });
    expect(res.status).toBe(400);
  });

  it('rename menolak nama dengan karakter kontrol / path', async () => {
    for (const fileName of ['a\r\nb', '../etc/passwd', '']) {
      queueResults([fileRecord()]);
      const res = await app.request(`/files/${FILE_ID}/rename`, {
        method: 'PUT',
        headers: jsonHeaders(),
        body: JSON.stringify({ fileName }),
      });
      expect(res.status).toBe(400);
    }
    expect(drive.renameFile).not.toHaveBeenCalled();
  });

  it('posisi non-numerik/ekstrem ditolak', async () => {
    const res = await app.request(`/files/${FILE_ID}/position`, {
      method: 'PUT',
      headers: jsonHeaders(),
      body: JSON.stringify({ posX: 1e12, posY: 0 }),
    });
    expect(res.status).toBe(400);
  });
});

describe('CSRF', () => {
  it('request pengubah data dari origin lain ditolak', async () => {
    const res = await app.request(`/files/${FILE_ID}`, {
      method: 'DELETE',
      headers: { Origin: 'https://evil.example', 'x-forwarded-for': uniqueIp() },
    });
    expect(res.status).toBe(403);
    expect(calledWith('update')).toHaveLength(0);
  });

  it('request lintas situs tanpa Origin ditolak', async () => {
    const res = await app.request(`/files/${FILE_ID}`, {
      method: 'DELETE',
      headers: { 'Sec-Fetch-Site': 'cross-site', 'x-forwarded-for': uniqueIp() },
    });
    expect(res.status).toBe(403);
  });

  it('request dari origin frontend diizinkan', async () => {
    queueResults([fileRecord()], []);
    const res = await app.request(`/files/${FILE_ID}`, { method: 'DELETE', headers: jsonHeaders() });
    expect(res.status).toBe(200);
  });
});

describe('Pengaturan berbagi', () => {
  it('menyimpan password sebagai hash bcrypt dan mencabut akses publik Drive', async () => {
    queueResults([fileRecord()], [fileRecord({ password: 'hashed' })]);
    const res = await app.request(`/files/${FILE_ID}/share`, {
      method: 'PUT',
      headers: jsonHeaders(),
      body: JSON.stringify({ password: 'rahasia123', isPublic: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.hasPassword).toBe(true);
    expect(body.data).not.toHaveProperty('password');

    const setArgs = calledWith('set')[0].args[0] as { password: string };
    expect(setArgs.password).toMatch(/^\$2[aby]\$12\$/);
    expect(drive.revokePublicAccess).toHaveBeenCalledWith('drive-file-abc123', 'user-1');
  });

  it('menolak tanggal kedaluwarsa di masa lalu dan field tak dikenal', async () => {
    queueResults([fileRecord()]);
    const past = await app.request(`/files/${FILE_ID}/share`, {
      method: 'PUT',
      headers: jsonHeaders(),
      body: JSON.stringify({ expiresAt: '2000-01-01T00:00:00Z' }),
    });
    expect(past.status).toBe(400);

    queueResults([fileRecord()]);
    const unknown = await app.request(`/files/${FILE_ID}/share`, {
      method: 'PUT',
      headers: jsonHeaders(),
      body: JSON.stringify({ userId: 'user-2' }),
    });
    expect(unknown.status).toBe(400);
  });
});

describe('Upload', () => {
  const upload = (file: File, fields: Record<string, string> = {}) => {
    const form = new FormData();
    form.append('file', file);
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    return app.request('/files/upload', {
      method: 'POST',
      body: form,
      headers: { Origin: ORIGIN, 'x-forwarded-for': uniqueIp() },
    });
  };
  const png = () =>
    new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])], 'foto.png', { type: 'image/png' });

  it('menolak file yang isinya tidak sesuai MIME (MIME spoofing)', async () => {
    const fake = new File(['<script>alert(1)</script>'], 'evil.png', { type: 'image/png' });
    const res = await upload(fake);
    expect(res.status).toBe(400);
    expect(drive.uploadToDrive).not.toHaveBeenCalled();
  });

  it('menolak tipe file di luar whitelist', async () => {
    const res = await upload(new File(['<html>'], 'a.html', { type: 'text/html' }));
    expect(res.status).toBe(400);
  });

  it('menyimpan ID folder Drive (bukan UUID) dengan benar', async () => {
    drive.uploadToDrive.mockResolvedValue({ id: 'new-drive-id', webViewLink: null });
    queueResults([{ id: 'user-1' }], [fileRecord({ folderId: 'folderDrive_123' })]);
    const res = await upload(png(), { folderId: 'folderDrive_123' });
    expect(res.status).toBe(201);
    expect(drive.uploadToDrive).toHaveBeenCalledWith(expect.any(File), 'user-1', 'folderDrive_123');
    const values = calledWith('values')[0].args[0] as { folderId: string };
    expect(values.folderId).toBe('folderDrive_123');
  });

  it('folderId upload dengan karakter injection ditolak sebelum menyentuh kuota/Drive', async () => {
    const res = await upload(png(), { folderId: "x' or name contains 'a" });
    expect(res.status).toBe(400);
    expect(calledWith('update')).toHaveLength(0);
    expect(drive.uploadToDrive).not.toHaveBeenCalled();
  });

  it('kuota tidak cukup → 400 dan tidak ada upload ke Drive', async () => {
    queueResults([]); // UPDATE reservasi kuota tidak mengenai baris apa pun
    const res = await upload(png());
    expect(res.status).toBe(400);
    expect(drive.uploadToDrive).not.toHaveBeenCalled();
  });

  it('jika simpan ke DB gagal: kuota dikembalikan & file yatim di Drive dihapus, pesan error tidak bocor', async () => {
    drive.uploadToDrive.mockResolvedValue({ id: 'orphan-id', webViewLink: null });
    queueResults([{ id: 'user-1' }], dbError(new Error('duplicate key value violates constraint "secret_internal"')));
    const res = await upload(png());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('secret_internal');
    expect(drive.deleteFromDrive).toHaveBeenCalledWith('orphan-id', 'user-1');
    expect(calledWith('update')).toHaveLength(2); // reservasi + pengembalian kuota
  });
});

describe('Sinkronisasi Drive', () => {
  it('metadata & folder induk diambil dari Drive, bukan dari client; file Google Docs dilewati', async () => {
    drive.getFileMetadata.mockImplementation(async (id: string) =>
      id === 'docId_12345'
        ? { id, name: 'Doc', mimeType: 'application/vnd.google-apps.document', size: 0, webViewLink: null, parentId: null }
        : { id, name: 'asli.pdf', mimeType: 'application/pdf', size: 2048, webViewLink: null, parentId: 'parentFolder_1' },
    );
    queueResults([], [{ id: 'user-1' }], [fileRecord({ fileName: 'asli.pdf' })]);

    const res = await app.request('/files/sync', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ driveFileIds: ['pdfId_12345', 'docId_12345'] }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.skipped).toBe(1);
    const values = calledWith('values')[0].args[0] as Array<{ fileName: string; fileSize: number; isPublic: boolean }>;
    expect(values).toEqual([
      expect.objectContaining({ fileName: 'asli.pdf', fileSize: 2048, isPublic: false, folderId: 'parentFolder_1' }),
    ]);
  });
});

describe('Hapus permanen', () => {
  it('jika hapus di Drive gagal, data DB tidak dihapus', async () => {
    const { AppError } = await import('../../src/lib/errors');
    drive.deleteFromDrive.mockRejectedValue(new AppError(502, 'Gagal menghapus file di Google Drive'));
    queueResults([fileRecord()]);
    const res = await app.request(`/files/${FILE_ID}/force`, { method: 'DELETE', headers: jsonHeaders() });
    expect(res.status).toBe(502);
    expect(calledWith('delete')).toHaveLength(0);
  });
});
