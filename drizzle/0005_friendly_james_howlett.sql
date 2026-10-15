ALTER TABLE "files" DROP CONSTRAINT "files_folder_id_folders_id_fk";
--> statement-breakpoint
ALTER TABLE "files" ALTER COLUMN "folder_id" SET DATA TYPE varchar(255);--> statement-breakpoint
CREATE INDEX "user_drive_file_idx" ON "files" USING btree ("user_id","drive_file_id");