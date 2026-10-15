ALTER TABLE "files" ADD COLUMN "pos_x" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "pos_y" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "pos_x" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "pos_y" integer DEFAULT 0 NOT NULL;