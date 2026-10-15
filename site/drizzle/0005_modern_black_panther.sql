ALTER TABLE `subscription_catalog` ADD `webhook_id` text;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `pause_requested` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `pause_confirmed` integer DEFAULT 0 NOT NULL;