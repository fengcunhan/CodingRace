ALTER TABLE "leaderboard_snapshots" ALTER COLUMN "metric_value" SET DATA TYPE numeric(18, 6);--> statement-breakpoint
ALTER TABLE "usage_daily_rollups" ALTER COLUMN "est_cost_usd" SET DATA TYPE numeric(14, 6);--> statement-breakpoint
ALTER TABLE "usage_daily_rollups" ALTER COLUMN "est_cost_usd" SET DEFAULT '0';