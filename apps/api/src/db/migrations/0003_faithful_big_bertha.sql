CREATE TABLE "sandbox_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"question" text NOT NULL,
	"kb_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expected_behavior" text DEFAULT 'answer' NOT NULL,
	"expected_filenames" text[] DEFAULT '{}'::text[] NOT NULL,
	"required_phrases" text[] DEFAULT '{}'::text[] NOT NULL,
	"forbidden_phrases" text[] DEFAULT '{}'::text[] NOT NULL,
	"reference_answer" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sandbox_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"case_id" uuid,
	"case_name" text NOT NULL,
	"question" text NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expected_behavior" text DEFAULT 'answer' NOT NULL,
	"expected_filenames" text[] DEFAULT '{}'::text[] NOT NULL,
	"required_phrases" text[] DEFAULT '{}'::text[] NOT NULL,
	"forbidden_phrases" text[] DEFAULT '{}'::text[] NOT NULL,
	"reference_answer" text,
	"position" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"answer" text DEFAULT '' NOT NULL,
	"escalated" boolean DEFAULT false NOT NULL,
	"escalation_reason" text,
	"chunks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"best_score" double precision,
	"passed" boolean DEFAULT false NOT NULL,
	"checks" jsonb DEFAULT '{"behaviorOk":null,"retrievalHit":null,"requiredOk":null,"forbiddenOk":null}'::jsonb NOT NULL,
	"required_hits" text[] DEFAULT '{}'::text[] NOT NULL,
	"forbidden_hits" text[] DEFAULT '{}'::text[] NOT NULL,
	"latency" jsonb DEFAULT '{"retrievalMs":0,"generationMs":0,"totalMs":0}'::jsonb NOT NULL,
	"tokens" jsonb DEFAULT '{"input":0,"output":0}'::jsonb NOT NULL,
	"model" text,
	"prompt_version" text NOT NULL,
	"error" text,
	"review_status" text DEFAULT 'unreviewed' NOT NULL,
	"review_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sandbox_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_by" uuid NOT NULL,
	"case_count" integer NOT NULL,
	"completed_count" integer DEFAULT 0 NOT NULL,
	"kb_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"case_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"settings_snapshot" jsonb NOT NULL,
	"prompt_version" text NOT NULL,
	"provider" text NOT NULL,
	"metrics" jsonb,
	"total_tokens_in" integer DEFAULT 0 NOT NULL,
	"total_tokens_out" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" numeric(10, 6),
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sandbox_cases" ADD CONSTRAINT "sandbox_cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_results" ADD CONSTRAINT "sandbox_results_run_id_sandbox_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sandbox_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_results" ADD CONSTRAINT "sandbox_results_case_id_sandbox_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."sandbox_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_results" ADD CONSTRAINT "sandbox_results_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_runs" ADD CONSTRAINT "sandbox_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sandbox_cases_updated_at_idx" ON "sandbox_cases" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_results_run_case_uidx" ON "sandbox_results" USING btree ("run_id","case_id");--> statement-breakpoint
CREATE INDEX "sandbox_results_run_id_idx" ON "sandbox_results" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "sandbox_results_review_status_idx" ON "sandbox_results" USING btree ("review_status");--> statement-breakpoint
CREATE INDEX "sandbox_runs_created_at_idx" ON "sandbox_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sandbox_runs_status_idx" ON "sandbox_runs" USING btree ("status");