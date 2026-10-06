CREATE TYPE "public"."checkin_status" AS ENUM('pending', 'yes', 'no', 'missed');--> statement-breakpoint
CREATE TYPE "public"."delivery_state" AS ENUM('queued', 'sending', 'sent', 'uncertain', 'skipped');--> statement-breakpoint
CREATE TABLE "goal_checkins" (
	"id" serial PRIMARY KEY NOT NULL,
	"goal_id" integer NOT NULL,
	"checkin_date" date NOT NULL,
	"status" "checkin_status" DEFAULT 'pending' NOT NULL,
	"responded_at" timestamp with time zone,
	"discord_message_id" varchar(20),
	"delivery_state" "delivery_state" DEFAULT 'queued' NOT NULL,
	"attempted_at" timestamp with time zone,
	"retry_at" timestamp with time zone,
	"last_error_code" varchar(30),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_checkins_response_check" CHECK (("goal_checkins"."status" IN ('yes', 'no')) = ("goal_checkins"."responded_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" varchar(20) NOT NULL,
	"channel_id" varchar(20) NOT NULL,
	"creator_user_id" varchar(20) NOT NULL,
	"target_user_id" varchar(20) NOT NULL,
	"title" varchar(200) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"reminder_time" varchar(5) NOT NULL,
	"timezone" varchar(100) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_dates_check" CHECK ("goals"."end_date" >= "goals"."start_date" AND "goals"."end_date" - "goals"."start_date" <= 3699),
	CONSTRAINT "goals_time_check" CHECK ("goals"."reminder_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "goals_title_check" CHECK (length(trim("goals"."title")) > 0)
);
--> statement-breakpoint
ALTER TABLE "goal_checkins" ADD CONSTRAINT "goal_checkins_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "goal_checkins_goal_date_unique" ON "goal_checkins" USING btree ("goal_id","checkin_date");--> statement-breakpoint
CREATE INDEX "goal_checkins_recovery_idx" ON "goal_checkins" USING btree ("delivery_state","goal_id");--> statement-breakpoint
CREATE INDEX "goals_active_id_idx" ON "goals" USING btree ("active","id");--> statement-breakpoint
CREATE INDEX "goals_guild_users_idx" ON "goals" USING btree ("guild_id","creator_user_id","target_user_id");