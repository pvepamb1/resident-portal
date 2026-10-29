CREATE TABLE "tenancy_exports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"lease_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_at" timestamp with time zone,
	"last_sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN "ended_by" uuid;--> statement-breakpoint
ALTER TABLE "tenancy_exports" ADD CONSTRAINT "tenancy_exports_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenancy_exports_lease_id_unique" ON "tenancy_exports" USING btree ("lease_id");--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_ended_by_landlords_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."landlords"("id") ON DELETE no action ON UPDATE no action;