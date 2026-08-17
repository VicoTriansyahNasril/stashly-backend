# Stashly Backend

Backend untuk aplikasi Stashly — aplikasi web penyimpanan dan berbagi file publik.

## Tech Stack
- **Runtime**: Node.js dengan TypeScript
- **Framework**: Hono (@hono/node-server)
- **ORM**: Drizzle ORM (PostgreSQL)
- **Validasi**: Zod (tersedia jika dibutuhkan untuk payload complex)
- **Integrasi**: Google Drive API (via service account)

## Cara Install
```bash
npm install
```

## Cara Setup Environment
1. Copy `.env.example` ke `.env`:
   ```bash
   cp .env.example .env
   ```
2. Isi variabel di dalam `.env`:
   - `DATABASE_URL`: URL koneksi PostgreSQL Anda
   - `GOOGLE_SERVICE_ACCOUNT_KEY`: JSON dari file service account Google Cloud (sebagai single string, hindari newline jika memungkinkan, atau paste sebagai JSON utuh).
   - `GOOGLE_DRIVE_FOLDER_ID`: ID Folder Google Drive tempat menyimpan file.
   - `ALLOWED_ORIGIN`: URL dari frontend (misal: http://localhost:3000)

## Cara Setup Database
```bash
npm run db:generate
npm run db:migrate
```

## Cara Menjalankan
```bash
npm run dev
```

## API Endpoints
- **POST /files/upload**
  - Mengunggah file ke Google Drive dan menyimpan metadata ke DB.
  - Payload (FormData): `file` (File), `isPublic` (boolean string).
  - Dilengkapi rate limiting dan validasi file (size & mime type).
- **GET /files/list**
  - Mengambil daftar semua file publik.
- **DELETE /files/:id**
  - Menghapus file dari Drive dan dari database berdasarkan UUID.
