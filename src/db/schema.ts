import { pgTable, timestamp, boolean, varchar, uuid, integer } from 'drizzle-orm/pg-core';

export const files = pgTable('files', {
  id: uuid('id').defaultRandom().primaryKey(),
  driveFileId: varchar('drive_file_id', { length: 255 }).notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileType: varchar('file_type', { length: 255 }).notNull(),
  fileSize: integer('file_size').notNull(),
  isPublic: boolean('is_public').default(true).notNull(),
  webContentLink: varchar('web_content_link', { length: 1024 }),
  webViewLink: varchar('web_view_link', { length: 1024 }),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
});
