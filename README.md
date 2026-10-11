# Stashly Backend

Backend untuk aplikasi Stashly — aplikasi web penyimpanan dan berbagi file publik/pribadi.

## Tech Stack
- **Runtime**: Node.js dengan TypeScript
- **Framework**: Hono (`@hono/node-server`)
- **ORM**: Drizzle ORM (PostgreSQL)
- **Validasi**: Zod
- **Integrasi**: Google Drive API (via service account)

## Fitur Utama
- **Manajemen File**: Upload, download, list, dan hapus file.
- **Manajemen Folder**: Membuat, melihat, dan mengelola folder (via route `/folders`).
- **Integrasi Google Drive**: Menyimpan file fisik langsung ke Google Drive.

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
   - `GOOGLE_DRIVE_FOLDER_ID`: ID Folder Google Drive root tempat menyimpan file.
   - `ALLOWED_ORIGIN`: URL dari frontend (misal: http://localhost:3000)
   - `PORT`: (Opsional) Port server (default: 3001)

## Cara Setup Database
```bash
npm run db:generate
npm run db:migrate
```

## Cara Menjalankan

**Development Mode:**
```bash
npm run dev
```

**Production Mode:**
```bash
npm run build
npm start
```

## API Endpoints Utama
- **GET `/`** - Health check server
- **`/files`** - Endpoint untuk manipulasi file (Upload, List, Delete)
- **`/folders`** - Endpoint untuk manipulasi folder

*(Catatan: Detail endpoint dan payload dapat dilihat lebih lanjut pada source code di `src/routes/`)*
