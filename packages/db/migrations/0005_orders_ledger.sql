CREATE TYPE "public"."delivery_method" AS ENUM('courier', 'meetup', 'seller_arranged');--> statement-breakpoint
CREATE TYPE "public"."ledger_account_code" AS ENUM('platform_bank', 'buyer_payments_clearing', 'escrow_held', 'platform_fees', 'seller_pending', 'seller_balance', 'payouts_in_flight', 'courier_cash', 'courier_earnings', 'refunds');--> statement-breakpoint
CREATE TYPE "public"."order_actor" AS ENUM('buyer', 'seller', 'courier', 'staff', 'system');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('created', 'awaiting_payment', 'payment_submitted', 'payment_rejected', 'funds_held', 'ready_for_pickup', 'picked_up', 'out_for_delivery', 'delivery_failed', 'delivered', 'disputed', 'completed', 'resolved_refund', 'resolved_partial', 'resolved_release', 'payout_released', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('bank_transfer', 'cod', 'mock');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('submitted', 'verified', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."media_kind" ADD VALUE 'payment_proof';--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" "ledger_account_code" NOT NULL,
	"owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_accounts_code_owner_uq" UNIQUE NULLS NOT DISTINCT("code","owner_id"),
	CONSTRAINT "ledger_accounts_owner" CHECK (("ledger_accounts"."code" in ('seller_pending', 'seller_balance', 'courier_cash', 'courier_earnings', 'refunds')) = ("ledger_accounts"."owner_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_non_zero" CHECK ("ledger_entries"."amount_minor" <> 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"order_id" uuid,
	"payment_id" uuid,
	"idempotency_key" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_transactions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "order_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"protection_fixed_minor" bigint NOT NULL,
	"protection_pct_bps" integer NOT NULL,
	"protection_cap_minor" bigint NOT NULL,
	"courier_fee_minor" bigint NOT NULL,
	"cod_max_minor" bigint NOT NULL,
	"new_buyer_max_minor" bigint NOT NULL,
	"new_account_days" integer NOT NULL,
	"payment_hours" integer NOT NULL,
	"handover_hours" integer NOT NULL,
	"inspection_hours" integer NOT NULL,
	"new_seller_hold_days" integer NOT NULL,
	"new_seller_orders" integer NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_configs_sane" CHECK ("order_configs"."protection_fixed_minor" >= 0 and "order_configs"."protection_pct_bps" between 0 and 10000
        and "order_configs"."protection_cap_minor" >= 0 and "order_configs"."courier_fee_minor" >= 0 and "order_configs"."cod_max_minor" >= 0
        and "order_configs"."new_buyer_max_minor" > 0 and "order_configs"."payment_hours" > 0 and "order_configs"."handover_hours" > 0
        and "order_configs"."inspection_hours" > 0 and "order_configs"."new_seller_hold_days" >= 0 and "order_configs"."new_seller_orders" >= 0)
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" "order_status",
	"to_status" "order_status" NOT NULL,
	"event" text NOT NULL,
	"actor_type" "order_actor" NOT NULL,
	"actor_id" uuid,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_code" text NOT NULL,
	"listing_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"offer_id" uuid,
	"courier_id" uuid,
	"status" "order_status" NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"delivery_method" "delivery_method" NOT NULL,
	"item_minor" bigint NOT NULL,
	"delivery_minor" bigint NOT NULL,
	"protection_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"config_id" uuid NOT NULL,
	"payment_due_at" timestamp with time zone,
	"handover_due_at" timestamp with time zone,
	"inspection_ends_at" timestamp with time zone,
	"payout_hold_until" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_public_code_unique" UNIQUE("public_code"),
	CONSTRAINT "orders_not_self" CHECK ("orders"."buyer_id" <> "orders"."seller_id"),
	CONSTRAINT "orders_amounts" CHECK ("orders"."item_minor" > 0 and "orders"."delivery_minor" >= 0 and "orders"."protection_minor" >= 0
        and "orders"."total_minor" = "orders"."item_minor" + "orders"."delivery_minor" + "orders"."protection_minor")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"reference" text NOT NULL,
	"proof_media_id" uuid,
	"status" "payment_status" DEFAULT 'submitted' NOT NULL,
	"submitted_by" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "staff_mfa" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"secret_enc" "bytea" NOT NULL,
	"last_used_step" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_courier_id_users_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_config_id_order_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."order_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_proof_media_id_media_id_fk" FOREIGN KEY ("proof_media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_mfa" ADD CONSTRAINT "staff_mfa_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entries_account_idx" ON "ledger_entries" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_transaction_idx" ON "ledger_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_transactions_order_idx" ON "ledger_transactions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_events_idem_uq" ON "order_events" USING btree ("order_id","idempotency_key") WHERE "order_events"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_one_active_per_listing_uq" ON "orders" USING btree ("listing_id") WHERE "orders"."status" in ('created', 'awaiting_payment', 'payment_submitted', 'payment_rejected', 'funds_held', 'ready_for_pickup', 'picked_up', 'out_for_delivery', 'delivery_failed', 'delivered', 'disputed');--> statement-breakpoint
CREATE INDEX "orders_buyer_idx" ON "orders" USING btree ("buyer_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_seller_idx" ON "orders" USING btree ("seller_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_payment_due_idx" ON "orders" USING btree ("payment_due_at") WHERE "orders"."payment_due_at" is not null;--> statement-breakpoint
CREATE INDEX "orders_handover_due_idx" ON "orders" USING btree ("handover_due_at") WHERE "orders"."handover_due_at" is not null;--> statement-breakpoint
CREATE INDEX "orders_inspection_idx" ON "orders" USING btree ("inspection_ends_at") WHERE "orders"."inspection_ends_at" is not null;--> statement-breakpoint
CREATE INDEX "orders_payout_hold_idx" ON "orders" USING btree ("payout_hold_until") WHERE "orders"."payout_hold_until" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_reference_uq" ON "payments" USING btree ("reference") WHERE "payments"."status" <> 'rejected';--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_open_per_order_uq" ON "payments" USING btree ("order_id") WHERE "payments"."status" = 'submitted';--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_proof_uq" ON "payments" USING btree ("proof_media_id");