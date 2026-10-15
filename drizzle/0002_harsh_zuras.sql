CREATE INDEX "user_id_idx" ON "files" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "folder_id_idx" ON "files" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "file_type_idx" ON "files" USING btree ("file_type");--> statement-breakpoint
CREATE INDEX "deleted_at_idx" ON "files" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "uploaded_at_idx" ON "files" USING btree ("uploaded_at");