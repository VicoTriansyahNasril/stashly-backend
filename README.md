# Stashly Backend

REST API untuk Stashly — aplikasi untuk mengunggah dan membagikan file yang disimpan di **Google Drive milik
masing-masing pengguna**. Backend ini menangani upload ke Drive, pengaturan berbagi (publik/privat, password,
kedaluwarsa), streaming file publik, tong sampah, dan kuota.

Frontend: [stashly-frontend](https://github.com/VicoTriansyahNasril/stashly-frontend)

## Tech Stack
- **Runtime**: Node.js 20+ dengan TypeScript
- **Framework**: Hono (`@hono/node-server`)
- **ORM**: Drizzle ORM (PostgreSQL)
- **Validasi**: Zod
- **Integrasi**: Google Drive API v3 dengan OAuth per pengguna (scope `drive.file`)
- **Test**: Vitest

## Cara Kerja Singkat
- Pengguna login lewat frontend (NextAuth + Google). Refresh token Google disimpan di tabel `account`, dan
  cookie sesi NextAuth diverifikasi backend langsung ke tabel `session`.
- File disimpan di Google Drive pengguna. Stashly hanya meminta scope **`drive.file`**, jadi aplikasi hanya bisa
  mengakses file/folder yang dibuat lewat Stashly atau yang dipilih pengguna lewat Google Picker.
- File di Drive tetap **privat**. Semua akses publik lewat backend, yang menegakkan status publik, password,
  batas waktu, dan tong sampah.

## Instalasi
```bash
npm install
cp .env.example .env   # lalu isi nilainya
```

### Environment
| Variabel | Wajib | Keterangan |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL, **sama** dengan frontend |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ✅ | OAuth client yang sama dengan frontend |
| `ALLOWED_ORIGIN` | ✅ | URL frontend persis, untuk CORS, CSRF, dan `frame-ancestors` |
| `STREAM_TOKEN_SECRET` | ✅ | String acak ≥ 32 karakter untuk token akses file berpassword |
| `CRON_SECRET` | – | String acak ≥ 16 karakter; jika kosong endpoint cron nonaktif |
| `TRUST_PROXY` | – | `true` hanya jika di belakang reverse proxy tepercaya |
| `PORT` | – | Default `3001` |

Buat secret acak dengan:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### Database
Jalankan PostgreSQL lokal (opsional) lalu terapkan migrasi:
```bash
docker compose up -d        # PostgreSQL lokal di port 5432
npm run db:migrate          # terapkan migrasi di folder drizzle/
```
Saat mengubah `src/db/schema.ts`, buat migrasi baru dengan `npm run db:generate` lalu commit folder `drizzle/`.

### Migrasi satu kali untuk data lama
File yang diunggah oleh versi lama diberi izin "anyone with link" langsung di Google Drive, sehingga bisa
melewati password atau batas waktu. Cabut izin tersebut sekali saja:
```bash
npm run revoke-public-links
```

## Menjalankan
```bash
npm run dev          # development (hot reload)
npm run build        # compile TypeScript ke dist/
npm start            # production
```

## Test
```bash
npm test             # unit & integration test (Vitest)
npm run typecheck    # pengecekan tipe
```

## Endpoint Utama
| Method & Path | Auth | Keterangan |
|---|---|---|
| `GET /` | – | Health check |
| `POST /files/upload` | ✅ | Upload ke Drive (maks 50MB; PNG, JPEG, WEBP, PDF, APK) |
| `GET /files/list` | ✅ | Daftar file + pagination, pencarian, filter, sort |
| `POST /files/sync` | ✅ | Impor file yang dipilih lewat Google Picker |
| `PUT /files/:id/share` | ✅ | Atur publik/privat, password, kedaluwarsa |
| `PUT /files/:id/rename` | ✅ | Ganti nama (di Drive dan DB) |
| `DELETE /files/:id` · `POST /files/:id/restore` · `DELETE /files/:id/force` | ✅ | Tong sampah & hapus permanen |
| `GET /files/:id/stream` · `GET /files/:id/thumbnail` | ✅ | Konten file milik sendiri |
| `GET /files/public?username=` | – | File publik milik seorang pengguna |
| `GET /files/public/:id` | – | Metadata halaman share |
| `POST /files/public/:id/unlock` | – | Verifikasi password → token akses 10 menit |
| `GET /files/public/:id/stream` · `/thumbnail` | – | Konten file publik |
| `GET /folders` · `POST /folders` | ✅ | Folder Drive yang dapat diakses Stashly |
| `GET /users/me` · `PUT /users/settings` | ✅ | Profil, username, dan layout |
| `GET /users/drive-token` | ✅ | Access token `drive.file` berumur pendek untuk Google Picker |
| `POST /cron/cleanup-trash` | `CRON_SECRET` | Hapus permanen file di tong sampah > 30 hari |

## Keamanan
- Validasi input dengan Zod di semua endpoint; wildcard pencarian `LIKE` di-escape; ID Drive divalidasi sebelum masuk query Drive.
- Proteksi CSRF berbasis origin, CORS hanya untuk `ALLOWED_ORIGIN`, dan rate limit (global, upload, unlock password, token Drive).
- Isi file upload dicek dengan magic bytes, tidak hanya MIME dari client.
- Respons file memakai `nosniff` dan CSP ketat. Tipe yang bisa dieksekusi browser (HTML, SVG, dll) selalu dipaksa diunduh.
- Data publik dikirim lewat whitelist field: tidak pernah menyertakan hash password, `driveFileId`, atau `userId`.
- Pesan error internal hanya masuk log server; client menerima pesan generik.

> Rate limiter disimpan di memori per instance. Untuk deployment multi-instance, ganti dengan store bersama seperti Redis.

## Catatan Deployment
Backend memverifikasi **cookie sesi NextAuth**, dan browser hanya mengirim cookie ke domain yang membuatnya.
Frontend dan backend harus berada di domain yang sama, misalnya:
- subdomain dari domain yang sama (`app.domain.com` & `api.domain.com`, dengan cookie NextAuth diatur untuk `.domain.com`), atau
- backend diproksikan lewat frontend (Next.js rewrites).

Frontend di `*.vercel.app` dan backend di `*.onrender.com` secara langsung **tidak akan** berbagi cookie sesi.
