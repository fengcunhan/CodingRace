CREATE TYPE "public"."agent" AS ENUM('claude_code', 'codex', 'gemini_cli', 'other');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('usage', 'usage_summary');--> statement-breakpoint
CREATE TYPE "public"."flag_status" AS ENUM('clean', 'late', 'suspect', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."leaderboard_metric" AS ENUM('est_cost_usd', 'total_tokens');--> statement-breakpoint
CREATE TYPE "public"."period_type" AS ENUM('daily', 'weekly', 'monthly', 'all_time');--> statement-breakpoint
CREATE TYPE "public"."trust_level" AS ENUM('normal', 'suspect', 'verified');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TABLE "auth_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"code_prefix" text NOT NULL,
	"label" text,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "ingest_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"auth_code_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"events_total" integer NOT NULL,
	"events_accepted" integer NOT NULL,
	"events_duplicate" integer NOT NULL,
	"events_rejected" integer NOT NULL,
	"geo_country" char(2),
	"ip_hash" text,
	"plugin_version" text
);
--> statement-breakpoint
CREATE TABLE "leaderboard_snapshots" (
	"board" text NOT NULL,
	"period_type" "period_type" NOT NULL,
	"period_start" date NOT NULL,
	"metric" "leaderboard_metric" NOT NULL,
	"rank" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"metric_value" numeric(16, 4) NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leaderboard_snapshots_board_period_type_period_start_metric_rank_pk" PRIMARY KEY("board","period_type","period_start","metric","rank")
);
--> statement-breakpoint
CREATE TABLE "model_aliases" (
	"alias" text PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_prices" (
	"model_id" text NOT NULL,
	"effective_from" date NOT NULL,
	"input_usd_per_mtok" numeric(10, 4) NOT NULL,
	"output_usd_per_mtok" numeric(10, 4) NOT NULL,
	"cache_write_usd_per_mtok" numeric(10, 4) NOT NULL,
	"cache_read_usd_per_mtok" numeric(10, 4) NOT NULL,
	CONSTRAINT "model_prices_model_id_effective_from_pk" PRIMARY KEY("model_id","effective_from")
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" text PRIMARY KEY NOT NULL,
	"vendor" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_daily_rollups" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"agent" "agent" NOT NULL,
	"model_id" text NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_creation_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"total_tokens" bigint GENERATED ALWAYS AS (input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens) STORED,
	"est_cost_usd" numeric(12, 4) DEFAULT '0' NOT NULL,
	"events_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_daily_rollups_user_id_day_agent_model_id_pk" PRIMARY KEY("user_id","day","agent","model_id")
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "usage_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"auth_code_id" uuid NOT NULL,
	"agent" "agent" NOT NULL,
	"agent_version" text,
	"plugin_version" text,
	"event_type" "event_type" DEFAULT 'usage' NOT NULL,
	"session_id" text NOT NULL,
	"message_id" text,
	"model_raw" text NOT NULL,
	"model_id" text,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_creation_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"period_start" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"turn_duration_ms" integer,
	"geo_country" char(2),
	"geo_city" text,
	"ip_hash" text,
	"flag_status" "flag_status" DEFAULT 'clean' NOT NULL,
	"flag_reason" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"trust_level" "trust_level" DEFAULT 'normal' NOT NULL,
	"country_code" char(2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "auth_codes" ADD CONSTRAINT "auth_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_batches" ADD CONSTRAINT "ingest_batches_auth_code_id_auth_codes_id_fk" FOREIGN KEY ("auth_code_id") REFERENCES "public"."auth_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_snapshots" ADD CONSTRAINT "leaderboard_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_aliases" ADD CONSTRAINT "model_aliases_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_prices" ADD CONSTRAINT "model_prices_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_daily_rollups" ADD CONSTRAINT "usage_daily_rollups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_auth_code_id_auth_codes_id_fk" FOREIGN KEY ("auth_code_id") REFERENCES "public"."auth_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_auth_codes_user" ON "auth_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_rollups_day_cost" ON "usage_daily_rollups" USING btree ("day","est_cost_usd" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_events_message_dedup" ON "usage_events" USING btree ("user_id","agent","session_id","message_id") WHERE message_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_events_event_id" ON "usage_events" USING btree ("user_id","event_id");--> statement-breakpoint
CREATE INDEX "idx_events_user_time" ON "usage_events" USING btree ("user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_events_needs_norm" ON "usage_events" USING btree ("received_at") WHERE model_id is null;