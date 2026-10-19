ALTER TABLE "answer_events" DROP CONSTRAINT "answer_events_incoming_message_id_messages_id_fk";
--> statement-breakpoint
ALTER TABLE "answer_events" DROP CONSTRAINT "answer_events_outgoing_message_id_messages_id_fk";
--> statement-breakpoint
ALTER TABLE "answer_events" ADD CONSTRAINT "answer_events_incoming_message_id_messages_id_fk" FOREIGN KEY ("incoming_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_events" ADD CONSTRAINT "answer_events_outgoing_message_id_messages_id_fk" FOREIGN KEY ("outgoing_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_created_at_direction_idx" ON "messages" USING btree ("created_at","direction");