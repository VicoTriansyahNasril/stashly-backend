import { pgTable, timestamp, boolean, varchar, uuid, integer, text, primaryKey, bigint, index } from 'drizzle-orm/pg-core';

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  username: text("username").unique(), // For /username routing
  storageUsed: bigint("storage_used", { mode: 'number' }).default(0).notNull(),
  storageLimit: bigint("storage_limit", { mode: 'number' }).default(5368709120).notNull(), // Default 5GB
  theme: text("theme").default("dark"),
  layoutStyle: text("layout_style").default("grid"),
})

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => ({
    compoundKey: primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  })
)

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
})

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => ({
    compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
  })
)

export const folders = pgTable('folders', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  driveFolderId: varchar('drive_folder_id', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  parentId: uuid('parent_id'), // Relates to another folder.id (nullable for root)
  posX: integer('pos_x').default(0).notNull(),
  posY: integer('pos_y').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const files = pgTable('files', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(), // Relates file to user
  // ID folder Google Drive tempat file berada (null = root). Folder dikelola di Drive, bukan di tabel `folders`.
  folderId: varchar('folder_id', { length: 255 }),
  driveFileId: varchar('drive_file_id', { length: 255 }).notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileType: varchar('file_type', { length: 255 }).notNull(),
  fileSize: bigint('file_size', { mode: 'number' }).notNull(), // Use bigint for sizes > 2GB
  isPublic: boolean('is_public').default(true).notNull(),
  password: varchar('password', { length: 255 }), // bcrypt hash, untuk tautan berpassword
  expiresAt: timestamp('expires_at', { mode: 'date' }), // For limited time sharing
  webContentLink: varchar('web_content_link', { length: 1024 }),
  webViewLink: varchar('web_view_link', { length: 1024 }),
  posX: integer('pos_x').default(0).notNull(),
  posY: integer('pos_y').default(0).notNull(),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { mode: 'date' }), // Soft delete
}, (table) => {
  return {
    userIdIdx: index("user_id_idx").on(table.userId),
    folderIdIdx: index("folder_id_idx").on(table.folderId),
    fileTypeIdx: index("file_type_idx").on(table.fileType),
    deletedAtIdx: index("deleted_at_idx").on(table.deletedAt),
    uploadedAtIdx: index("uploaded_at_idx").on(table.uploadedAt),
    userDriveFileIdx: index("user_drive_file_idx").on(table.userId, table.driveFileId),
  };
});
